-- Central de Automações (fase 1: e-mail). Usa o mecanismo dos Fluxos de E-mail para enviar;
-- aqui ficam o desenho visual, as execuções por card, os eventos e as reações (resposta/formulário/fim).
ALTER TABLE public.crm_email_flows ADD COLUMN IF NOT EXISTS automation_id uuid;
COMMENT ON COLUMN public.crm_email_flows.automation_id IS 'Fluxo gerado por uma Automação; editar somente pela Central de Automações.';

-- Etapas passam a aceitar horas além do dia (fluxos antigos não têm "hours": resultado igual ao anterior).
CREATE OR REPLACE FUNCTION public.crm_email_flow_step_due(p_steps jsonb, p_index integer, p_started timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_index >= jsonb_array_length(p_steps) THEN NULL
  ELSE p_started + make_interval(days => greatest(coalesce((p_steps->p_index->>'day')::int,1),1) - 1,
    hours => least(greatest(coalesce((p_steps->p_index->>'hours')::int,0),0),23)) END
$$;

CREATE TABLE public.crm_automations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','test','active','paused','archived')),
 graph jsonb NOT NULL CHECK (jsonb_typeof(graph)='object'),
 compiled jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(compiled)='object'),
 compile_ok boolean NOT NULL DEFAULT false,
 trigger_pipeline_id uuid REFERENCES public.sales_pipelines(id),
 flow_id uuid REFERENCES public.crm_email_flows(id),
 landing_url text NOT NULL DEFAULT '' CHECK (char_length(landing_url) <= 500 AND (landing_url = '' OR landing_url ~ '^https://')),
 test_contacts text[] NOT NULL DEFAULT '{}' CHECK (cardinality(test_contacts) <= 10),
 slug text NOT NULL DEFAULT '' CHECK (char_length(slug) <= 80),
 revision integer NOT NULL DEFAULT 1,
 activated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_automations TO service_role;
REVOKE ALL ON public.crm_automations FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_automations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_automations IS 'Automações visuais (fase 1: e-mail). Nascem desligadas; escrita só por funções de serviço.';

CREATE TABLE public.crm_automation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 automation_id uuid NOT NULL REFERENCES public.crm_automations(id),
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
 enrollment_id uuid UNIQUE REFERENCES public.crm_email_flow_enrollments(id) ON DELETE SET NULL,
 contact text NOT NULL,
 token text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{32}$'),
 source text NOT NULL CHECK (source IN ('trigger','manual','test')),
 clicks integer NOT NULL DEFAULT 0,
 last_click_at timestamptz,
 reply_at timestamptz,
 form_at timestamptz,
 form_lead_id uuid,
 finished_at timestamptz,
 cancelled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (automation_id, lead_id)
);
CREATE INDEX crm_automation_runs_lead ON public.crm_automation_runs (lead_id);
GRANT SELECT ON public.crm_automation_runs TO service_role;
REVOKE ALL ON public.crm_automation_runs FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_automation_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.crm_automation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 automation_id uuid NOT NULL REFERENCES public.crm_automations(id),
 run_id uuid REFERENCES public.crm_automation_runs(id) ON DELETE CASCADE,
 lead_id uuid,
 kind text NOT NULL CHECK (kind IN ('enrolled','skipped','reply','opt_out','form','click','card_updated','paused','resumed','cancelled','finished','send_now')),
 detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 300),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_automation_events_run ON public.crm_automation_events (run_id, created_at);
CREATE INDEX crm_automation_events_automation ON public.crm_automation_events (automation_id, created_at DESC);
GRANT SELECT ON public.crm_automation_events TO service_role;
REVOKE ALL ON public.crm_automation_events FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_automation_events ENABLE ROW LEVEL SECURITY;

