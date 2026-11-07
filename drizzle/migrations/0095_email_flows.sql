-- Fluxos de E-mail (sequências de prospecção) + efeitos de envio no card.
-- Tudo service-only: chamado por funções de servidor com sessão CRM completa ou pelo executor
-- agendado (token privado gravado só no banco). Nenhum envio ocorre por esta migração.

CREATE FUNCTION public.crm_email_sent_effects(p_lead uuid, p_key text, p_text text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l record; cur_idx bigint; target_idx bigint; moved boolean := false;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_lead IS NULL THEN RETURN 'no_lead'; END IF;
 SELECT id, stage, pipeline_id, history INTO l FROM leads WHERE id=p_lead FOR UPDATE;
 IF l.id IS NULL THEN RETURN 'no_lead'; END IF;
 IF jsonb_typeof(l.history)='array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.history) h WHERE h->>'id'=p_key) THEN RETURN 'duplicate'; END IF;
 IF l.pipeline_id IS NOT NULL AND EXISTS (SELECT 1 FROM b2b_companies b WHERE b.lead_id=l.id) THEN
  SELECT x.n INTO target_idx FROM sales_pipelines p CROSS JOIN jsonb_array_elements(p.stages) WITH ORDINALITY x(s,n) WHERE p.id=l.pipeline_id AND x.s->>'id'='tentando-contato';
  SELECT x.n INTO cur_idx FROM sales_pipelines p CROSS JOIN jsonb_array_elements(p.stages) WITH ORDINALITY x(s,n) WHERE p.id=l.pipeline_id AND x.s->>'id'=l.stage;
  moved := target_idx IS NOT NULL AND cur_idx IS NOT NULL AND cur_idx < target_idx;
 END IF;
 UPDATE leads SET
  stage = CASE WHEN moved THEN 'tentando-contato' ELSE stage END,
  history = CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END
   || jsonb_build_array(jsonb_build_object('id',p_key,'date',now()::text,'kind','email_marketing','source','Pipeflow','text',left(p_text,600)))
   || CASE WHEN moved THEN jsonb_build_array(jsonb_build_object('id',p_key||':move','date',now()::text,'kind','movimentacao','source','Pipeflow',
        'text','Movido automaticamente para Tentando Contato após envio de e-mail (antes: '||l.stage||').')) ELSE '[]'::jsonb END
 WHERE id=l.id;
 RETURN CASE WHEN moved THEN 'moved' ELSE 'recorded' END;
END $$;

CREATE OR REPLACE FUNCTION public.finish_crm_campaign_delivery(p_delivery uuid, p_state text, p_message_id text, p_error text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.crm_campaign_deliveries; c public.crm_campaigns;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('accepted','scheduled','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE crm_campaign_deliveries SET state=p_state, provider_message_id=nullif(left(coalesce(p_message_id,''),300),''), error_code=nullif(left(coalesce(p_error,''),120),''), updated_at=now() WHERE id=p_delivery AND state='reserved' RETURNING * INTO d;
 IF d.id IS NULL THEN RETURN false; END IF;
 INSERT INTO crm_campaign_events(campaign_id,lead_id,channel,kind,details) VALUES(d.campaign_id,d.lead_id,'email',p_state,jsonb_build_object('delivery',d.id));
 IF p_state='accepted' AND d.lead_id IS NOT NULL THEN
  SELECT * INTO c FROM crm_campaigns WHERE id=d.campaign_id;
  PERFORM crm_email_sent_effects(d.lead_id,'email-campaign:'||d.id,'E-mail Marketing enviado — campanha "'||c.name||'" · assunto "'||c.subject||'" para '||d.contact||'.');
 END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.settle_crm_campaigns() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer := 0; d record; c record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 FOR d IN UPDATE crm_campaign_deliveries SET state='unknown', error_code='worker_outcome_unknown', updated_at=now() WHERE state='reserved' AND created_at < now() - interval '10 minutes' RETURNING id,campaign_id,lead_id LOOP
  INSERT INTO crm_campaign_events(campaign_id,lead_id,channel,kind,details) VALUES(d.campaign_id,d.lead_id,'email','unknown',jsonb_build_object('delivery',d.id,'reason','worker_outcome_unknown'));
  n := n + 1;
 END LOOP;
 FOR d IN UPDATE crm_campaign_deliveries SET state='accepted', updated_at=now() WHERE state='scheduled' AND scheduled_at < now() - interval '15 minutes' RETURNING id,campaign_id,lead_id,contact LOOP
  IF d.lead_id IS NOT NULL THEN
   SELECT name, subject INTO c FROM crm_campaigns WHERE id=d.campaign_id;
   PERFORM crm_email_sent_effects(d.lead_id,'email-campaign:'||d.id,'E-mail Marketing enviado (agendado) — campanha "'||c.name||'" · assunto "'||c.subject||'" para '||d.contact||'.');
  END IF;
 END LOOP;
 FOR c IN SELECT id FROM crm_campaigns WHERE state IN ('running','scheduled') AND NOT EXISTS (SELECT 1 FROM crm_campaign_deliveries x WHERE x.campaign_id=crm_campaigns.id AND x.state IN ('reserved','scheduled')) AND EXISTS (SELECT 1 FROM crm_campaign_deliveries x WHERE x.campaign_id=crm_campaigns.id) LOOP
  UPDATE crm_campaigns SET state='completed', revision=revision+1, updated_at=now() WHERE id=c.id;
  INSERT INTO crm_campaign_events(campaign_id,channel,kind) VALUES(c.id,'email','dispatch_finished');
 END LOOP;
 RETURN n;
END $$;

CREATE TABLE public.crm_email_flows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 150),
 steps jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(steps)='array' AND jsonb_array_length(steps) <= 10),
 ai_enabled boolean NOT NULL DEFAULT false,
 ai_approved_revision integer,
 ai_approved_at timestamptz,
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused','archived')),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.crm_email_flows TO service_role;
REVOKE ALL ON public.crm_email_flows FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_email_flows ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_email_flows IS 'Sequências de prospecção por e-mail. Com IA, a aprovação vale só para a revisão aprovada; editar exige nova aprovação.';

CREATE TABLE public.crm_email_flow_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 flow_id uuid NOT NULL REFERENCES public.crm_email_flows(id),
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
 contact text NOT NULL CHECK (contact = lower(btrim(contact)) AND char_length(contact) BETWEEN 6 AND 254),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','awaiting_reply','in_conversation','paused','finished','stopped')),
 next_step integer NOT NULL DEFAULT 0 CHECK (next_step >= 0),
 started_at timestamptz NOT NULL DEFAULT now(),
 next_send_at timestamptz,
 last_sent_at timestamptz,
 replied_at timestamptz,
 reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 300),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (flow_id, lead_id)
);
CREATE UNIQUE INDEX crm_email_flow_enrollments_live_contact ON public.crm_email_flow_enrollments (contact) WHERE status IN ('active','awaiting_reply','in_conversation','paused');
CREATE INDEX crm_email_flow_enrollments_due ON public.crm_email_flow_enrollments (next_send_at) WHERE status='active';
GRANT SELECT ON public.crm_email_flow_enrollments TO service_role;
REVOKE ALL ON public.crm_email_flow_enrollments FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_email_flow_enrollments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.crm_email_flow_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 enrollment_id uuid NOT NULL REFERENCES public.crm_email_flow_enrollments(id) ON DELETE CASCADE,
 flow_id uuid NOT NULL REFERENCES public.crm_email_flows(id),
 lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
 direction text NOT NULL CHECK (direction IN ('out','in')),
 kind text NOT NULL CHECK (kind IN ('sequence','reply','inbound')),
 step integer,
 contact text NOT NULL,
 subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
 body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
 ai_personalized boolean NOT NULL DEFAULT false,
 state text NOT NULL CHECK (state IN ('reserved','accepted','failed','unknown','received')),
 provider_message_id text CHECK (char_length(provider_message_id) <= 300),
 gmail_message_id text UNIQUE CHECK (char_length(gmail_message_id) <= 200),
 rfc_message_id text CHECK (char_length(rfc_message_id) <= 500),
 error_code text CHECK (char_length(error_code) <= 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_email_flow_messages_step_once ON public.crm_email_flow_messages (enrollment_id, step) WHERE kind='sequence';
CREATE INDEX crm_email_flow_messages_lead ON public.crm_email_flow_messages (lead_id, created_at);
GRANT SELECT ON public.crm_email_flow_messages TO service_role;
REVOKE ALL ON public.crm_email_flow_messages FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_email_flow_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.crm_email_flow_suggestions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 enrollment_id uuid NOT NULL REFERENCES public.crm_email_flow_enrollments(id) ON DELETE CASCADE,
 lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
 inbound_id uuid NOT NULL UNIQUE REFERENCES public.crm_email_flow_messages(id) ON DELETE CASCADE,
 analysis text NOT NULL DEFAULT '' CHECK (char_length(analysis) <= 2000),
 subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
 body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 10000),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed','unknown','discarded')),
 sent_message_id uuid REFERENCES public.crm_email_flow_messages(id),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_email_flow_suggestions TO service_role;
