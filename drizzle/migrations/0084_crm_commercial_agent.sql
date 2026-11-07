-- Agente Comercial — Gravon IA, configurado individualmente por funil (CRM original, crm:1).
-- Adaptado do agente Gravon Tech do Pipeflow Multiempresas (lovable-sync 0084–0087) sem IDs fixos:
-- cada funil tem sua configuração, sempre desligada por padrão. Tudo é service-only.
-- Idempotente: pode ser reaplicada sem duplicar objetos; não insere configurações nem altera dados existentes.

CREATE OR REPLACE FUNCTION public.crm_agent_now() RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS $$
 -- Deterministic clock for isolated tests; production never sets this service-only setting.
 SELECT coalesce(nullif(current_setting('crm_agent.now',true),'')::timestamptz, now())
$$;

CREATE TABLE IF NOT EXISTS public.crm_agent_settings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pipeline_id uuid REFERENCES public.sales_pipelines(id), -- NULL = Funil principal
 enabled boolean NOT NULL DEFAULT false,
 audience text NOT NULL DEFAULT 'test' CHECK (audience IN ('test','all')),
 instance text NOT NULL DEFAULT '' CHECK (char_length(instance)<=160),
 sender_phone text NOT NULL DEFAULT '' CHECK (sender_phone='' OR sender_phone ~ '^[1-9][0-9]{9,14}$'),
 recipients text[] NOT NULL DEFAULT '{}' CHECK (cardinality(recipients)<=20),
 allowed_stages text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_stages)<=100),
 instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions)<=4000),
 served_regions text[] NOT NULL DEFAULT '{}' CHECK (cardinality(served_regions)<=50),
 excluded_regions text[] NOT NULL DEFAULT '{}' CHECK (cardinality(excluded_regions)<=50),
 services text[] NOT NULL DEFAULT '{}' CHECK (cardinality(services)<=50),
 qualification_requirements text NOT NULL DEFAULT '' CHECK (char_length(qualification_requirements)<=2000),
 stage_map jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(stage_map)='object'),
 auto_move boolean NOT NULL DEFAULT true,
 handoff_keywords text[] NOT NULL DEFAULT '{}' CHECK (cardinality(handoff_keywords)<=50),
 pause_on_human_reply boolean NOT NULL DEFAULT true,
 human_pause_hours integer NOT NULL DEFAULT 24 CHECK (human_pause_hours BETWEEN 1 AND 720),
 business_days integer[] NOT NULL DEFAULT '{1,2,3,4,5}' CHECK (business_days <@ ARRAY[0,1,2,3,4,5,6]),
 day_start time NOT NULL DEFAULT '08:00',
 day_end time NOT NULL DEFAULT '18:00',
 max_replies_per_contact_day integer NOT NULL DEFAULT 10 CHECK (max_replies_per_contact_day BETWEEN 1 AND 50),
 max_replies_per_day integer NOT NULL DEFAULT 100 CHECK (max_replies_per_day BETWEEN 1 AND 1000),
 max_reply_chars integer NOT NULL DEFAULT 600 CHECK (max_reply_chars BETWEEN 100 AND 800),
 max_message_age_minutes integer NOT NULL DEFAULT 10 CHECK (max_message_age_minutes BETWEEN 1 AND 60),
 blocked_reason text,
 revision bigint NOT NULL DEFAULT 0,
 updated_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (day_start < day_end)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_agent_settings_pipeline ON public.crm_agent_settings((coalesce(pipeline_id,'00000000-0000-0000-0000-000000000000'::uuid)));

CREATE TABLE IF NOT EXISTS public.crm_agent_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 settings_id uuid NOT NULL REFERENCES public.crm_agent_settings(id),
 pipeline_id uuid,
 lead_id uuid,
 inbound_id text NOT NULL UNIQUE,
 instance text NOT NULL,
 phone text NOT NULL,
 contact_key text NOT NULL,
 from_stage text,
 lead_revision bigint,
 settings_revision bigint NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','analyzing','sending','accepted','completed','human','skipped','unknown','failed')),
 lease_until timestamptz,
 analysis jsonb,
 reply text,
 reason text,
 provider_id text,
 accepted_at timestamptz,
 synced_at timestamptz,
 decision_result text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_agent_runs_contact ON public.crm_agent_runs(contact_key, status);