-- Entradas de cards em funis com automação ligada (fila do gatilho).
CREATE TABLE public.crm_automation_entries (
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
 pipeline_id uuid NOT NULL,
 entered_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 outcome text NOT NULL DEFAULT '' CHECK (char_length(outcome) <= 200),
 PRIMARY KEY (lead_id, pipeline_id)
);
CREATE INDEX crm_automation_entries_pending ON public.crm_automation_entries (entered_at) WHERE processed_at IS NULL;
GRANT SELECT ON public.crm_automation_entries TO service_role;
REVOKE ALL ON public.crm_automation_entries FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_automation_entries ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.crm_automation_capture_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.pipeline_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.pipeline_id IS NOT DISTINCT FROM NEW.pipeline_id) THEN RETURN NULL; END IF;
 BEGIN
  IF EXISTS (SELECT 1 FROM crm_automations WHERE trigger_pipeline_id = NEW.pipeline_id AND state IN ('test','active')) THEN
   INSERT INTO crm_automation_entries(lead_id, pipeline_id) VALUES (NEW.id, NEW.pipeline_id) ON CONFLICT DO NOTHING;
  END IF;
 EXCEPTION WHEN OTHERS THEN NULL; -- nunca impede a gravação do card
 END;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_capture_entry() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_automation_capture_entry AFTER INSERT OR UPDATE OF pipeline_id ON public.leads
 FOR EACH ROW EXECUTE FUNCTION public.crm_automation_capture_entry();

