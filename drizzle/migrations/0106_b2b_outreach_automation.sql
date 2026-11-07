-- Prospecção B2B: contexto da personalização, WhatsApp manual, agendamento pela Brevo, fila automática do Outbound
-- e pausa dos follow-ups quando o contato responde pelo WhatsApp. Nenhum dado existente muda; nada é enviado aqui.
ALTER TABLE public.b2b_ai_email_items
 ADD COLUMN IF NOT EXISTS whatsapp_text text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS personalization_fact text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS personalization_source text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS context_status text NOT NULL DEFAULT 'ok',
 ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
 ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz;
ALTER TABLE public.b2b_ai_email_items ADD CONSTRAINT b2b_ai_email_items_context_status CHECK (context_status IN ('ok','insufficient'));

CREATE OR REPLACE FUNCTION public.finish_b2b_ai_email_item_v2(p_batch uuid,p_token uuid,p_item uuid,p_subject text,p_body text,p_whatsapp text,p_fact text,p_source text,p_sufficient boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 PERFORM 1 FROM b2b_ai_email_batches WHERE id=p_batch AND state='running' AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE b2b_ai_email_items SET subject=p_subject,body=p_body,whatsapp_text=left(coalesce(p_whatsapp,''),1000),
  personalization_fact=left(coalesce(p_fact,''),600),personalization_source=left(coalesce(p_source,''),300),
  context_status=CASE WHEN p_sufficient THEN 'ok' ELSE 'insufficient' END,state='draft',revision=revision+1
 WHERE id=p_item AND batch_id=p_batch AND state='generating';
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.review_b2b_ai_email_item_v2(p_id uuid,p_revision integer,p_subject text,p_body text,p_recipient text,p_whatsapp text,p_reviewed boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text := lower(btrim(coalesce(p_recipient,''))); n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF length(trim(p_subject)) NOT BETWEEN 1 AND 200 OR length(trim(p_body)) NOT BETWEEN 10 AND 6000 OR length(coalesce(p_whatsapp,'')) > 1000 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 IF r <> '' AND (char_length(r) > 254 OR r !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN RAISE EXCEPTION 'invalid_recipient'; END IF;
 UPDATE b2b_ai_email_items SET subject=trim(p_subject),body=trim(p_body),recipient=r,whatsapp_text=btrim(coalesce(p_whatsapp,'')),
  state=CASE WHEN p_reviewed THEN 'reviewed' ELSE 'draft' END,revision=revision+1
 WHERE id=p_id AND revision=p_revision AND state IN ('draft','reviewed') AND send_state='none' RETURNING revision INTO n;
 IF n IS NULL THEN RAISE EXCEPTION 'stale_draft'; END IF;
 RETURN n;
END $$;

DROP FUNCTION IF EXISTS public.reserve_b2b_ai_email_send(uuid,integer);
CREATE FUNCTION public.reserve_b2b_ai_email_send(p_id uuid,p_revision integer,p_scheduled_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.b2b_ai_email_items; r text; lead uuid; used integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_scheduled_at IS NOT NULL AND (p_scheduled_at < now()+interval '4 minutes' OR p_scheduled_at > now()+interval '72 hours') THEN RAISE EXCEPTION 'invalid_schedule'; END IF;
 SELECT * INTO i FROM b2b_ai_email_items WHERE id=p_id FOR UPDATE;
 IF i.id IS NULL OR i.revision<>p_revision OR i.state<>'reviewed' OR i.send_state<>'none' THEN RAISE EXCEPTION 'stale_draft'; END IF;
 r := lower(btrim(i.recipient));
 IF r='' THEN RAISE EXCEPTION 'missing_recipient'; END IF;
 IF r !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'invalid_recipient'; END IF;
 IF char_length(btrim(i.subject))=0 OR char_length(btrim(i.body))<10 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 IF coalesce((SELECT sender_email FROM crm_campaign_email_settings LIMIT 1),'')='' THEN RAISE EXCEPTION 'sender_not_configured'; END IF;
 IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=r)
    OR EXISTS (SELECT 1 FROM crm_campaign_permissions WHERE channel='email' AND contact=r AND withdrawn_at IS NOT NULL) THEN RAISE EXCEPTION 'suppressed_contact'; END IF;
 IF EXISTS (SELECT 1 FROM b2b_ai_email_items WHERE id<>i.id AND lower(recipient)=r AND send_state IN ('reserved','accepted','unknown')) THEN RAISE EXCEPTION 'already_sent'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('crm_email_daily_quota'));
 SELECT (SELECT count(*) FROM crm_email_flow_messages WHERE direction='out' AND state IN ('accepted','reserved') AND updated_at>=now()-interval '24 hours')
      + (SELECT count(*) FROM crm_campaign_deliveries WHERE state IN ('accepted','scheduled','reserved') AND updated_at>=now()-interval '24 hours')
      + (SELECT count(*) FROM b2b_ai_email_items WHERE send_state IN ('accepted','reserved') AND send_reserved_at>=now()-interval '24 hours') INTO used;
 IF used >= 250 THEN RAISE EXCEPTION 'daily_limit'; END IF;
 IF i.company_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND EXISTS (SELECT 1 FROM leads WHERE id=i.company_key::uuid) THEN lead := i.company_key::uuid;
 ELSE SELECT b.lead_id INTO lead FROM b2b_companies b WHERE b.place_id=i.company_key AND b.place_id<>'' AND b.lead_id IS NOT NULL LIMIT 1; END IF;
 UPDATE b2b_ai_email_items SET send_state='reserved', recipient=r, send_lead_id=lead, send_reserved_at=now(), scheduled_for=p_scheduled_at, send_error='', revision=revision+1 WHERE id=i.id;
 RETURN jsonb_build_object('recipient',r,'lead_id',lead,'subject',i.subject,'body',i.body,'name',i.company->>'name');
END $$;

CREATE OR REPLACE FUNCTION public.finish_b2b_ai_email_send(p_id uuid,p_state text,p_provider_id text,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.b2b_ai_email_items;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE b2b_ai_email_items SET send_state=p_state, provider_message_id=nullif(left(coalesce(p_provider_id,''),300),''),
  send_error=left(coalesce(p_error,''),120), sent_at=CASE WHEN p_state='accepted' THEN coalesce(scheduled_for, now()) ELSE NULL END
 WHERE id=p_id AND send_state='reserved' RETURNING * INTO i;
 IF i.id IS NULL THEN RETURN false; END IF;
 IF p_state='accepted' AND i.send_lead_id IS NOT NULL THEN
  PERFORM crm_email_sent_effects(i.send_lead_id,'b2b-first-email:'||i.id,'Primeiro contato B2B · E-mail'||chr(10)||
   CASE WHEN i.scheduled_for IS NOT NULL THEN 'Agendado na Brevo para '||to_char(i.scheduled_for AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' — ' ELSE 'Enviado pela Brevo — ' END||
   'assunto "'||left(i.subject,200)||'" para '||i.recipient||'.');
 END IF;
 RETURN true;
END $$;

-- WhatsApp do primeiro contato: enviado à mão pelo usuário; o CRM só registra.
CREATE OR REPLACE FUNCTION public.record_b2b_ai_whatsapp_manual(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.b2b_ai_email_items; lead uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO i FROM b2b_ai_email_items WHERE id=p_id FOR UPDATE;
 IF i.id IS NULL OR i.whatsapp_sent_at IS NOT NULL OR btrim(i.whatsapp_text)='' THEN RETURN false; END IF;
 IF i.company_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND EXISTS (SELECT 1 FROM leads WHERE id=i.company_key::uuid) THEN lead := i.company_key::uuid;
 ELSE SELECT b.lead_id INTO lead FROM b2b_companies b WHERE b.place_id=i.company_key AND b.place_id<>'' AND b.lead_id IS NOT NULL LIMIT 1; END IF;
 UPDATE b2b_ai_email_items SET whatsapp_sent_at=now() WHERE id=i.id;
 IF lead IS NOT NULL THEN
  UPDATE leads SET history = CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END ||
   jsonb_build_array(jsonb_build_object('id','b2b-first-whatsapp:'||i.id,'date',now()::text,'kind','interaction','source','Pipeflow',
    'text','Primeiro contato B2B · WhatsApp'||chr(10)||'Mensagem enviada manualmente pelo WhatsApp: '||left(i.whatsapp_text,400)))
  WHERE id=lead AND NOT (jsonb_typeof(history)='array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(history) h WHERE h->>'id'='b2b-first-whatsapp:'||i.id));
 END IF;
 RETURN true;
END $$;

-- Fila automática: card da Prospecção B2B em Lead Novo do funil Outbound ganha um rascunho uma única vez.
CREATE TABLE public.b2b_prep_queue (
 lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed')),
 attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz,
 item_id uuid,
 error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.b2b_prep_queue TO service_role;
REVOKE ALL ON public.b2b_prep_queue FROM PUBLIC, anon, authenticated;
ALTER TABLE public.b2b_prep_queue ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.b2b_prep_runner (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 enabled boolean NOT NULL DEFAULT true,
 token text NOT NULL DEFAULT replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 job_url text NOT NULL DEFAULT 'https://project--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app/api/public/jobs/b2b-prep' CHECK (job_url = '' OR job_url ~ '^https://[a-z0-9.-]+/api/public/jobs/b2b-prep$'),
 sender text NOT NULL DEFAULT 'Equipe Gravon Company',
 lease_token uuid,
 lease_until timestamptz,
 ai_blocked_reason text NOT NULL DEFAULT '' CHECK (length(ai_blocked_reason) <= 300),
 last_run_at timestamptz,
 last_result jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO public.b2b_prep_runner (id) VALUES (true);
GRANT SELECT, UPDATE ON public.b2b_prep_runner TO service_role;
REVOKE ALL ON public.b2b_prep_runner FROM PUBLIC, anon, authenticated;
ALTER TABLE public.b2b_prep_runner ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.b2b_prep_runner.token IS 'Token privado do executor; nunca exibido.';

-- Acorda o executor no momento em que um card entra na fila (sem varredura frequente).
CREATE OR REPLACE FUNCTION public.wake_b2b_prep() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record;
BEGIN
 SELECT token, job_url, enabled INTO r FROM b2b_prep_runner WHERE id;
 IF r IS NULL OR NOT r.enabled OR r.job_url = '' THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM b2b_prep_queue WHERE state='queued') THEN RETURN; END IF;
 BEGIN
  PERFORM net.http_post(url := r.job_url, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||r.token), body := '{}'::jsonb, timeout_milliseconds := 120000);
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'b2b_prep_wake_failed';
 END;
END $$;
REVOKE ALL ON FUNCTION public.wake_b2b_prep() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.b2b_prep_enqueue_lead(p_lead uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE added uuid;
BEGIN
 INSERT INTO b2b_prep_queue(lead_id)
 SELECT l.id FROM leads l JOIN sales_pipelines p ON p.id=l.pipeline_id
 WHERE l.id=p_lead AND l.stage='lead-novo' AND lower(p.name)='outbound' AND NOT p.archived
   AND EXISTS (SELECT 1 FROM b2b_companies b WHERE b.lead_id=l.id)
 ON CONFLICT (lead_id) DO NOTHING RETURNING lead_id INTO added;
 IF added IS NOT NULL THEN PERFORM wake_b2b_prep(); END IF;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'b2b_prep_enqueue_failed';
END $$;
REVOKE ALL ON FUNCTION public.b2b_prep_enqueue_lead(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.b2b_prep_on_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.stage='lead-novo' AND NEW.pipeline_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage OR OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id) THEN
  PERFORM b2b_prep_enqueue_lead(NEW.id);
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.b2b_prep_on_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.lead_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.lead_id IS DISTINCT FROM NEW.lead_id) THEN PERFORM b2b_prep_enqueue_lead(NEW.lead_id); END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.b2b_prep_on_lead(), public.b2b_prep_on_company() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER leads_b2b_prep_enqueue AFTER INSERT OR UPDATE OF stage, pipeline_id ON public.leads FOR EACH ROW EXECUTE FUNCTION public.b2b_prep_on_lead();
CREATE TRIGGER b2b_companies_prep_enqueue AFTER INSERT OR UPDATE OF lead_id ON public.b2b_companies FOR EACH ROW EXECUTE FUNCTION public.b2b_prep_on_company();

CREATE OR REPLACE FUNCTION public.claim_b2b_prep(p_token uuid,p_limit integer) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[];
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE b2b_prep_runner SET lease_token=p_token, lease_until=now()+interval '8 minutes', last_run_at=now()
  WHERE id AND enabled AND ai_blocked_reason='' AND (lease_until IS NULL OR lease_until<now());
 IF NOT FOUND THEN RETURN ARRAY[]::uuid[]; END IF;
 -- Execução anterior interrompida: resultado desconhecido, não gera de novo automaticamente.
 UPDATE b2b_prep_queue SET state='failed', error='Execução interrompida; use Preparar disparo para gerar.', updated_at=now() WHERE state='running' AND lease_until<now();
 WITH picked AS (SELECT lead_id FROM b2b_prep_queue WHERE state='queued' ORDER BY created_at LIMIT least(greatest(p_limit,1),10) FOR UPDATE SKIP LOCKED),
 upd AS (UPDATE b2b_prep_queue q SET state='running', attempts=attempts+1, lease_until=now()+interval '8 minutes', updated_at=now() FROM picked WHERE q.lead_id=picked.lead_id RETURNING q.lead_id)
 SELECT array_agg(lead_id) INTO ids FROM upd;
 RETURN coalesce(ids, ARRAY[]::uuid[]);
END $$;
CREATE OR REPLACE FUNCTION public.release_b2b_prep(p_token uuid,p_result jsonb,p_blocked text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE b2b_prep_runner SET lease_token=NULL, lease_until=NULL, last_result=coalesce(p_result,'{}'), ai_blocked_reason=left(coalesce(p_blocked,''),300) WHERE id AND lease_token=p_token;
END $$;
REVOKE ALL ON FUNCTION public.finish_b2b_ai_email_item_v2(uuid,uuid,uuid,text,text,text,text,text,boolean), public.review_b2b_ai_email_item_v2(uuid,integer,text,text,text,text,boolean),
 public.reserve_b2b_ai_email_send(uuid,integer,timestamptz), public.record_b2b_ai_whatsapp_manual(uuid), public.claim_b2b_prep(uuid,integer), public.release_b2b_prep(uuid,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_b2b_ai_email_item_v2(uuid,uuid,uuid,text,text,text,text,text,boolean), public.review_b2b_ai_email_item_v2(uuid,integer,text,text,text,text,boolean),
 public.reserve_b2b_ai_email_send(uuid,integer,timestamptz), public.record_b2b_ai_whatsapp_manual(uuid), public.claim_b2b_prep(uuid,integer), public.release_b2b_prep(uuid,jsonb,text) TO service_role;

-- Resposta pelo WhatsApp interrompe os follow-ups de e-mail do mesmo contato.
CREATE OR REPLACE FUNCTION public.pause_email_flows_on_whatsapp_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT NEW.from_me AND NEW.phone_key IS NOT NULL AND NEW.phone_key <> '' THEN
  UPDATE crm_email_flow_enrollments e SET status='paused', reason='Respondeu pelo WhatsApp; follow-ups interrompidos', next_send_at=NULL, updated_at=now()
  FROM leads l WHERE l.id=e.lead_id AND e.status='active' AND crm_phone_key(l.whatsapp)=NEW.phone_key;
 END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 RAISE WARNING 'pause_email_flows_on_whatsapp_reply_failed';
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.pause_email_flows_on_whatsapp_reply() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER whatsapp_messages_pause_email_flows AFTER INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION public.pause_email_flows_on_whatsapp_reply();

-- Rede de segurança de baixa frequência: uma vez por hora acorda o executor só se houver fila pendente.
DO $$ BEGIN
 PERFORM cron.schedule('crm-b2b-prep-hourly', '23 * * * *', 'SELECT public.wake_b2b_prep()');
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'b2b_prep_cron_unavailable';
END $$;