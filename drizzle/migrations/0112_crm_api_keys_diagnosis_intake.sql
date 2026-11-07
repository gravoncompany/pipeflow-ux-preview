-- API e Integrações: chaves de API (somente o hash é guardado) e recebimento de diagnósticos externos (Zapier).
CREATE TABLE public.crm_api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
 prefix text NOT NULL CHECK (char_length(prefix) BETWEEN 8 AND 24),
 key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
 scope text NOT NULL DEFAULT 'forms:diagnosis' CHECK (scope IN ('forms:diagnosis')),
 use_count integer NOT NULL DEFAULT 0,
 last_used_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.crm_api_keys TO service_role;
REVOKE ALL ON public.crm_api_keys FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_api_keys ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_api_keys IS 'Chaves de API privadas. Guarda apenas o SHA-256; a chave completa aparece uma única vez na criação.';

CREATE TABLE public.crm_diagnosis_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id text NOT NULL UNIQUE CHECK (char_length(event_id) BETWEEN 1 AND 200),
 api_key_id uuid REFERENCES public.crm_api_keys(id),
 name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 160),
 company text NOT NULL DEFAULT '' CHECK (char_length(company) <= 160),
 email text NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
 whatsapp text NOT NULL DEFAULT '' CHECK (char_length(whatsapp) <= 60),
 objective text NOT NULL DEFAULT '' CHECK (char_length(objective) <= 4000),
 utm_content text NOT NULL DEFAULT '' CHECK (char_length(utm_content) <= 200),
 outcome text NOT NULL DEFAULT 'received' CHECK (outcome IN ('received','matched','ambiguous','not_found','no_outbound')),
 lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
 paused_count integer NOT NULL DEFAULT 0,
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_diagnosis_submissions_recent ON public.crm_diagnosis_submissions (received_at DESC);
GRANT SELECT ON public.crm_diagnosis_submissions TO service_role;
REVOKE ALL ON public.crm_diagnosis_submissions FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_diagnosis_submissions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_diagnosis_submissions IS 'Diagnósticos recebidos pela API (event_id único). Escrita só por receive_crm_diagnosis.';

CREATE FUNCTION public.receive_crm_diagnosis(p_key_hash text, p_event_id text, p_name text, p_company text, p_email text,
 p_whatsapp text, p_objective text, p_utm_content text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k public.crm_api_keys; sid uuid; prev public.crm_diagnosis_submissions; pipes uuid[]; pipe uuid;
 cands uuid[]; target uuid; v_outcome text; paused integer := 0; em text := lower(btrim(coalesce(p_email,'')));
 pk text := public.crm_phone_key(p_whatsapp); txt text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO k FROM crm_api_keys WHERE key_hash = p_key_hash AND revoked_at IS NULL AND scope = 'forms:diagnosis';
 IF k.id IS NULL THEN RETURN jsonb_build_object('error', 'unauthorized'); END IF;
 IF p_event_id IS NULL OR char_length(btrim(p_event_id)) NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('error', 'invalid_event_id'); END IF;
 UPDATE crm_api_keys SET last_used_at = now(), use_count = use_count + 1 WHERE id = k.id;

 INSERT INTO crm_diagnosis_submissions(event_id, api_key_id, name, company, email, whatsapp, objective, utm_content)
 VALUES (btrim(p_event_id), k.id, left(coalesce(p_name,''),160), left(coalesce(p_company,''),160), left(em,254), left(coalesce(p_whatsapp,''),60),
  left(coalesce(p_objective,''),4000), left(coalesce(p_utm_content,''),200))
 ON CONFLICT (event_id) DO NOTHING RETURNING id INTO sid;
 IF sid IS NULL THEN
  SELECT * INTO prev FROM crm_diagnosis_submissions WHERE event_id = btrim(p_event_id);
  RETURN jsonb_build_object('ok', true, 'duplicate', true, 'outcome', prev.outcome, 'lead_id', prev.lead_id, 'paused', prev.paused_count);
 END IF;

 SELECT array_agg(id) INTO pipes FROM sales_pipelines WHERE lower(btrim(name)) = 'outbound' AND NOT archived;
 IF coalesce(cardinality(pipes),0) <> 1 THEN
  v_outcome := 'no_outbound';
 ELSE
  pipe := pipes[1];
  -- 1) Identificador do link da automação (utm_content = pf-<token>) é exclusivo de um card.
  IF coalesce(p_utm_content,'') ~ '^pf-[0-9a-f]{32}$' THEN
   SELECT array_agg(DISTINCT l.id) INTO cands FROM crm_automation_runs ru JOIN leads l ON l.id = ru.lead_id
    WHERE ru.token = substr(p_utm_content, 4) AND l.pipeline_id = pipe;
  END IF;
  -- 2) Sem identificador válido: e-mail exato ou WhatsApp (DDD + 8 dígitos) no Outbound.
  IF coalesce(cardinality(cands),0) = 0 THEN
   SELECT array_agg(DISTINCT l.id) INTO cands FROM leads l WHERE l.pipeline_id = pipe AND (
    (em <> '' AND lower(btrim(l.email)) = em) OR (length(pk) >= 10 AND public.crm_phone_key(l.whatsapp) = pk));
  END IF;
  v_outcome := CASE coalesce(cardinality(cands),0) WHEN 0 THEN 'not_found' WHEN 1 THEN 'matched' ELSE 'ambiguous' END;
 END IF;

 IF v_outcome = 'matched' THEN
  target := cands[1];
  PERFORM 1 FROM leads WHERE id = target FOR UPDATE;
  WITH p AS (
   UPDATE crm_email_flow_enrollments SET status = 'paused', next_send_at = NULL, reason = 'Diagnóstico recebido pela API; envios pausados', updated_at = now()
   WHERE lead_id = target AND status = 'active' RETURNING id
  ), ev AS (
   INSERT INTO crm_automation_events(automation_id, run_id, lead_id, kind, detail)
   SELECT ru.automation_id, ru.id, ru.lead_id, 'form', 'Diagnóstico recebido pela API; sequência pausada' FROM crm_automation_runs ru WHERE ru.enrollment_id IN (SELECT id FROM p) RETURNING 1
  ) SELECT count(*) INTO paused FROM p;
  txt := 'Diagnóstico estratégico recebido (API · Zapier).'
   || CASE WHEN btrim(coalesce(p_objective,'')) <> '' THEN E'\nObjetivo comercial: ' || left(btrim(p_objective), 1500) ELSE '' END
   || CASE WHEN paused > 0 THEN E'\nSequência automática de e-mails pausada.' ELSE E'\nNenhuma sequência de e-mails ativa para pausar.' END;
  UPDATE leads SET history = CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END || jsonb_build_array(jsonb_build_object(
   'id', 'diagnosis:' || sid, 'date', now()::text, 'kind', 'form', 'source', 'API e Integrações', 'text', txt))
  WHERE id = target;
 END IF;

 UPDATE crm_diagnosis_submissions SET outcome = v_outcome, lead_id = target, paused_count = paused WHERE id = sid;
 RETURN jsonb_build_object('ok', true, 'duplicate', false, 'outcome', v_outcome, 'lead_id', target, 'paused', paused);
END $$;
REVOKE ALL ON FUNCTION public.receive_crm_diagnosis(text,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_crm_diagnosis(text,text,text,text,text,text,text,text) TO service_role;