CREATE FUNCTION public.crm_automation_append_history(p_lead uuid, p_id text, p_text text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE leads SET history = CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END || jsonb_build_array(jsonb_build_object(
  'id', p_id, 'date', now()::text, 'kind', 'automation', 'source', 'Automações', 'text', left(p_text, 600)))
 WHERE id = p_lead;
$$;

-- Ações "Atualizar card": etapa só avança (nunca "Fechado"), etiqueta é adicionada, status substituído.
CREATE FUNCTION public.crm_automation_apply_actions(p_lead uuid, p_pipeline uuid, p_actions jsonb, p_label text, p_run uuid, p_automation uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l record; stg jsonb; cur int; tgt int; parts text[] := '{}'; newstage text; newtags jsonb;
 st text; tg text; sts text;
BEGIN
 IF p_actions IS NULL OR jsonb_typeof(p_actions) <> 'object' THEN RETURN ''; END IF;
 st := nullif(btrim(coalesce(p_actions->>'stage','')),''); tg := nullif(btrim(coalesce(p_actions->>'tag','')),''); sts := nullif(btrim(coalesce(p_actions->>'status','')),'');
 SELECT id, stage, tags, pipeline_id INTO l FROM leads WHERE id = p_lead FOR UPDATE;
 IF l.id IS NULL THEN RETURN ''; END IF;
 newstage := l.stage;
 newtags := CASE WHEN jsonb_typeof(l.tags)='array' THEN l.tags ELSE '[]'::jsonb END;
 IF st IS NOT NULL AND st <> 'fechado' AND l.pipeline_id IS NOT DISTINCT FROM p_pipeline THEN
  SELECT stages INTO stg FROM sales_pipelines WHERE id = p_pipeline;
  SELECT s.ord - 1 INTO cur FROM jsonb_array_elements(coalesce(stg,'[]'::jsonb)) WITH ORDINALITY AS s(v, ord) WHERE s.v->>'id' = l.stage;
  SELECT s.ord - 1 INTO tgt FROM jsonb_array_elements(coalesce(stg,'[]'::jsonb)) WITH ORDINALITY AS s(v, ord) WHERE s.v->>'id' = st;
  IF tgt IS NOT NULL AND (cur IS NULL OR tgt > cur) THEN newstage := st; parts := parts || ('etapa "' || (stg->tgt->>'title') || '"'); END IF;
 END IF;
 IF tg IS NOT NULL AND NOT newtags @> jsonb_build_array(tg) THEN newtags := newtags || jsonb_build_array(tg); parts := parts || ('etiqueta "' || tg || '"'); END IF;
 IF sts IS NOT NULL THEN parts := parts || ('status "' || left(sts,80) || '"'); END IF;
 IF cardinality(parts) = 0 THEN RETURN ''; END IF;
 UPDATE leads SET stage = newstage, tags = newtags, status = coalesce(left(sts,80), status) WHERE id = p_lead;
 PERFORM crm_automation_append_history(p_lead, 'automation:' || p_run || ':' || md5(p_label || clock_timestamp()::text), p_label || ' — ' || array_to_string(parts, ', ') || '.');
 INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail) VALUES (p_automation, p_run, p_lead, 'card_updated', left(p_label || ': ' || array_to_string(parts, ', '), 300));
 RETURN array_to_string(parts, ', ');
END $$;

CREATE FUNCTION public.save_crm_automation(p_id uuid, p_revision integer, p_name text, p_graph jsonb, p_compiled jsonb, p_compile_ok boolean,
 p_pipeline uuid, p_landing text, p_tests text[], p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.crm_automations; f public.crm_email_flows; steps jsonb; uses_ai boolean; fname text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_pipeline IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales_pipelines WHERE id = p_pipeline) THEN RAISE EXCEPTION 'invalid_pipeline'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO a FROM crm_automations WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR a.revision <> p_revision OR a.state = 'archived' THEN RAISE EXCEPTION 'stale_automation'; END IF;
  IF a.state IN ('test','active') THEN RAISE EXCEPTION 'pause_first'; END IF;
 END IF;
 IF p_compile_ok THEN
  steps := coalesce(p_compiled->'steps', '[]'::jsonb);
  uses_ai := coalesce((p_compiled->>'usesAi')::boolean, false);
  fname := 'Automação · ' || left(btrim(p_name), 130);
  -- Salvar sempre exige nova aprovação da IA (feita ao ligar a automação).
  IF a.flow_id IS NULL THEN
   f := jsonb_populate_record(NULL::public.crm_email_flows, save_crm_email_flow(NULL, 0, fname, steps, uses_ai, false));
  ELSE
   SELECT * INTO f FROM crm_email_flows WHERE id = a.flow_id;
   f := jsonb_populate_record(NULL::public.crm_email_flows, save_crm_email_flow(f.id, f.revision, fname, steps, uses_ai, false));
  END IF;
  UPDATE crm_email_flows SET max_messages = least(greatest(jsonb_array_length(steps), 1), 10) WHERE id = f.id;
 END IF;
 IF p_id IS NULL THEN
  INSERT INTO crm_automations(name, graph, compiled, compile_ok, trigger_pipeline_id, flow_id, landing_url, test_contacts, slug)
   VALUES (btrim(p_name), p_graph, CASE WHEN p_compile_ok THEN p_compiled ELSE '{}'::jsonb END, p_compile_ok, p_pipeline, f.id, coalesce(p_landing,''), coalesce(p_tests,'{}'), left(coalesce(p_slug,''),80))
   RETURNING * INTO a;
 ELSE
  UPDATE crm_automations SET name = btrim(p_name), graph = p_graph, compiled = CASE WHEN p_compile_ok THEN p_compiled ELSE compiled END,
   compile_ok = p_compile_ok, trigger_pipeline_id = p_pipeline, flow_id = coalesce(f.id, flow_id), landing_url = coalesce(p_landing,''),
   test_contacts = coalesce(p_tests,'{}'), slug = left(coalesce(p_slug,''),80), revision = revision + 1, updated_at = now()
  WHERE id = p_id RETURNING * INTO a;
 END IF;
 IF f.id IS NOT NULL THEN UPDATE crm_email_flows SET automation_id = a.id WHERE id = f.id; END IF;
 RETURN to_jsonb(a);
END $$;

CREATE FUNCTION public.set_crm_automation_state(p_id uuid, p_revision integer, p_state text, p_approve_ai boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.crm_automations; f public.crm_email_flows;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('test','active','paused','archived') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 SELECT * INTO a FROM crm_automations WHERE id = p_id FOR UPDATE;
 IF a.id IS NULL OR a.revision <> p_revision OR a.state = 'archived' THEN RAISE EXCEPTION 'stale_automation'; END IF;
 IF a.flow_id IS NOT NULL THEN SELECT * INTO f FROM crm_email_flows WHERE id = a.flow_id FOR UPDATE; END IF;
 IF p_state IN ('test','active') THEN
  IF NOT a.compile_ok OR f.id IS NULL OR a.trigger_pipeline_id IS NULL THEN RAISE EXCEPTION 'not_ready'; END IF;
  IF coalesce((a.compiled->>'usesLink')::boolean, false) AND a.landing_url = '' THEN RAISE EXCEPTION 'landing_required'; END IF;
  IF p_state = 'test' AND cardinality(a.test_contacts) = 0 THEN RAISE EXCEPTION 'tests_required'; END IF;
  IF f.ai_enabled AND f.ai_approved_revision IS DISTINCT FROM f.revision THEN
   IF NOT coalesce(p_approve_ai, false) THEN RAISE EXCEPTION 'ai_not_approved'; END IF;
   UPDATE crm_email_flows SET ai_approved_revision = revision, ai_approved_at = now() WHERE id = f.id RETURNING * INTO f;
  END IF;
  IF f.state <> 'active' THEN PERFORM set_crm_email_flow_state(f.id, f.revision, 'active'); END IF;
  -- Só cards que entrarem a partir de agora disparam o gatilho.
  UPDATE crm_automations SET state = p_state, activated_at = now(), revision = revision + 1, updated_at = now() WHERE id = a.id RETURNING * INTO a;
 ELSIF p_state = 'paused' THEN
  IF a.state NOT IN ('test','active') THEN RAISE EXCEPTION 'invalid_state'; END IF;
  IF f.id IS NOT NULL AND f.state = 'active' THEN PERFORM set_crm_email_flow_state(f.id, f.revision, 'paused'); END IF;
  UPDATE crm_automations SET state = 'paused', revision = revision + 1, updated_at = now() WHERE id = a.id RETURNING * INTO a;
 ELSE
  IF f.id IS NOT NULL AND f.state <> 'archived' THEN PERFORM set_crm_email_flow_state(f.id, f.revision, 'archived'); END IF;
  UPDATE crm_automations SET state = 'archived', revision = revision + 1, updated_at = now() WHERE id = a.id RETURNING * INTO a;
 END IF;
 RETURN to_jsonb(a);
END $$;

CREATE FUNCTION public.start_crm_automation_run(p_automation uuid, p_lead uuid, p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.crm_automations; f public.crm_email_flows; l record; em text; e_id uuid; r_id uuid; why text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_source NOT IN ('trigger','manual','test') THEN RAISE EXCEPTION 'invalid_source'; END IF;
 SELECT * INTO a FROM crm_automations WHERE id = p_automation FOR SHARE;
 IF a.id IS NULL OR a.state NOT IN ('test','active') THEN RETURN jsonb_build_object('ok', false, 'reason', 'A automação não está ligada.'); END IF;
 SELECT * INTO f FROM crm_email_flows WHERE id = a.flow_id;
 IF f.id IS NULL OR f.state <> 'active' THEN RETURN jsonb_build_object('ok', false, 'reason', 'O envio desta automação não está ativo.'); END IF;
 SELECT id, email, pipeline_id INTO l FROM leads WHERE id = p_lead;
 IF l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'Card não encontrado.'); END IF;
 em := lower(btrim(coalesce(l.email, '')));
 IF p_source <> 'test' AND l.pipeline_id IS DISTINCT FROM a.trigger_pipeline_id THEN why := 'O card não está no funil do gatilho.';
 ELSIF em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN why := 'Card sem e-mail válido.';
 ELSIF (a.state = 'test' OR p_source = 'test') AND NOT (em = ANY(a.test_contacts)) THEN
  IF p_source = 'trigger' THEN RETURN jsonb_build_object('ok', false, 'reason', 'Automação em teste: só os e-mails de teste participam.'); END IF;
  why := 'Em teste, só os e-mails de teste participam.';
 ELSIF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email = em) OR EXISTS (SELECT 1 FROM crm_campaign_permissions WHERE channel = 'email' AND contact = em AND withdrawn_at IS NOT NULL) THEN
  why := 'Contato descadastrado ou bloqueado.';
 ELSIF EXISTS (SELECT 1 FROM crm_automation_runs WHERE automation_id = a.id AND lead_id = l.id) THEN why := 'Este card já passou por esta automação.';
 END IF;
 IF why IS NULL THEN
  INSERT INTO crm_email_flow_enrollments(flow_id, lead_id, contact, next_send_at) VALUES (f.id, l.id, em, crm_email_flow_step_due(f.steps, 0, now()))
   ON CONFLICT DO NOTHING RETURNING id INTO e_id;
  IF e_id IS NULL THEN why := 'O contato já está em outra sequência de e-mail.'; END IF;
 END IF;
 IF why IS NOT NULL THEN
  IF p_source = 'trigger' THEN INSERT INTO crm_automation_events(automation_id, lead_id, kind, detail) VALUES (a.id, l.id, 'skipped', why); END IF;
  RETURN jsonb_build_object('ok', false, 'reason', why);
 END IF;
 INSERT INTO crm_automation_runs(automation_id, lead_id, enrollment_id, contact, token, source)
  VALUES (a.id, l.id, e_id, em, replace(gen_random_uuid()::text, '-', ''), p_source) RETURNING id INTO r_id;
 INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail)
  VALUES (a.id, r_id, l.id, 'enrolled', CASE p_source WHEN 'trigger' THEN 'Card entrou no funil' WHEN 'test' THEN 'Teste iniciado manualmente' ELSE 'Incluído manualmente' END);
 PERFORM crm_automation_append_history(l.id, 'automation-start:' || r_id, 'Entrou na automação "' || a.name || '"' || CASE WHEN p_source = 'test' THEN ' (teste)' ELSE '' END || '. Os e-mails seguem a cadência configurada e param se o contato responder ou preencher o formulário.');
 RETURN jsonb_build_object('ok', true, 'run', r_id);
