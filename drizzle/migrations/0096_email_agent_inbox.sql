-- Agente Comercial por e-mail: correção da movimentação para Tentando Contato, janela de envio por fluxo,
-- interruptor geral, limite de mensagens por contato e caixa de entrada do Gmail sincronizada nos cards.
-- Tudo service-only. Nenhum envio ocorre por esta migração; nenhum dado existente é alterado.

-- 1) Movimentação após envio aceito. Antes exigia que o próprio card estivesse ligado a uma empresa da
-- Prospecção B2B; cards criados à mão no mesmo funil (ex.: o teste real no Outbound) não andavam.
-- Agora vale para qualquer card de um funil de prospecção (funil que contém cards da Prospecção B2B).
CREATE OR REPLACE FUNCTION public.crm_email_sent_effects(p_lead uuid, p_key text, p_text text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l record; cur_idx bigint; target_idx bigint; moved boolean := false;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_lead IS NULL THEN RETURN 'no_lead'; END IF;
 SELECT id, stage, pipeline_id, history INTO l FROM leads WHERE id=p_lead FOR UPDATE;
 IF l.id IS NULL THEN RETURN 'no_lead'; END IF;
 IF jsonb_typeof(l.history)='array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.history) h WHERE h->>'id'=p_key) THEN RETURN 'duplicate'; END IF;
 IF l.pipeline_id IS NOT NULL AND EXISTS (SELECT 1 FROM b2b_companies b JOIN leads o ON o.id=b.lead_id WHERE o.pipeline_id=l.pipeline_id) THEN
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

-- 2) Janela de envio e limite por fluxo. Padrões preservam o comportamento atual (todos os dias, dia inteiro, até 10 mensagens).
ALTER TABLE public.crm_email_flows
 ADD COLUMN send_days smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
 ADD COLUMN send_start time NOT NULL DEFAULT '00:00',
 ADD COLUMN send_end time NOT NULL DEFAULT '24:00',
 ADD COLUMN max_messages smallint NOT NULL DEFAULT 10;
ALTER TABLE public.crm_email_flows ADD CONSTRAINT crm_email_flows_window CHECK (
 cardinality(send_days) BETWEEN 1 AND 7 AND send_days <@ '{0,1,2,3,4,5,6}'::smallint[] AND send_start < send_end AND max_messages BETWEEN 1 AND 10);

ALTER TABLE public.crm_email_flow_runner
 ADD COLUMN agent_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN inbox_synced_at timestamptz,
 ADD COLUMN inbox_error text NOT NULL DEFAULT '' CHECK (char_length(inbox_error) <= 300);
COMMENT ON COLUMN public.crm_email_flow_runner.agent_enabled IS 'Interruptor geral do Agente Comercial para e-mails. Desligado: respostas continuam sendo lidas, nenhuma etapa é enviada.';