REVOKE ALL ON public.crm_email_flow_suggestions FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_email_flow_suggestions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_email_flow_suggestions IS 'Sugestões da Gravon IA para respostas recebidas. Só saem após aprovação explícita de uma pessoa.';

CREATE TABLE public.crm_email_flow_runner (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 token text NOT NULL DEFAULT replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 lease_token uuid,
 lease_until timestamptz,
 last_run_at timestamptz,
 last_result jsonb NOT NULL DEFAULT '{}',
 gmail_checked_at timestamptz,
 ai_blocked_reason text NOT NULL DEFAULT ''
);
INSERT INTO public.crm_email_flow_runner (id) VALUES (true);
GRANT SELECT, UPDATE ON public.crm_email_flow_runner TO service_role;
REVOKE ALL ON public.crm_email_flow_runner FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_email_flow_runner ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.crm_email_flow_runner.token IS 'Token privado do executor agendado; lido só pelo pg_cron e pelo servidor. Nunca exibido.';

CREATE FUNCTION public.crm_email_flow_step_due(p_steps jsonb, p_index integer, p_started timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_index >= jsonb_array_length(p_steps) THEN NULL
  ELSE p_started + make_interval(days => greatest(coalesce((p_steps->p_index->>'day')::int,1),1) - 1) END
$$;

CREATE FUNCTION public.claim_crm_email_flow_runner(p_token uuid, p_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ok boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE crm_email_flow_runner SET lease_token=p_token, lease_until=now()+make_interval(secs=>least(greatest(p_seconds,30),300))
  WHERE id AND (lease_until IS NULL OR lease_until < now()) RETURNING true INTO ok;
 RETURN coalesce(ok,false);
END $$;

CREATE FUNCTION public.release_crm_email_flow_runner(p_token uuid, p_result jsonb, p_gmail boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE crm_email_flow_runner SET lease_token=NULL, lease_until=NULL, last_run_at=now(), last_result=coalesce(p_result,'{}'),
  gmail_checked_at=CASE WHEN p_gmail THEN now() ELSE gmail_checked_at END WHERE id AND lease_token=p_token;
END $$;

CREATE FUNCTION public.save_crm_email_flow(p_id uuid, p_revision integer, p_name text, p_steps jsonb, p_ai boolean, p_approve_ai boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f public.crm_email_flows; s jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF jsonb_typeof(p_steps) IS DISTINCT FROM 'array' OR jsonb_array_length(p_steps) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid_steps'; END IF;
 FOR s IN SELECT * FROM jsonb_array_elements(p_steps) LOOP
  IF coalesce((s->>'day')::int,0) < 1 OR char_length(btrim(coalesce(s->>'subject','')))=0 OR char_length(btrim(coalesce(s->>'body','')))=0 THEN RAISE EXCEPTION 'invalid_steps'; END IF;
 END LOOP;
 IF p_id IS NULL THEN
  INSERT INTO crm_email_flows(name,steps,ai_enabled,ai_approved_revision,ai_approved_at)
   VALUES(btrim(p_name),p_steps,p_ai,CASE WHEN p_ai AND p_approve_ai THEN 1 END,CASE WHEN p_ai AND p_approve_ai THEN now() END) RETURNING * INTO f;
 ELSE
  UPDATE crm_email_flows SET name=btrim(p_name), steps=p_steps, ai_enabled=p_ai, revision=revision+1, updated_at=now(),
   ai_approved_revision=CASE WHEN p_ai AND p_approve_ai THEN revision+1 END,
   ai_approved_at=CASE WHEN p_ai AND p_approve_ai THEN now() END
  WHERE id=p_id AND revision=p_revision AND state<>'archived' RETURNING * INTO f;
  IF f.id IS NULL THEN RAISE EXCEPTION 'stale_flow'; END IF;
  UPDATE crm_email_flow_enrollments e SET next_send_at=crm_email_flow_step_due(f.steps,e.next_step,e.started_at),
   status=CASE WHEN e.next_step>=jsonb_array_length(f.steps) THEN 'finished' ELSE e.status END, updated_at=now()
   WHERE e.flow_id=f.id AND e.status='active';
 END IF;
 RETURN to_jsonb(f);
END $$;

CREATE FUNCTION public.set_crm_email_flow_state(p_id uuid, p_revision integer, p_state text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f public.crm_email_flows;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('active','paused','archived') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 SELECT * INTO f FROM crm_email_flows WHERE id=p_id FOR UPDATE;
 IF f.id IS NULL OR f.revision<>p_revision OR f.state='archived' THEN RAISE EXCEPTION 'stale_flow'; END IF;
 IF p_state='active' AND f.ai_enabled AND f.ai_approved_revision IS DISTINCT FROM f.revision THEN RAISE EXCEPTION 'ai_not_approved'; END IF;
 UPDATE crm_email_flows SET state=p_state, revision=revision+1, updated_at=now(),
  ai_approved_revision=CASE WHEN ai_approved_revision=revision THEN revision+1 ELSE ai_approved_revision END
  WHERE id=p_id RETURNING * INTO f;
 IF p_state='archived' THEN
  UPDATE crm_email_flow_enrollments SET status='stopped', reason='Fluxo arquivado', next_send_at=NULL, updated_at=now() WHERE flow_id=p_id AND status IN ('active','paused');
 END IF;
 RETURN to_jsonb(f);
END $$;

CREATE FUNCTION public.enroll_crm_email_flow(p_flow uuid, p_leads uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f public.crm_email_flows; lid uuid; em text; added integer := 0; skipped jsonb := '[]'::jsonb; e_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO f FROM crm_email_flows WHERE id=p_flow FOR SHARE;
 IF f.id IS NULL OR f.state='archived' THEN RAISE EXCEPTION 'flow_unavailable'; END IF;
 IF coalesce(array_length(p_leads,1),0) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid_leads'; END IF;
 FOREACH lid IN ARRAY p_leads LOOP
  SELECT lower(btrim(email)) INTO em FROM leads WHERE id=lid;
  IF em IS NULL OR em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN skipped := skipped || jsonb_build_array(jsonb_build_object('lead',lid,'reason','sem e-mail válido')); CONTINUE; END IF;
  IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=em) OR EXISTS (SELECT 1 FROM crm_campaign_permissions WHERE channel='email' AND contact=em AND withdrawn_at IS NOT NULL) THEN
   skipped := skipped || jsonb_build_array(jsonb_build_object('lead',lid,'reason','descadastrado ou bloqueado')); CONTINUE; END IF;
  e_id := NULL;
  INSERT INTO crm_email_flow_enrollments(flow_id,lead_id,contact,next_send_at) VALUES(p_flow,lid,em,crm_email_flow_step_due(f.steps,0,now()))
   ON CONFLICT DO NOTHING RETURNING id INTO e_id;
  IF e_id IS NULL THEN skipped := skipped || jsonb_build_array(jsonb_build_object('lead',lid,'reason','já participa deste ou de outro fluxo')); ELSE added := added + 1; END IF;
 END LOOP;
 RETURN jsonb_build_object('added',added,'skipped',skipped);
END $$;

CREATE FUNCTION public.set_crm_email_flow_enrollment(p_id uuid, p_action text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.crm_email_flow_enrollments; f public.crm_email_flows;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO e FROM crm_email_flow_enrollments WHERE id=p_id FOR UPDATE;
 IF e.id IS NULL THEN RETURN false; END IF;
 SELECT * INTO f FROM crm_email_flows WHERE id=e.flow_id;
 IF p_action='pause' AND e.status='active' THEN
  UPDATE crm_email_flow_enrollments SET status='paused', reason='Pausado manualmente', updated_at=now() WHERE id=p_id;
 ELSIF p_action='resume' AND e.status='paused' AND e.replied_at IS NULL THEN
  IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=e.contact) THEN RAISE EXCEPTION 'suppressed_contact'; END IF;
  UPDATE crm_email_flow_enrollments SET status=CASE WHEN e.next_step>=jsonb_array_length(f.steps) THEN 'finished' ELSE 'active' END, reason='',
   next_send_at=greatest(now(),coalesce(crm_email_flow_step_due(f.steps,e.next_step,e.started_at),now())), updated_at=now() WHERE id=p_id;
 ELSIF p_action='stop' AND e.status IN ('active','paused','awaiting_reply','in_conversation') THEN
  UPDATE crm_email_flow_enrollments SET status='stopped', reason='Encerrado manualmente', next_send_at=NULL, updated_at=now() WHERE id=p_id;
 ELSE RETURN false; END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.reserve_crm_email_flow_step(p_enrollment uuid, p_step integer, p_subject text, p_body text, p_ai boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.crm_email_flow_enrollments; f public.crm_email_flows; em text; m uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO e FROM crm_email_flow_enrollments WHERE id=p_enrollment FOR UPDATE;
 IF e.id IS NULL OR e.status<>'active' OR e.next_step<>p_step OR e.next_send_at IS NULL OR e.next_send_at>now() OR e.replied_at IS NOT NULL THEN RAISE EXCEPTION 'not_due'; END IF;
 SELECT * INTO f FROM crm_email_flows WHERE id=e.flow_id;
 IF f.state<>'active' THEN RAISE EXCEPTION 'flow_not_active'; END IF;
 IF p_ai AND (NOT f.ai_enabled OR f.ai_approved_revision IS DISTINCT FROM f.revision) THEN RAISE EXCEPTION 'ai_not_approved'; END IF;
 IF p_step >= jsonb_array_length(f.steps) THEN RAISE EXCEPTION 'not_due'; END IF;
 SELECT lower(btrim(email)) INTO em FROM leads WHERE id=e.lead_id FOR SHARE;
 IF em IS DISTINCT FROM e.contact THEN
  UPDATE crm_email_flow_enrollments SET status='paused', reason='E-mail do card mudou; revise antes de retomar', updated_at=now() WHERE id=e.id;
  RAISE EXCEPTION 'contact_changed';
 END IF;
 IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=em) OR EXISTS (SELECT 1 FROM crm_campaign_permissions WHERE channel='email' AND contact=em AND withdrawn_at IS NOT NULL) THEN
  UPDATE crm_email_flow_enrollments SET status='stopped', reason='Descadastrado ou bloqueado', next_send_at=NULL, updated_at=now() WHERE id=e.id;
  RAISE EXCEPTION 'suppressed_contact';
 END IF;
 IF char_length(btrim(coalesce(p_subject,'')))=0 OR char_length(btrim(coalesce(p_body,'')))=0 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 INSERT INTO crm_email_flow_messages(enrollment_id,flow_id,lead_id,direction,kind,step,contact,subject,body,ai_personalized,state)
  VALUES(e.id,e.flow_id,e.lead_id,'out','sequence',p_step,em,left(p_subject,300),left(p_body,20000),p_ai,'reserved') RETURNING id INTO m;
 UPDATE crm_email_flow_enrollments SET next_send_at=NULL, updated_at=now() WHERE id=e.id;
 RETURN m;
END $$;

CREATE FUNCTION public.finish_crm_email_flow_step(p_message uuid, p_state text, p_provider_id text, p_error text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.crm_email_flow_messages; e public.crm_email_flow_enrollments; f public.crm_email_flows; nxt integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE crm_email_flow_messages SET state=p_state, provider_message_id=nullif(left(coalesce(p_provider_id,''),300),''), error_code=nullif(left(coalesce(p_error,''),120),''), updated_at=now()
  WHERE id=p_message AND state='reserved' AND direction='out' AND kind='sequence' RETURNING * INTO m;
 IF m.id IS NULL THEN RETURN 'not_reserved'; END IF;
 SELECT * INTO e FROM crm_email_flow_enrollments WHERE id=m.enrollment_id FOR UPDATE;
 SELECT * INTO f FROM crm_email_flows WHERE id=m.flow_id;
 IF p_state='accepted' THEN
  nxt := m.step + 1;
  UPDATE crm_email_flow_enrollments SET next_step=nxt, last_sent_at=now(), updated_at=now(),
   status=CASE WHEN status<>'active' THEN status WHEN nxt>=jsonb_array_length(f.steps) THEN 'finished' ELSE 'active' END,
   reason=CASE WHEN status='active' AND nxt>=jsonb_array_length(f.steps) THEN 'Sequência concluída sem resposta' ELSE reason END,
   next_send_at=CASE WHEN status='active' THEN crm_email_flow_step_due(f.steps,nxt,e.started_at) END
  WHERE id=e.id;
  PERFORM crm_email_sent_effects(m.lead_id,'email-flow:'||m.id,'E-mail Marketing enviado — fluxo "'||f.name||'" · etapa '||(m.step+1)||' · assunto "'||m.subject||'" para '||m.contact||'.');
  RETURN 'accepted';
 END IF;
 UPDATE crm_email_flow_enrollments SET status=CASE WHEN status='active' THEN 'paused' ELSE status END, next_step=m.step+1, next_send_at=NULL, updated_at=now(),
  reason=CASE WHEN p_state='failed' THEN 'Envio recusado pelo provedor ('||left(coalesce(p_error,''),60)||'); card mantido na etapa' ELSE 'Resultado do envio desconhecido; não foi reenviado' END
  WHERE id=e.id;
 RETURN p_state;
END $$;

CREATE FUNCTION public.record_crm_email_flow_reply(p_enrollment uuid, p_gmail_id text, p_rfc_id text, p_subject text, p_body text, p_opt_out boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.crm_email_flow_enrollments; f public.crm_email_flows; m uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO e FROM crm_email_flow_enrollments WHERE id=p_enrollment FOR UPDATE;
 IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO f FROM crm_email_flows WHERE id=e.flow_id;
 INSERT INTO crm_email_flow_messages(enrollment_id,flow_id,lead_id,direction,kind,contact,subject,body,state,gmail_message_id,rfc_message_id)
  VALUES(e.id,e.flow_id,e.lead_id,'in','inbound',e.contact,left(coalesce(p_subject,''),300),left(coalesce(p_body,''),20000),'received',left(p_gmail_id,200),nullif(left(coalesce(p_rfc_id,''),500),''))
  ON CONFLICT (gmail_message_id) DO NOTHING RETURNING id INTO m;
 IF m IS NULL THEN RETURN NULL; END IF;
 IF p_opt_out THEN
  INSERT INTO b2b_email_suppressions(email,reason) VALUES(e.contact,'Pediu para não receber contatos (resposta ao fluxo de e-mail)') ON CONFLICT (email) DO NOTHING;
  UPDATE crm_email_flow_enrollments SET status='stopped', replied_at=coalesce(replied_at,now()), next_send_at=NULL, reason='Pediu para não receber novos contatos', updated_at=now() WHERE id=e.id;
 ELSE
  UPDATE crm_email_flow_enrollments SET status=CASE WHEN status IN ('stopped') THEN status ELSE 'awaiting_reply' END, replied_at=coalesce(replied_at,now()), next_send_at=NULL,
   reason=CASE WHEN status='stopped' THEN reason ELSE 'Cliente respondeu — aguardando resposta personalizada' END, updated_at=now() WHERE id=e.id;
 END IF;
 IF e.lead_id IS NOT NULL THEN
  UPDATE leads SET history = CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END || jsonb_build_array(jsonb_build_object(
   'id','email-reply:'||m,'date',now()::text,'kind','email_marketing','source','Pipeflow',
   'text',CASE WHEN p_opt_out THEN 'Resposta por e-mail pedindo para não receber contatos (fluxo "'||f.name||'"). Envios encerrados e endereço descadastrado.'
     ELSE 'Resposta recebida por e-mail (fluxo "'||f.name||'"): "'||left(regexp_replace(coalesce(p_body,''),'\s+',' ','g'),280)||'". Envios automáticos pausados.' END))
  WHERE id=e.lead_id;
 END IF;
 RETURN m;
END $$;

CREATE FUNCTION public.save_crm_email_flow_suggestion(p_inbound uuid, p_analysis text, p_subject text, p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.crm_email_flow_messages; s uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO m FROM crm_email_flow_messages WHERE id=p_inbound AND direction='in';
 IF m.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
 INSERT INTO crm_email_flow_suggestions(enrollment_id,lead_id,inbound_id,analysis,subject,body)
  VALUES(m.enrollment_id,m.lead_id,m.id,left(coalesce(p_analysis,''),2000),left(coalesce(p_subject,''),300),left(coalesce(p_body,''),10000))
  ON CONFLICT (inbound_id) DO NOTHING RETURNING id INTO s;
 RETURN s;
END $$;

CREATE FUNCTION public.reserve_crm_email_flow_reply(p_suggestion uuid, p_revision integer, p_subject text, p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.crm_email_flow_suggestions; e public.crm_email_flow_enrollments; m uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO s FROM crm_email_flow_suggestions WHERE id=p_suggestion FOR UPDATE;
 IF s.id IS NULL OR s.state<>'pending' OR s.revision<>p_revision THEN RAISE EXCEPTION 'stale_suggestion'; END IF;
 SELECT * INTO e FROM crm_email_flow_enrollments WHERE id=s.enrollment_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=e.contact) THEN RAISE EXCEPTION 'suppressed_contact'; END IF;
 IF char_length(btrim(coalesce(p_subject,'')))=0 OR char_length(btrim(coalesce(p_body,'')))=0 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 INSERT INTO crm_email_flow_messages(enrollment_id,flow_id,lead_id,direction,kind,contact,subject,body,state)
  VALUES(e.id,e.flow_id,e.lead_id,'out','reply',e.contact,left(p_subject,300),left(p_body,20000),'reserved') RETURNING id INTO m;
 UPDATE crm_email_flow_suggestions SET state='sending', subject=left(p_subject,300), body=left(p_body,10000), sent_message_id=m, revision=revision+1, updated_at=now() WHERE id=s.id;
 RETURN jsonb_build_object('message',m,'contact',e.contact,'inbound',s.inbound_id);
END $$;

CREATE FUNCTION public.finish_crm_email_flow_reply(p_suggestion uuid, p_state text, p_provider_id text, p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.crm_email_flow_suggestions; m public.crm_email_flow_messages; f public.crm_email_flows;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 SELECT * INTO s FROM crm_email_flow_suggestions WHERE id=p_suggestion AND state='sending' FOR UPDATE;
 IF s.id IS NULL THEN RETURN false; END IF;
 UPDATE crm_email_flow_messages SET state=p_state, provider_message_id=nullif(left(coalesce(p_provider_id,''),300),''), error_code=nullif(left(coalesce(p_error,''),120),''), updated_at=now()
  WHERE id=s.sent_message_id AND state='reserved' RETURNING * INTO m;
 UPDATE crm_email_flow_suggestions SET state=CASE p_state WHEN 'accepted' THEN 'sent' ELSE p_state END, updated_at=now() WHERE id=s.id;
 IF p_state='accepted' THEN
  UPDATE crm_email_flow_enrollments SET status=CASE WHEN status='awaiting_reply' THEN 'in_conversation' ELSE status END, reason=CASE WHEN status='awaiting_reply' THEN 'Resposta personalizada enviada; acompanhamento humano' ELSE reason END, updated_at=now() WHERE id=s.enrollment_id;
  SELECT * INTO f FROM crm_email_flows WHERE id=m.flow_id;
  PERFORM crm_email_sent_effects(m.lead_id,'email-flow-reply:'||m.id,'Resposta personalizada aprovada e enviada por e-mail (fluxo "'||f.name||'") · assunto "'||m.subject||'".');
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.discard_crm_email_flow_suggestion(p_suggestion uuid, p_revision integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE crm_email_flow_suggestions SET state='discarded', revision=revision+1, updated_at=now() WHERE id=p_suggestion AND revision=p_revision AND state='pending';
 RETURN FOUND;
END $$;

CREATE FUNCTION public.settle_crm_email_flows() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer := 0; m record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 FOR m IN SELECT id, kind FROM crm_email_flow_messages WHERE state='reserved' AND created_at < now() - interval '10 minutes' LOOP
  IF m.kind='sequence' THEN PERFORM finish_crm_email_flow_step(m.id,'unknown','','worker_outcome_unknown');
  ELSE PERFORM finish_crm_email_flow_reply(s.id,'unknown','','worker_outcome_unknown') FROM crm_email_flow_suggestions s WHERE s.sent_message_id=m.id; END IF;
  n := n + 1;
 END LOOP;
 RETURN n;
END $$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['crm_email_sent_effects(uuid,text,text)','claim_crm_email_flow_runner(uuid,integer)','release_crm_email_flow_runner(uuid,jsonb,boolean)',
  'save_crm_email_flow(uuid,integer,text,jsonb,boolean,boolean)','set_crm_email_flow_state(uuid,integer,text)','enroll_crm_email_flow(uuid,uuid[])',
  'set_crm_email_flow_enrollment(uuid,text)','reserve_crm_email_flow_step(uuid,integer,text,text,boolean)','finish_crm_email_flow_step(uuid,text,text,text)',
  'record_crm_email_flow_reply(uuid,text,text,text,text,boolean)','save_crm_email_flow_suggestion(uuid,text,text,text)','reserve_crm_email_flow_reply(uuid,integer,text,text)',
  'finish_crm_email_flow_reply(uuid,text,text,text)','discard_crm_email_flow_suggestion(uuid,integer)','settle_crm_email_flows()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
 END LOOP;
END $$;