END $$;

CREATE FUNCTION public.process_crm_automation_entries(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x record; a public.crm_automations; res jsonb; n integer := 0; outcome text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 FOR x IN SELECT * FROM crm_automation_entries WHERE processed_at IS NULL ORDER BY entered_at LIMIT least(greatest(coalesce(p_limit,1),1),100) FOR UPDATE SKIP LOCKED LOOP
  outcome := 'Nenhuma automação ligada no momento da entrada';
  FOR a IN SELECT * FROM crm_automations WHERE trigger_pipeline_id = x.pipeline_id AND state IN ('test','active') ORDER BY created_at LOOP
   IF a.activated_at IS NOT NULL AND x.entered_at < a.activated_at THEN outcome := 'Entrou antes de a automação ser ligada'; CONTINUE; END IF;
   res := start_crm_automation_run(a.id, x.lead_id, 'trigger');
   outcome := CASE WHEN (res->>'ok')::boolean THEN 'Iniciada' ELSE coalesce(res->>'reason', 'Não iniciada') END;
   EXIT WHEN (res->>'ok')::boolean;
  END LOOP;
  UPDATE crm_automation_entries SET processed_at = now(), outcome = left(outcome, 200) WHERE lead_id = x.lead_id AND pipeline_id = x.pipeline_id;
  n := n + 1;
 END LOOP;
 RETURN n;
END $$;

-- Formulário: um card criado depois da entrada com o mesmo e-mail, ou com o identificador do link (utm_content).
CREATE FUNCTION public.detect_crm_automation_forms() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; m uuid; n integer := 0; a public.crm_automations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 FOR r IN SELECT ru.* FROM crm_automation_runs ru JOIN crm_email_flow_enrollments e ON e.id = ru.enrollment_id
  WHERE ru.form_at IS NULL AND ru.cancelled_at IS NULL AND e.status IN ('active','awaiting_reply','in_conversation','paused','finished')
   AND ru.created_at > now() - interval '120 days' LIMIT 500 LOOP
  SELECT l.id INTO m FROM leads l WHERE l.id <> r.lead_id AND l.created_at > r.created_at
   AND (lower(btrim(l.email)) = r.contact OR l.utm_content = 'pf-' || r.token) ORDER BY l.created_at LIMIT 1;
  IF m IS NULL THEN CONTINUE; END IF;
  SELECT * INTO a FROM crm_automations WHERE id = r.automation_id;
  UPDATE crm_automation_runs SET form_at = now(), form_lead_id = m, updated_at = now() WHERE id = r.id AND form_at IS NULL;
  IF NOT FOUND THEN CONTINUE; END IF;
  UPDATE crm_email_flow_enrollments SET status = 'stopped', next_send_at = NULL, reason = 'Preencheu o formulário de diagnóstico', updated_at = now()
   WHERE id = r.enrollment_id AND status IN ('active','awaiting_reply','in_conversation','paused');
  INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail) VALUES (a.id, r.id, r.lead_id, 'form', 'Formulário recebido; envios encerrados');
  PERFORM crm_automation_append_history(r.lead_id, 'automation-form:' || r.id, 'Preencheu o formulário de diagnóstico (automação "' || a.name || '"). Envios automáticos encerrados.');
  PERFORM crm_automation_apply_actions(r.lead_id, a.trigger_pipeline_id, a.compiled->'onForm', 'Automação "' || a.name || '" · formulário preenchido', r.id, a.id);
  n := n + 1;
 END LOOP;
 RETURN n;