CREATE INDEX IF NOT EXISTS crm_agent_runs_settings ON public.crm_agent_runs(settings_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_agent_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 settings_id uuid,
 run_id uuid,
 lead_id uuid,
 event text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',
 actor_id uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_agent_audit_settings ON public.crm_agent_audit(settings_id, created_at DESC);
CREATE OR REPLACE FUNCTION public.crm_agent_audit_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'append_only' USING ERRCODE='42501'; END $$;
DROP TRIGGER IF EXISTS crm_agent_audit_append_only ON public.crm_agent_audit;
CREATE TRIGGER crm_agent_audit_append_only BEFORE UPDATE OR DELETE ON public.crm_agent_audit FOR EACH ROW EXECUTE FUNCTION public.crm_agent_audit_append_only();

-- Contact-level human handoff: applies to every funnel's agent.
CREATE TABLE IF NOT EXISTS public.crm_agent_holds (
 contact_key text PRIMARY KEY,
 reason text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 released_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS agent_run_id uuid;
COMMENT ON COLUMN public.whatsapp_messages.agent_run_id IS 'Commercial Agent run that produced this accepted reply (message_source=commercial_agent).';

REVOKE ALL ON public.crm_agent_settings, public.crm_agent_runs, public.crm_agent_audit, public.crm_agent_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_agent_settings, public.crm_agent_runs, public.crm_agent_holds TO service_role;
GRANT SELECT, INSERT ON public.crm_agent_audit TO service_role;
ALTER TABLE public.crm_agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_agent_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_agent_holds ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.crm_agent_text_array(p jsonb, p_max integer, p_len integer) RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE out text[]; BEGIN
 IF p IS NULL OR p='null'::jsonb THEN RETURN '{}'; END IF;
 IF jsonb_typeof(p)<>'array' OR jsonb_array_length(p)>p_max THEN RAISE EXCEPTION 'invalid_settings' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(DISTINCT btrim(v)),'{}') INTO out FROM jsonb_array_elements_text(p) v WHERE btrim(v)<>'';
 IF EXISTS(SELECT 1 FROM unnest(out) x WHERE char_length(x)>p_len) THEN RAISE EXCEPTION 'invalid_settings' USING ERRCODE='22023'; END IF;
 RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.save_crm_agent_settings(p_actor uuid, p_pipeline uuid, p_revision bigint, p_config jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.crm_agent_settings%ROWTYPE; stages jsonb; ids text[]; v_enabled boolean; v_audience text; v_recipients text[]; v_allowed text[]; v_map jsonb; v_sender text; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_config)<>'object' THEN RAISE EXCEPTION 'invalid_settings' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-settings:'||coalesce(p_pipeline::text,'main'),0));
 IF p_pipeline IS NOT NULL THEN
  SELECT p.stages INTO stages FROM public.sales_pipelines p WHERE p.id=p_pipeline AND NOT p.archived FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_pipeline' USING ERRCODE='22023'; END IF;
  SELECT array_agg(x->>'id') INTO ids FROM jsonb_array_elements(stages) x;
 END IF;
 v_enabled:=coalesce((p_config->>'enabled')::boolean,false);
 v_audience:=coalesce(p_config->>'audience','test');
 v_sender:=public.crm_phone_digits(coalesce(p_config->>'senderPhone',''));
 v_recipients:=ARRAY(SELECT public.crm_phone_digits(x) FROM unnest(public.crm_agent_text_array(p_config->'recipients',20,40)) x);
 v_allowed:=public.crm_agent_text_array(p_config->'allowedStages',100,80);
 v_map:=coalesce(p_config->'stageMap','{}'::jsonb);
 IF jsonb_typeof(v_map)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(v_map) e WHERE e.key NOT IN ('novo','atendimento','qualificado') OR jsonb_typeof(e.value)<>'string') THEN RAISE EXCEPTION 'invalid_settings' USING ERRCODE='22023'; END IF;
 v_map:=(SELECT coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) FROM jsonb_each_text(v_map) e WHERE e.value<>'');
 IF EXISTS(SELECT 1 FROM unnest(v_recipients) x WHERE x !~ '^[1-9][0-9]{9,14}$') OR (v_sender<>'' AND v_sender !~ '^[1-9][0-9]{9,14}$') THEN RAISE EXCEPTION 'invalid_number' USING ERRCODE='22023'; END IF;
 IF ids IS NOT NULL AND (EXISTS(SELECT 1 FROM unnest(v_allowed) x WHERE NOT x=ANY(ids)) OR EXISTS(SELECT 1 FROM jsonb_each_text(v_map) e WHERE NOT e.value=ANY(ids))) THEN RAISE EXCEPTION 'unknown_stage' USING ERRCODE='22023'; END IF;
 IF v_audience NOT IN ('test','all') THEN RAISE EXCEPTION 'invalid_settings' USING ERRCODE='22023'; END IF;
 IF v_enabled THEN
  IF coalesce(p_config->>'instance','')='' OR v_sender='' OR cardinality(v_allowed)=0 THEN RAISE EXCEPTION 'incomplete_settings' USING ERRCODE='22023'; END IF;
  IF v_audience='test' AND (cardinality(v_recipients)=0 OR EXISTS(SELECT 1 FROM unnest(v_recipients) x WHERE public.crm_same_whatsapp(x,v_sender))) THEN RAISE EXCEPTION 'test_numbers_required' USING ERRCODE='22023'; END IF;
  IF v_audience='all' AND coalesce((p_config->>'confirmAllAudience')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'audience_confirmation_required' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT * INTO s FROM public.crm_agent_settings WHERE pipeline_id IS NOT DISTINCT FROM p_pipeline FOR UPDATE;
 IF NOT FOUND THEN
  IF p_revision<>0 THEN RAISE EXCEPTION 'settings_changed' USING ERRCODE='40001'; END IF;
  INSERT INTO public.crm_agent_settings(pipeline_id) VALUES(p_pipeline) RETURNING * INTO s;
 ELSIF s.revision<>p_revision THEN RAISE EXCEPTION 'settings_changed' USING ERRCODE='40001'; END IF;
 UPDATE public.crm_agent_settings SET enabled=v_enabled, audience=v_audience, instance=coalesce(p_config->>'instance',''), sender_phone=v_sender,
  recipients=v_recipients, allowed_stages=v_allowed, instructions=coalesce(p_config->>'instructions',''),
  served_regions=public.crm_agent_text_array(p_config->'servedRegions',50,120), excluded_regions=public.crm_agent_text_array(p_config->'excludedRegions',50,120),
  services=public.crm_agent_text_array(p_config->'services',50,160), qualification_requirements=coalesce(p_config->>'requirements',''),
  stage_map=v_map, auto_move=coalesce((p_config->>'autoMove')::boolean,true), handoff_keywords=public.crm_agent_text_array(p_config->'handoffKeywords',50,80),
  pause_on_human_reply=coalesce((p_config->>'pauseOnHumanReply')::boolean,true), human_pause_hours=coalesce((p_config->>'humanPauseHours')::integer,24),
  business_days=coalesce(ARRAY(SELECT (x)::integer FROM jsonb_array_elements_text(p_config->'businessDays') x),'{1,2,3,4,5}'),
  day_start=coalesce((p_config->>'dayStart')::time,'08:00'), day_end=coalesce((p_config->>'dayEnd')::time,'18:00'),
  max_replies_per_contact_day=coalesce((p_config->>'maxRepliesPerContactDay')::integer,10), max_replies_per_day=coalesce((p_config->>'maxRepliesPerDay')::integer,100),
  max_reply_chars=coalesce((p_config->>'maxReplyChars')::integer,600), max_message_age_minutes=coalesce((p_config->>'maxMessageAgeMinutes')::integer,10),
  blocked_reason=NULL, revision=s.revision+1, updated_by=p_actor, updated_at=now()
 WHERE id=s.id RETURNING * INTO s;
 INSERT INTO public.crm_agent_audit(settings_id,event,actor_id,detail) VALUES(s.id,'configuration',p_actor,
  jsonb_build_object('enabled',s.enabled,'audience',s.audience,'recipients',cardinality(s.recipients),'allowedStages',s.allowed_stages,'revision',s.revision));
 RETURN to_jsonb(s);
END $$;

CREATE OR REPLACE FUNCTION public.block_crm_agent(p_settings uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 UPDATE public.crm_agent_settings SET blocked_reason=left(coalesce(p_reason,'Agente pausado.'),300) WHERE id=p_settings;
 INSERT INTO public.crm_agent_audit(settings_id,event,detail) VALUES(p_settings,'blocked',jsonb_build_object('reason',left(p_reason,300)));
END $$;

-- Messages typed by a person (phone or CRM chat, or a human-reviewed send) — never automated replies.
CREATE OR REPLACE FUNCTION public.crm_agent_human_since(p_instance text, p_contact text, p_since timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.whatsapp_messages w WHERE w.instance=p_instance AND w.phone_key=p_contact AND w.from_me AND w.sent_at>p_since
  AND (w.send_state IS NULL OR w.message_source='analysis_review') AND coalesce(w.message_source,'') NOT IN ('commercial_agent','gravon_ai')
  AND NOT EXISTS(SELECT 1 FROM public.crm_agent_runs x WHERE x.provider_id=w.message_id)
  AND NOT EXISTS(SELECT 1 FROM public.crm_agent_runs x WHERE x.contact_key=p_contact AND x.reply=w.body AND x.status IN ('sending','accepted','completed','unknown')
   AND w.sent_at BETWEEN x.updated_at-interval '5 minutes' AND x.updated_at+interval '5 minutes'))
$$;

CREATE OR REPLACE FUNCTION public.crm_agent_day_start() RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT date_trunc('day', public.crm_agent_now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
$$;

-- Takes the newest pending run of a contact when nothing else is in flight for it.
CREATE OR REPLACE FUNCTION public.claim_next_crm_agent_run(p_contact text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_agent_runs%ROWTYPE; s public.crm_agent_settings%ROWTYPE; sent timestamptz; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-contact:'||p_contact,0));
 IF EXISTS(SELECT 1 FROM public.crm_agent_runs WHERE contact_key=p_contact AND (status='sending' OR (status='analyzing' AND lease_until>public.crm_agent_now()))) THEN
  RETURN jsonb_build_object('status','queued'); END IF;
 SELECT * INTO r FROM public.crm_agent_runs WHERE contact_key=p_contact AND status='pending' ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','none'); END IF;
 UPDATE public.crm_agent_runs SET status='skipped', reason='Mensagem substituída por outra mais recente do mesmo contato.', updated_at=now()
  WHERE contact_key=p_contact AND status='pending' AND id<>r.id;
 SELECT * INTO s FROM public.crm_agent_settings WHERE id=r.settings_id;
 SELECT w.sent_at INTO sent FROM public.whatsapp_messages w WHERE w.message_id=r.inbound_id;
 IF NOT s.enabled OR s.blocked_reason IS NOT NULL OR s.revision<>r.settings_revision OR sent IS NULL OR sent<public.crm_agent_now()-make_interval(mins=>s.max_message_age_minutes) THEN
  UPDATE public.crm_agent_runs SET status='skipped', reason='Mensagem antiga ou configuração alterada antes da análise.', updated_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('status','skipped','reason','stale');
 END IF;
 UPDATE public.crm_agent_runs SET status='analyzing', lease_until=public.crm_agent_now()+interval '3 minutes', updated_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('status','claimed','run',to_jsonb(r));
END $$;

CREATE OR REPLACE FUNCTION public.claim_crm_agent(p_instance text, p_inbound text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.whatsapp_messages%ROWTYPE; s public.crm_agent_settings%ROWTYPE; l record; k text; n integer; reason text; st text := 'pending'; human boolean := false; local timestamp; run_id uuid; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE message_id=p_inbound AND instance=p_instance;
 IF NOT FOUND OR m.from_me OR coalesce(m.remote_jid,'') !~ '^[0-9]{10,15}@s\.whatsapp\.net$' THEN RETURN jsonb_build_object('status','ignored','reason','not_inbound'); END IF;
 IF EXISTS(SELECT 1 FROM public.crm_agent_runs WHERE inbound_id=p_inbound) THEN RETURN jsonb_build_object('status','duplicate'); END IF;
 k:=public.crm_phone_key(m.phone);
 -- Which funnel answers is decided by the contact's card; an agent never answers outside its funnel.
 SELECT count(*) INTO n FROM public.leads x JOIN public.crm_agent_settings c ON c.pipeline_id IS NOT DISTINCT FROM x.pipeline_id
  WHERE c.enabled AND public.crm_phone_key(x.whatsapp)=k AND (x.pipeline_id IS NULL OR EXISTS(SELECT 1 FROM public.sales_pipelines p WHERE p.id=x.pipeline_id AND NOT p.archived));
 IF n=0 THEN RETURN jsonb_build_object('status','ignored','reason','no_agent'); END IF;
 IF n>1 THEN
  INSERT INTO public.crm_agent_audit(event,detail) VALUES('ambiguous_contact',jsonb_build_object('inbound',p_inbound,'cards',n));
  RETURN jsonb_build_object('status','ignored','reason','ambiguous_contact');
 END IF;
 SELECT x.id, x.stage, x.pipeline_id, x.gravon_change_revision AS revision INTO l FROM public.leads x JOIN public.crm_agent_settings c ON c.pipeline_id IS NOT DISTINCT FROM x.pipeline_id
  WHERE c.enabled AND public.crm_phone_key(x.whatsapp)=k AND (x.pipeline_id IS NULL OR EXISTS(SELECT 1 FROM public.sales_pipelines p WHERE p.id=x.pipeline_id AND NOT p.archived));
 SELECT * INTO s FROM public.crm_agent_settings WHERE pipeline_id IS NOT DISTINCT FROM l.pipeline_id;
 IF s.instance<>p_instance THEN RETURN jsonb_build_object('status','ignored','reason','other_instance'); END IF;
 IF public.crm_same_whatsapp(m.phone,s.sender_phone) THEN RETURN jsonb_build_object('status','ignored','reason','own_number'); END IF;
 IF s.audience='test' AND NOT EXISTS(SELECT 1 FROM unnest(s.recipients) x WHERE public.crm_same_whatsapp(x,m.phone)) THEN RETURN jsonb_build_object('status','ignored','reason','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-contact:'||k,0));
 local:=public.crm_agent_now() AT TIME ZONE 'America/Sao_Paulo';
 IF s.blocked_reason IS NOT NULL THEN st:='skipped'; reason:='Agente pausado: '||s.blocked_reason;
 ELSIF coalesce(m.media_type,'')<>'' THEN st:='human'; human:=true; reason:='Mídia não interpretada pela IA; atendimento humano necessário.';
 ELSIF m.sent_at<public.crm_agent_now()-make_interval(mins=>s.max_message_age_minutes) THEN st:='skipped'; reason:='Mensagem antiga demais para resposta automática.';
 ELSIF NOT (l.stage=ANY(s.allowed_stages)) THEN st:='skipped'; reason:='Etapa do card não autorizada para o agente.';
 ELSIF EXISTS(SELECT 1 FROM public.crm_agent_holds h WHERE h.contact_key=k AND h.active) THEN st:='skipped'; reason:='Contato em atendimento humano.';
 ELSIF s.pause_on_human_reply AND public.crm_agent_human_since(p_instance,k,public.crm_agent_now()-make_interval(hours=>s.human_pause_hours)) THEN st:='skipped'; reason:='Atendimento humano recente; agente pausado para este contato.';
 ELSIF NOT (extract(dow FROM local)::integer=ANY(s.business_days) AND local::time>=s.day_start AND local::time<s.day_end) THEN st:='skipped'; reason:='Fora do horário de atendimento configurado.';
 ELSIF EXISTS(SELECT 1 FROM public.crm_agent_runs x WHERE x.contact_key=k AND x.status IN ('sending','unknown')) THEN st:='skipped'; reason:='Envio anterior sem confirmação para este contato.';
 ELSIF (SELECT count(*) FROM public.crm_agent_runs x WHERE x.contact_key=k AND x.status IN ('sending','accepted','completed','unknown') AND x.created_at>=public.crm_agent_day_start())>=s.max_replies_per_contact_day THEN st:='skipped'; reason:='Limite diário de respostas para este contato atingido.';
 ELSIF (SELECT count(*) FROM public.crm_agent_runs x WHERE x.settings_id=s.id AND x.status IN ('sending','accepted','completed','unknown') AND x.created_at>=public.crm_agent_day_start())>=s.max_replies_per_day THEN st:='skipped'; reason:='Limite diário de respostas do funil atingido.';
 END IF;
 INSERT INTO public.crm_agent_runs(settings_id,pipeline_id,lead_id,inbound_id,instance,phone,contact_key,from_stage,lead_revision,settings_revision,status,reason)
 VALUES(s.id,l.pipeline_id,l.id,p_inbound,p_instance,m.phone,k,l.stage,l.revision,s.revision,st,reason) ON CONFLICT(inbound_id) DO NOTHING RETURNING id INTO run_id;
 IF run_id IS NULL THEN RETURN jsonb_build_object('status','duplicate'); END IF;
 INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(s.id,run_id,l.id,CASE WHEN st='pending' THEN 'received' ELSE st END,jsonb_build_object('inbound',p_inbound,'reason',reason));
 IF human THEN
  INSERT INTO public.crm_agent_holds(contact_key,reason) VALUES(k,reason) ON CONFLICT(contact_key) DO UPDATE SET active=true,reason=excluded.reason,released_by=NULL,updated_at=now();
 END IF;
 IF st<>'pending' THEN RETURN jsonb_build_object('status',st,'reason',reason,'runId',run_id); END IF;
 RETURN public.claim_next_crm_agent_run(k);
END $$;

-- Everything the orchestrator needs, read in one consistent snapshot while the lease is valid.
CREATE OR REPLACE FUNCTION public.crm_agent_context(p_run uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_agent_runs%ROWTYPE; s public.crm_agent_settings%ROWTYPE; p record; lead jsonb; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run;
 IF NOT FOUND OR r.status<>'analyzing' OR r.lease_until<=public.crm_agent_now() THEN RETURN NULL; END IF;
 SELECT * INTO s FROM public.crm_agent_settings WHERE id=r.settings_id;
 SELECT x.name, x.stages INTO p FROM public.sales_pipelines x WHERE x.id=r.pipeline_id;
 SELECT jsonb_build_object('id',x.id,'name',x.name,'stage',x.stage,'pipelineId',x.pipeline_id,'whatsapp',x.whatsapp,'revision',x.gravon_change_revision,'source',x.source,'tags',x.tags)
  INTO lead FROM public.leads x WHERE x.id=r.lead_id;
 RETURN jsonb_build_object('run',to_jsonb(r),'settings',to_jsonb(s),'lead',lead,
  'pipeline',jsonb_build_object('id',r.pipeline_id,'name',coalesce(p.name,'Funil principal'),'stages',p.stages),
  'messages',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.message_id,'fromMe',q.from_me,'body',q.body,'sentAt',q.sent_at,'mediaType',q.media_type) ORDER BY q.sent_at, q.message_id),'[]'::jsonb)
   FROM (SELECT * FROM public.whatsapp_messages w WHERE w.instance=r.instance AND w.phone_key=r.contact_key ORDER BY w.sent_at DESC, w.message_id DESC LIMIT 60) q),
  'knowledge',(SELECT coalesce(jsonb_agg(jsonb_build_object('title',k.title,'text',k.text) ORDER BY k.updated_at DESC),'[]'::jsonb)
   FROM (SELECT * FROM public.ai_knowledge a WHERE a.company_key='crm:1' AND a.entry_type='manual' ORDER BY a.updated_at DESC LIMIT 100) k),
  'adMessages',(SELECT coalesce(jsonb_agg(m.body),'[]'::jsonb) FROM public.crm_reference_messages m WHERE m.active));
END $$;

CREATE OR REPLACE FUNCTION public.finish_crm_agent_analysis(p_run uuid, p_analysis jsonb, p_reply text, p_human text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_agent_runs%ROWTYPE; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR r.status<>'analyzing' OR r.lease_until<=public.crm_agent_now() THEN RETURN false; END IF;
 UPDATE public.crm_agent_runs SET analysis=p_analysis, reply=p_reply, status=CASE WHEN p_human IS NOT NULL THEN 'human' ELSE 'analyzing' END,
  reason=p_human, updated_at=now() WHERE id=p_run;
 INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,'analysis',coalesce(p_analysis,'{}'::jsonb)-'response');
 IF p_reply IS NOT NULL THEN INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,'generated',jsonb_build_object('text',p_reply)); END IF;
 IF p_human IS NOT NULL THEN
  INSERT INTO public.crm_agent_holds(contact_key,reason) VALUES(r.contact_key,left(p_human,500)) ON CONFLICT(contact_key) DO UPDATE SET active=true,reason=excluded.reason,released_by=NULL,updated_at=now();
  INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,'human',jsonb_build_object('reason',left(p_human,500)));
 END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.begin_crm_agent_send(p_run uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_agent_runs%ROWTYPE; s public.crm_agent_settings%ROWTYPE; l record; inbound timestamptz; why text; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-contact:'||r.contact_key,0));
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run FOR UPDATE;
 SELECT * INTO s FROM public.crm_agent_settings WHERE id=r.settings_id FOR SHARE;
 SELECT x.stage, x.pipeline_id, x.gravon_change_revision AS revision INTO l FROM public.leads x WHERE x.id=r.lead_id;
 SELECT w.sent_at INTO inbound FROM public.whatsapp_messages w WHERE w.message_id=r.inbound_id;
 IF r.status<>'analyzing' OR r.lease_until<=public.crm_agent_now() THEN RETURN false; END IF;
 IF r.reply IS NULL OR char_length(r.reply) NOT BETWEEN 1 AND s.max_reply_chars THEN why:='Resposta ausente ou acima do limite configurado.';
 ELSIF NOT s.enabled OR s.blocked_reason IS NOT NULL OR s.revision<>r.settings_revision OR s.instance<>r.instance THEN why:='Configuração do agente alterada durante a análise.';
 ELSIF l IS NULL OR l.stage IS DISTINCT FROM r.from_stage OR l.pipeline_id IS DISTINCT FROM r.pipeline_id OR l.revision IS DISTINCT FROM r.lead_revision THEN why:='Card alterado durante a análise.';
 ELSIF EXISTS(SELECT 1 FROM public.whatsapp_messages w WHERE w.instance=r.instance AND w.phone_key=r.contact_key AND NOT w.from_me AND w.sent_at>inbound) THEN why:='O cliente enviou outra mensagem; a mais recente será respondida.';
 ELSIF public.crm_agent_human_since(r.instance,r.contact_key,inbound) THEN why:='Atendimento humano iniciado durante a análise.';
 ELSIF EXISTS(SELECT 1 FROM public.crm_agent_holds h WHERE h.contact_key=r.contact_key AND h.active) THEN why:='Contato em atendimento humano.';
 ELSIF (SELECT count(*) FROM public.crm_agent_runs x WHERE x.settings_id=s.id AND x.status IN ('sending','accepted','completed','unknown') AND x.created_at>=public.crm_agent_day_start())>=s.max_replies_per_day THEN why:='Limite diário do funil atingido.';
 END IF;
 IF why IS NOT NULL THEN
  UPDATE public.crm_agent_runs SET status='skipped', reason=why, lease_until=NULL, updated_at=now() WHERE id=r.id;
  INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,'skipped',jsonb_build_object('reason',why));
  RETURN false;
 END IF;
 UPDATE public.crm_agent_runs SET status='sending', updated_at=now() WHERE id=r.id;
 INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event) VALUES(r.settings_id,r.id,r.lead_id,'send_reserved');
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.record_crm_agent_send(p_run uuid, p_provider text, p_accepted timestamptz, p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_agent_runs%ROWTYPE; ok boolean; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR r.status<>'sending' THEN RETURN; END IF;
 ok:=p_provider IS NOT NULL AND p_accepted IS NOT NULL AND p_error IS NULL;
 UPDATE public.crm_agent_runs SET status=CASE WHEN ok THEN 'accepted' ELSE 'unknown' END, provider_id=p_provider, accepted_at=p_accepted, reason=p_error, lease_until=NULL, updated_at=now() WHERE id=p_run;
 INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,CASE WHEN ok THEN 'accepted' ELSE 'send_error' END,jsonb_build_object('provider_id',p_provider,'reason',p_error));
 IF NOT ok THEN -- Unknown outcomes are never retried: a person must check the conversation.
  INSERT INTO public.crm_agent_holds(contact_key,reason) VALUES(r.contact_key,'Envio sem confirmação; verifique a conversa antes de liberar.')
  ON CONFLICT(contact_key) DO UPDATE SET active=true,reason=excluded.reason,released_by=NULL,updated_at=now();
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sync_crm_agent_send(p_run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_agent_runs%ROWTYPE; w public.whatsapp_messages%ROWTYPE; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('accepted','completed') OR r.provider_id IS NULL OR r.accepted_at IS NULL OR r.reply IS NULL THEN RETURN; END IF;
 SELECT * INTO w FROM public.whatsapp_messages WHERE message_id=r.provider_id FOR UPDATE;
 IF FOUND THEN -- The webhook echo may arrive first: bind it after verifying identity.
  IF w.instance<>r.instance OR NOT w.from_me OR w.phone_key<>r.contact_key OR w.body<>r.reply THEN RAISE EXCEPTION 'identity_conflict' USING ERRCODE='23514'; END IF;
  UPDATE public.whatsapp_messages SET message_source='commercial_agent', agent_run_id=r.id, accepted_at=coalesce(accepted_at,r.accepted_at), send_state=coalesce(send_state,'accepted') WHERE id=w.id;
 ELSE
  INSERT INTO public.whatsapp_messages(message_id,instance,phone,remote_jid,phone_key,from_me,push_name,body,media_type,sent_at,accepted_at,send_state,message_source,agent_run_id)
  VALUES(r.provider_id,r.instance,r.phone,r.phone||'@s.whatsapp.net',r.contact_key,true,'',r.reply,'',r.accepted_at,r.accepted_at,'accepted','commercial_agent',r.id);
 END IF;
 IF r.synced_at IS NULL THEN INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,'crm_recorded',jsonb_build_object('provider_id',r.provider_id)); END IF;
 UPDATE public.crm_agent_runs SET status='completed', synced_at=coalesce(synced_at,now()), updated_at=now() WHERE id=r.id;