CREATE FUNCTION public.crm_email_flow_in_window(p_days smallint[], p_start time, p_end time, p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT extract(dow FROM p_at AT TIME ZONE 'America/Sao_Paulo')::smallint = ANY(p_days)
  AND (p_at AT TIME ZONE 'America/Sao_Paulo')::time >= p_start AND (p_at AT TIME ZONE 'America/Sao_Paulo')::time < p_end
$$;

CREATE FUNCTION public.save_crm_email_flow_schedule(p_id uuid, p_revision integer, p_days integer[], p_start text, p_end text, p_max integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f public.crm_email_flows; d smallint[];
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT array_agg(DISTINCT x ORDER BY x)::smallint[] INTO d FROM unnest(p_days) x;
 IF d IS NULL OR NOT d <@ '{0,1,2,3,4,5,6}'::smallint[] OR p_start::time >= p_end::time OR p_max NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid_schedule'; END IF;
 -- A janela não muda o conteúdo aprovado: a aprovação da IA acompanha a nova revisão.
 UPDATE crm_email_flows SET send_days=d, send_start=p_start::time, send_end=p_end::time, max_messages=p_max, revision=revision+1, updated_at=now(),
  ai_approved_revision=CASE WHEN ai_approved_revision=revision THEN revision+1 ELSE ai_approved_revision END
  WHERE id=p_id AND revision=p_revision AND state<>'archived' RETURNING * INTO f;
 IF f.id IS NULL THEN RAISE EXCEPTION 'stale_flow'; END IF;
 UPDATE crm_email_flow_enrollments SET status='finished', next_send_at=NULL, reason='Limite de mensagens por contato atingido', updated_at=now()
  WHERE flow_id=f.id AND status='active' AND next_step >= f.max_messages;
 RETURN to_jsonb(f);
END $$;

CREATE FUNCTION public.set_crm_email_agent_enabled(p_enabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE crm_email_flow_runner SET agent_enabled=coalesce(p_enabled,false) WHERE id;
 RETURN coalesce(p_enabled,false);
END $$;

-- 3) Caixa de entrada sincronizada do Gmail: só mensagens enviadas ao endereço comercial ou vindas de contatos com card.
CREATE TABLE public.crm_email_inbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 gmail_message_id text NOT NULL UNIQUE CHECK (char_length(gmail_message_id) BETWEEN 1 AND 200),
 gmail_thread_id text CHECK (char_length(gmail_thread_id) <= 200),
 rfc_message_id text CHECK (char_length(rfc_message_id) <= 500),
 lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
 from_address text NOT NULL CHECK (char_length(from_address) BETWEEN 3 AND 254),
 from_name text NOT NULL DEFAULT '' CHECK (char_length(from_name) <= 200),
 to_address text NOT NULL DEFAULT '' CHECK (char_length(to_address) <= 500),
 subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
 body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
 received_at timestamptz NOT NULL,
 unread boolean NOT NULL DEFAULT false,
 match text NOT NULL DEFAULT 'none' CHECK (match IN ('address','thread','reference','manual','created','none','ambiguous')),
 status text NOT NULL DEFAULT 'review' CHECK (status IN ('linked','review','ignored')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_email_inbox_lead ON public.crm_email_inbox (lead_id, received_at);
CREATE INDEX crm_email_inbox_review ON public.crm_email_inbox (received_at) WHERE status='review';
CREATE INDEX crm_email_inbox_thread ON public.crm_email_inbox (gmail_thread_id);
GRANT SELECT ON public.crm_email_inbox TO service_role;
REVOKE ALL ON public.crm_email_inbox FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_email_inbox ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_email_inbox IS 'E-mails recebidos lidos do Gmail conectado. Remetentes sem card ficam em revisão; nada vira lead sem ação de uma pessoa.';

-- Reserva de etapa: além das regras da 0095, respeita interruptor geral, janela, limite de mensagens e mensagens recebidas.
CREATE OR REPLACE FUNCTION public.reserve_crm_email_flow_step(p_enrollment uuid, p_step integer, p_subject text, p_body text, p_ai boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.crm_email_flow_enrollments; f public.crm_email_flows; em text; m uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF NOT coalesce((SELECT agent_enabled FROM crm_email_flow_runner WHERE id),false) THEN RAISE EXCEPTION 'agent_disabled'; END IF;
 SELECT * INTO e FROM crm_email_flow_enrollments WHERE id=p_enrollment FOR UPDATE;
 IF e.id IS NULL OR e.status<>'active' OR e.next_step<>p_step OR e.next_send_at IS NULL OR e.next_send_at>now() OR e.replied_at IS NOT NULL THEN RAISE EXCEPTION 'not_due'; END IF;
 SELECT * INTO f FROM crm_email_flows WHERE id=e.flow_id;
 IF f.state<>'active' THEN RAISE EXCEPTION 'flow_not_active'; END IF;
 IF p_ai AND (NOT f.ai_enabled OR f.ai_approved_revision IS DISTINCT FROM f.revision) THEN RAISE EXCEPTION 'ai_not_approved'; END IF;
 IF p_step >= jsonb_array_length(f.steps) THEN RAISE EXCEPTION 'not_due'; END IF;
 IF p_step >= f.max_messages THEN
  UPDATE crm_email_flow_enrollments SET status='finished', next_send_at=NULL, reason='Limite de mensagens por contato atingido', updated_at=now() WHERE id=e.id;
  RETURN NULL;
 END IF;
 IF NOT crm_email_flow_in_window(f.send_days, f.send_start, f.send_end, now()) THEN RAISE EXCEPTION 'outside_window'; END IF;
 SELECT lower(btrim(email)) INTO em FROM leads WHERE id=e.lead_id FOR SHARE;
 IF em IS DISTINCT FROM e.contact THEN
  UPDATE crm_email_flow_enrollments SET status='paused', reason='E-mail do card mudou; revise antes de retomar', updated_at=now() WHERE id=e.id;
  RETURN NULL;
 END IF;
 IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=em) OR EXISTS (SELECT 1 FROM crm_campaign_permissions WHERE channel='email' AND contact=em AND withdrawn_at IS NOT NULL) THEN
  UPDATE crm_email_flow_enrollments SET status='stopped', reason='Descadastrado ou bloqueado', next_send_at=NULL, updated_at=now() WHERE id=e.id;
  RETURN NULL;
 END IF;
 -- Mensagem recebida do contato depois do último envio e ainda não tratada: na dúvida, não envia.
 IF EXISTS (SELECT 1 FROM crm_email_inbox i WHERE i.lead_id=e.lead_id AND i.received_at >= coalesce(e.last_sent_at, e.started_at)) THEN
  UPDATE crm_email_flow_enrollments SET status='paused', next_send_at=NULL, reason='Mensagem recebida do contato; revise antes de retomar', updated_at=now() WHERE id=e.id;
  RETURN NULL;
 END IF;
 IF char_length(btrim(coalesce(p_subject,'')))=0 OR char_length(btrim(coalesce(p_body,'')))=0 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 INSERT INTO crm_email_flow_messages(enrollment_id,flow_id,lead_id,direction,kind,step,contact,subject,body,ai_personalized,state)
  VALUES(e.id,e.flow_id,e.lead_id,'out','sequence',p_step,em,left(p_subject,300),left(p_body,20000),p_ai,'reserved') RETURNING id INTO m;
 UPDATE crm_email_flow_enrollments SET next_send_at=NULL, updated_at=now() WHERE id=e.id;
 RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.finish_crm_email_flow_step(p_message uuid, p_state text, p_provider_id text, p_error text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.crm_email_flow_messages; e public.crm_email_flow_enrollments; f public.crm_email_flows; nxt integer; total integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE crm_email_flow_messages SET state=p_state, provider_message_id=nullif(left(coalesce(p_provider_id,''),300),''), error_code=nullif(left(coalesce(p_error,''),120),''), updated_at=now()
  WHERE id=p_message AND state='reserved' AND direction='out' AND kind='sequence' RETURNING * INTO m;
 IF m.id IS NULL THEN RETURN 'not_reserved'; END IF;
 SELECT * INTO e FROM crm_email_flow_enrollments WHERE id=m.enrollment_id FOR UPDATE;
 SELECT * INTO f FROM crm_email_flows WHERE id=m.flow_id;
 total := least(jsonb_array_length(f.steps), f.max_messages);
 IF p_state='accepted' THEN
  nxt := m.step + 1;
  UPDATE crm_email_flow_enrollments SET next_step=nxt, last_sent_at=now(), updated_at=now(),
   status=CASE WHEN status<>'active' THEN status WHEN nxt>=total THEN 'finished' ELSE 'active' END,
   reason=CASE WHEN status='active' AND nxt>=total THEN 'Sequência concluída sem resposta' ELSE reason END,
   next_send_at=CASE WHEN status='active' AND nxt<total THEN crm_email_flow_step_due(f.steps,nxt,e.started_at) END
  WHERE id=e.id;
  PERFORM crm_email_sent_effects(m.lead_id,'email-flow:'||m.id,'E-mail Marketing enviado — fluxo "'||f.name||'" · etapa '||(m.step+1)||' · assunto "'||m.subject||'" para '||m.contact||'.');
  RETURN 'accepted';
 END IF;
 UPDATE crm_email_flow_enrollments SET status=CASE WHEN status='active' THEN 'paused' ELSE status END, next_step=m.step+1, next_send_at=NULL, updated_at=now(),
  reason=CASE WHEN p_state='failed' THEN 'Envio recusado pelo provedor ('||left(coalesce(p_error,''),60)||'); card mantido na etapa' ELSE 'Resultado do envio desconhecido; não foi reenviado' END
  WHERE id=e.id;
 RETURN p_state;
END $$;

CREATE FUNCTION public.crm_email_norm_id(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT nullif(lower(btrim(coalesce(v,''),' <>')),'')
$$;

CREATE FUNCTION public.crm_email_inbox_history(p_lead uuid, p_inbox uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.crm_email_inbox; k text := 'email-inbox:'||p_inbox;
BEGIN
 SELECT * INTO i FROM crm_email_inbox WHERE id=p_inbox;
 IF i.id IS NULL OR p_lead IS NULL THEN RETURN; END IF;
 UPDATE leads SET history = CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END || jsonb_build_array(jsonb_build_object(
   'id',k,'date',i.received_at::text,'kind','email_marketing','source','Gmail',
   'text','E-mail recebido de '||i.from_address||' · assunto "'||left(i.subject,150)||'": "'||left(regexp_replace(i.body,'\s+',' ','g'),240)||'"'))
  WHERE id=p_lead AND NOT (jsonb_typeof(history)='array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(history) h WHERE h->>'id'=k));
END $$;

CREATE FUNCTION public.record_crm_email_inbox(p jsonb, p_refs text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE gid text := left(btrim(coalesce(p->>'gmailId','')),200); frm text := lower(btrim(coalesce(p->>'from','')));
 existing public.crm_email_inbox; lid uuid; n integer; how text := 'none'; refs text[]; rid uuid; st text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF gid='' OR frm !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN RAISE EXCEPTION 'invalid_message'; END IF;
 SELECT * INTO existing FROM crm_email_inbox WHERE gmail_message_id=gid FOR UPDATE;
 IF existing.id IS NOT NULL THEN
  UPDATE crm_email_inbox SET unread=coalesce((p->>'unread')::boolean,unread), updated_at=now() WHERE id=existing.id;
  RETURN jsonb_build_object('id',existing.id,'lead',existing.lead_id,'new',false,'status',existing.status);
 END IF;
 SELECT count(*), (array_agg(id))[1] INTO n, lid FROM leads WHERE lower(btrim(email))=frm;
 IF n=1 THEN how := 'address';
 ELSIF n>1 THEN how := 'ambiguous'; lid := NULL;
 ELSE
  lid := NULL;
  IF nullif(p->>'threadId','') IS NOT NULL THEN
   SELECT count(DISTINCT lead_id), (array_agg(DISTINCT lead_id))[1] INTO n, lid FROM crm_email_inbox WHERE gmail_thread_id=p->>'threadId' AND lead_id IS NOT NULL;
   IF n=1 THEN how := 'thread'; ELSE lid := NULL; END IF;
  END IF;
  IF lid IS NULL THEN
   SELECT array_agg(crm_email_norm_id(r)) INTO refs FROM unnest(coalesce(p_refs,'{}')) r WHERE crm_email_norm_id(r) IS NOT NULL;
   IF refs IS NOT NULL THEN
    SELECT count(DISTINCT x.lead_id), (array_agg(DISTINCT x.lead_id))[1] INTO n, lid FROM (
      SELECT lead_id FROM crm_campaign_deliveries WHERE crm_email_norm_id(provider_message_id) = ANY(refs) AND lead_id IS NOT NULL
      UNION ALL SELECT lead_id FROM crm_email_flow_messages WHERE (crm_email_norm_id(provider_message_id) = ANY(refs) OR crm_email_norm_id(rfc_message_id) = ANY(refs)) AND lead_id IS NOT NULL) x;
    IF n=1 THEN how := 'reference'; ELSE lid := NULL; END IF;
   END IF;
  END IF;
 END IF;
 st := CASE WHEN lid IS NOT NULL THEN 'linked' ELSE 'review' END;
 INSERT INTO crm_email_inbox(gmail_message_id,gmail_thread_id,rfc_message_id,lead_id,from_address,from_name,to_address,subject,body,received_at,unread,match,status)
  VALUES(gid,nullif(left(coalesce(p->>'threadId',''),200),''),nullif(left(coalesce(p->>'rfcId',''),500),''),lid,left(frm,254),left(coalesce(p->>'fromName',''),200),
   left(coalesce(p->>'to',''),500),left(coalesce(p->>'subject',''),300),left(coalesce(p->>'body',''),20000),coalesce((p->>'receivedAt')::timestamptz,now()),
   coalesce((p->>'unread')::boolean,false),how,st)
  ON CONFLICT (gmail_message_id) DO NOTHING RETURNING id INTO rid;
 IF rid IS NULL THEN RETURN jsonb_build_object('id',NULL,'lead',NULL,'new',false,'status','duplicate'); END IF;
 IF lid IS NOT NULL THEN PERFORM crm_email_inbox_history(lid, rid); END IF;
 RETURN jsonb_build_object('id',rid,'lead',lid,'new',true,'status',st,'match',how);
END $$;

CREATE FUNCTION public.resolve_crm_email_inbox(p_id uuid, p_action text, p_lead uuid, p_pipeline uuid, p_name text, p_company text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.crm_email_inbox; lid uuid; stage_id text := 'lead-novo';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO i FROM crm_email_inbox WHERE id=p_id FOR UPDATE;
 IF i.id IS NULL OR i.status<>'review' THEN RAISE EXCEPTION 'stale_inbox'; END IF;
 IF p_action='ignore' THEN
  UPDATE crm_email_inbox SET status='ignored', updated_at=now() WHERE id=i.id;
  RETURN jsonb_build_object('status','ignored');
 ELSIF p_action='link' THEN
  SELECT id INTO lid FROM leads WHERE id=p_lead;
  IF lid IS NULL THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  UPDATE crm_email_inbox SET lead_id=lid, status='linked', match='manual', updated_at=now() WHERE id=i.id;
 ELSIF p_action='create' THEN
  IF char_length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF EXISTS (SELECT 1 FROM leads WHERE lower(btrim(email))=i.from_address) THEN RAISE EXCEPTION 'lead_exists'; END IF;
  IF p_pipeline IS NOT NULL THEN
   SELECT p.stages->0->>'id' INTO stage_id FROM sales_pipelines p WHERE p.id=p_pipeline AND NOT p.archived;
   IF stage_id IS NULL THEN RAISE EXCEPTION 'pipeline_not_found'; END IF;
  END IF;
  INSERT INTO leads(name,company,email,source,stage,pipeline_id,history)
   VALUES(btrim(p_name),left(btrim(coalesce(p_company,'')),150),i.from_address,'E-mail',stage_id,p_pipeline,
    jsonb_build_array(jsonb_build_object('id','email-inbox-create:'||i.id,'date',now()::text,'kind','criacao','source','Pipeflow',
     'text','Card criado a partir de e-mail recebido de '||i.from_address||' (revisado por uma pessoa).')))
   RETURNING id INTO lid;
  UPDATE crm_email_inbox SET lead_id=lid, status='linked', match='created', updated_at=now() WHERE id=i.id;
 ELSE RAISE EXCEPTION 'invalid_action'; END IF;
 PERFORM crm_email_inbox_history(lid, i.id);
 RETURN jsonb_build_object('status','linked','lead',lid);
END $$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['crm_email_flow_in_window(smallint[],time,time,timestamptz)','save_crm_email_flow_schedule(uuid,integer,integer[],text,text,integer)',
  'set_crm_email_agent_enabled(boolean)','crm_email_norm_id(text)','crm_email_inbox_history(uuid,uuid)','record_crm_email_inbox(jsonb,text[])',
  'resolve_crm_email_inbox(uuid,text,uuid,uuid,text,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
 END LOOP;
END $$;