END $$;

-- Respostas (e-mail/WhatsApp) e conclusão da cadência: registra uma vez e aplica as ações do desenho.
CREATE FUNCTION public.settle_crm_automation_runs() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; n integer := 0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 FOR r IN SELECT ru.id, ru.lead_id, ru.automation_id, e.reason, e.replied_at, a.name, a.trigger_pipeline_id, a.compiled
  FROM crm_automation_runs ru JOIN crm_email_flow_enrollments e ON e.id = ru.enrollment_id JOIN crm_automations a ON a.id = ru.automation_id
  WHERE ru.reply_at IS NULL AND ru.form_at IS NULL AND ru.cancelled_at IS NULL
   AND (e.replied_at IS NOT NULL OR e.reason LIKE 'Mensagem recebida do contato%' OR e.reason LIKE 'Respondeu pelo WhatsApp%') LIMIT 200 LOOP
  UPDATE crm_automation_runs SET reply_at = coalesce(r.replied_at, now()), updated_at = now() WHERE id = r.id;
  IF r.reason = 'Pediu para não receber novos contatos' THEN
   INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail) VALUES (r.automation_id, r.id, r.lead_id, 'opt_out', 'Descadastrado; envios encerrados');
  ELSE
   INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail) VALUES (r.automation_id, r.id, r.lead_id, 'reply', left(coalesce(nullif(r.reason,''), 'Resposta recebida; envios pausados'), 300));
   PERFORM crm_automation_apply_actions(r.lead_id, r.trigger_pipeline_id, r.compiled->'onReply', 'Automação "' || r.name || '" · contato respondeu', r.id, r.automation_id);
  END IF;
  n := n + 1;
 END LOOP;
 FOR r IN SELECT ru.id, ru.lead_id, ru.automation_id, a.name, a.trigger_pipeline_id, a.compiled
  FROM crm_automation_runs ru JOIN crm_email_flow_enrollments e ON e.id = ru.enrollment_id JOIN crm_automations a ON a.id = ru.automation_id
  WHERE ru.finished_at IS NULL AND ru.reply_at IS NULL AND ru.form_at IS NULL AND ru.cancelled_at IS NULL
   AND e.status = 'finished' AND e.replied_at IS NULL AND e.last_sent_at IS NOT NULL
   AND e.last_sent_at + make_interval(hours => least(greatest(coalesce((a.compiled->>'finishAfterHours')::int, 0), 0), 2880)) <= now() LIMIT 200 LOOP
  UPDATE crm_automation_runs SET finished_at = now(), updated_at = now() WHERE id = r.id;
  INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail) VALUES (r.automation_id, r.id, r.lead_id, 'finished', 'Todos os e-mails enviados, sem resposta');
  PERFORM crm_automation_apply_actions(r.lead_id, r.trigger_pipeline_id, r.compiled->'onFinish', 'Automação "' || r.name || '" · cadência concluída', r.id, r.automation_id);
  n := n + 1;
 END LOOP;
 RETURN n;