END $$;

-- Applies a server-computed move only with literal evidence from the expected side, never to final stages.
CREATE OR REPLACE FUNCTION public.apply_crm_agent_decision(p_run uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_agent_runs%ROWTYPE; s public.crm_agent_settings%ROWTYPE; l public.leads%ROWTYPE; d jsonb; target text; ev text; side text; title text; result text; allowed text[]; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR r.status<>'completed' OR r.decision_result IS NOT NULL THEN RETURN 'skipped'; END IF;
 SELECT * INTO s FROM public.crm_agent_settings WHERE id=r.settings_id;
 d:=coalesce(r.analysis->'decision','{}'::jsonb); target:=d->>'target'; ev:=btrim(coalesce(d->>'evidence','')); side:=d->>'side';
 SELECT coalesce(array_agg(v),'{}') INTO allowed FROM jsonb_each_text(s.stage_map) e(k,v);
 IF r.pipeline_id IS NOT NULL THEN
  SELECT x->>'title' INTO title FROM public.sales_pipelines p CROSS JOIN jsonb_array_elements(p.stages) x WHERE p.id=r.pipeline_id AND NOT p.archived AND x->>'id'=target;
 END IF;
 IF coalesce(d->>'kind','none')<>'move' OR target IS NULL THEN result:='no_change';
 ELSIF NOT s.auto_move THEN result:='suggested';
 ELSIF NOT (target=ANY(allowed)) AND (r.pipeline_id IS NULL OR title IS NULL) THEN result:='invalid_target';
 ELSIF r.pipeline_id IS NOT NULL AND title IS NULL THEN result:='invalid_target';
 ELSIF lower(coalesce(title,'')||' '||target) ~ '(fechad|perdid|vendid|ganho|agendad|reuniao|reunião)' THEN result:='suggested';
 ELSIF char_length(ev)<3 OR side NOT IN ('cliente','empresa') OR NOT EXISTS(SELECT 1 FROM public.whatsapp_messages w WHERE w.instance=r.instance AND w.phone_key=r.contact_key
   AND w.from_me=(side='empresa') AND position(lower(ev) IN lower(w.body))>0 AND w.sent_at<=r.accepted_at) THEN result:='invalid_evidence';
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-contact:'||r.contact_key,0));
  SELECT * INTO l FROM public.leads WHERE id=r.lead_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR s.revision<>r.settings_revision OR l.stage IS DISTINCT FROM r.from_stage OR l.pipeline_id IS DISTINCT FROM r.pipeline_id OR l.gravon_change_revision IS DISTINCT FROM r.lead_revision THEN result:='stale';
  ELSE
   BEGIN
    UPDATE public.leads SET stage=target, history=CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid()::text,'date',now()::text,'kind','ai_move','source','gravon_ai',
      'text','Gravon IA — Agente Comercial moveu o card de '||r.from_stage||' para '||target||'. Motivo: '||left(coalesce(d->>'reason',''),400)||' Evidência: "'||left(ev,300)||'"'))
    WHERE id=l.id;
    result:='moved';
   EXCEPTION WHEN OTHERS THEN result:='blocked';
   END;
  END IF;
 END IF;
 UPDATE public.crm_agent_runs SET decision_result=result, updated_at=now() WHERE id=r.id;
 INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,'stage_decision',
  jsonb_build_object('result',result,'from',r.from_stage,'to',target,'reason',d->>'reason','qualification',r.analysis->'qualification'));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.crm_agent_pending_sync() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM public.crm_agent_runs WHERE status='accepted' AND synced_at IS NULL AND auth.role()='service_role' ORDER BY updated_at LIMIT 5