END $$;

CREATE FUNCTION public.set_crm_automation_run(p_run uuid, p_action text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.crm_automation_runs; e public.crm_email_flow_enrollments; f public.crm_email_flows;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO r FROM crm_automation_runs WHERE id = p_run FOR UPDATE;
 IF r.id IS NULL OR r.enrollment_id IS NULL THEN RETURN false; END IF;
 SELECT * INTO e FROM crm_email_flow_enrollments WHERE id = r.enrollment_id FOR UPDATE;
 SELECT * INTO f FROM crm_email_flows WHERE id = e.flow_id;
 IF p_action = 'pause' AND e.status = 'active' THEN
  UPDATE crm_email_flow_enrollments SET status = 'paused', next_send_at = NULL, reason = 'Pausada manualmente na automação', updated_at = now() WHERE id = e.id;
  INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind) VALUES (r.automation_id, r.id, r.lead_id, 'paused');
 ELSIF p_action = 'resume' AND e.status = 'paused' AND e.replied_at IS NULL AND r.reply_at IS NULL AND r.form_at IS NULL AND r.cancelled_at IS NULL THEN
  IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email = e.contact) THEN RAISE EXCEPTION 'suppressed_contact'; END IF;
  UPDATE crm_email_flow_enrollments SET status = CASE WHEN e.next_step >= jsonb_array_length(f.steps) THEN 'finished' ELSE 'active' END, reason = '',
   next_send_at = greatest(now(), coalesce(crm_email_flow_step_due(f.steps, e.next_step, e.started_at), now())), updated_at = now() WHERE id = e.id;
  INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind) VALUES (r.automation_id, r.id, r.lead_id, 'resumed');
 ELSIF p_action = 'cancel' AND r.cancelled_at IS NULL AND e.status IN ('active','paused','awaiting_reply','in_conversation') THEN
  UPDATE crm_email_flow_enrollments SET status = 'stopped', next_send_at = NULL, reason = 'Automação cancelada manualmente no card', updated_at = now() WHERE id = e.id;
  UPDATE crm_automation_runs SET cancelled_at = now(), updated_at = now() WHERE id = r.id;
  INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind) VALUES (r.automation_id, r.id, r.lead_id, 'cancelled');
  PERFORM crm_automation_append_history(r.lead_id, 'automation-cancel:' || r.id, 'Automação cancelada manualmente; nenhum novo e-mail será enviado por ela.');
 ELSIF p_action = 'send_now' AND r.source = 'test' AND e.status = 'active' AND e.next_send_at IS NOT NULL THEN
  UPDATE crm_email_flow_enrollments SET next_send_at = now(), updated_at = now() WHERE id = e.id;
  INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind) VALUES (r.automation_id, r.id, r.lead_id, 'send_now');
 ELSE RETURN false; END IF;
 RETURN true;
END $$;

-- Clique no link rastreado: devolve o destino (landing page) e o identificador da automação.
CREATE FUNCTION public.record_crm_automation_click(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.crm_automation_runs; a public.crm_automations; c integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RETURN NULL; END IF;
 SELECT * INTO r FROM crm_automation_runs WHERE token = p_token;
 IF r.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO a FROM crm_automations WHERE id = r.automation_id;
 IF a.landing_url = '' THEN RETURN NULL; END IF;
 UPDATE crm_automation_runs SET clicks = clicks + 1, last_click_at = now(), updated_at = now() WHERE id = r.id RETURNING clicks INTO c;
 IF c <= 20 THEN INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail) VALUES (a.id, r.id, r.lead_id, 'click', 'Abriu a página do diagnóstico'); END IF;
 IF c = 1 THEN PERFORM crm_automation_append_history(r.lead_id, 'automation-click:' || r.id, 'Clicou no link do diagnóstico enviado pela automação "' || a.name || '".'); END IF;
 RETURN jsonb_build_object('url', a.landing_url, 'slug', coalesce(nullif(a.slug,''), 'automacao'));
END $$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['crm_automation_append_history(uuid,text,text)','crm_automation_apply_actions(uuid,uuid,jsonb,text,uuid,uuid)',
  'save_crm_automation(uuid,integer,text,jsonb,jsonb,boolean,uuid,text,text[],text)','set_crm_automation_state(uuid,integer,text,boolean)',
  'start_crm_automation_run(uuid,uuid,text)','process_crm_automation_entries(integer)','detect_crm_automation_forms()','settle_crm_automation_runs()',
  'set_crm_automation_run(uuid,text)','record_crm_automation_click(text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
 END LOOP;
END $$;