$$;

-- Abandoned analyses or sends become human handoffs; nothing is ever resent automatically.
CREATE OR REPLACE FUNCTION public.quarantine_crm_agent_runs() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_agent_runs%ROWTYPE; n integer := 0; why text; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 FOR r IN SELECT * FROM public.crm_agent_runs WHERE (status='analyzing' AND lease_until<=public.crm_agent_now()) OR (status='sending' AND updated_at<public.crm_agent_now()-interval '5 minutes') FOR UPDATE SKIP LOCKED LOOP
  why:=CASE WHEN r.status='sending' THEN 'Envio interrompido; resultado desconhecido, não reenviar.' ELSE 'Análise interrompida; revisão humana necessária.' END;
  UPDATE public.crm_agent_runs SET status=CASE WHEN r.status='sending' THEN 'unknown' ELSE 'human' END, reason=why, lease_until=NULL, updated_at=now() WHERE id=r.id;
  INSERT INTO public.crm_agent_holds(contact_key,reason) VALUES(r.contact_key,why) ON CONFLICT(contact_key) DO UPDATE SET active=true,reason=excluded.reason,released_by=NULL,updated_at=now();
  INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,'quarantine',jsonb_build_object('reason',why));
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.release_crm_agent_hold(p_contact text, p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-contact:'||p_contact,0));
 IF EXISTS(SELECT 1 FROM public.crm_agent_runs WHERE contact_key=p_contact AND status='sending') THEN RAISE EXCEPTION 'unresolved_send' USING ERRCODE='40001'; END IF;
 UPDATE public.crm_agent_runs SET status='failed', reason='Resultado incerto revisado por uma pessoa; não reenviado.', updated_at=now() WHERE contact_key=p_contact AND status='unknown';
 UPDATE public.crm_agent_holds SET active=false, released_by=p_actor, updated_at=now() WHERE contact_key=p_contact;
 INSERT INTO public.crm_agent_audit(event,actor_id,detail) VALUES('human_released',p_actor,jsonb_build_object('contact',p_contact));
END $$;

REVOKE ALL ON FUNCTION public.save_crm_agent_settings(uuid,uuid,bigint,jsonb), public.block_crm_agent(uuid,text), public.claim_crm_agent(text,text),
 public.claim_next_crm_agent_run(text), public.crm_agent_context(uuid), public.finish_crm_agent_analysis(uuid,jsonb,text,text), public.begin_crm_agent_send(uuid),
 public.record_crm_agent_send(uuid,text,timestamptz,text), public.sync_crm_agent_send(uuid), public.apply_crm_agent_decision(uuid), public.crm_agent_pending_sync(),
 public.quarantine_crm_agent_runs(), public.release_crm_agent_hold(text,uuid), public.crm_agent_human_since(text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_agent_settings(uuid,uuid,bigint,jsonb), public.block_crm_agent(uuid,text), public.claim_crm_agent(text,text),
 public.claim_next_crm_agent_run(text), public.crm_agent_context(uuid), public.finish_crm_agent_analysis(uuid,jsonb,text,text), public.begin_crm_agent_send(uuid),
 public.record_crm_agent_send(uuid,text,timestamptz,text), public.sync_crm_agent_send(uuid), public.apply_crm_agent_decision(uuid), public.crm_agent_pending_sync(),
 public.quarantine_crm_agent_runs(), public.release_crm_agent_hold(text,uuid), public.crm_agent_human_since(text,text,timestamptz) TO service_role;
