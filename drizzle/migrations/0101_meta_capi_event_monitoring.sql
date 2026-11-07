-- Histórico de Conversões: tentativas registradas, novas tentativas para falhas recuperáveis. Sem tokens nem dados pessoais.
ALTER TABLE public.meta_capi_lead_events
 ADD COLUMN source text NOT NULL DEFAULT 'ai_qualification' CHECK (source IN ('ai_qualification')),
 ADD COLUMN attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN retryable boolean NOT NULL DEFAULT false,
 ADD COLUMN next_attempt_at timestamptz,
 ADD COLUMN last_attempt_at timestamptz;
ALTER TABLE public.meta_capi_lead_events DROP CONSTRAINT meta_capi_lead_events_status_check;
ALTER TABLE public.meta_capi_lead_events ADD CONSTRAINT meta_capi_lead_events_status_check
 CHECK (status IN ('waiting_settings','paused','ready','sending','sent','failed','unknown','pixel_changed','retry_scheduled'));
CREATE INDEX meta_capi_lead_events_company_time_idx ON public.meta_capi_lead_events (company_key, event_time DESC);

CREATE TABLE public.meta_capi_event_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_row uuid NOT NULL REFERENCES public.meta_capi_lead_events(id),
 company_key text NOT NULL CHECK (company_key ~ '^crm:[0-9]+$'),
 attempt_no integer NOT NULL CHECK (attempt_no >= 1),
 trigger text NOT NULL CHECK (trigger IN ('automatic','manual')),
 outcome text NOT NULL CHECK (outcome IN ('accepted','rejected','recoverable','unknown')),
 http integer,
 code text CHECK (code IS NULL OR length(code) <= 80),
 request_summary jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(request_summary) = 'object' AND length(request_summary::text) <= 4000),
 response_summary jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(response_summary) = 'object' AND length(response_summary::text) <= 4000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (event_row, attempt_no)
);
GRANT SELECT ON public.meta_capi_event_attempts TO service_role;
REVOKE ALL ON public.meta_capi_event_attempts FROM PUBLIC, anon, authenticated;
ALTER TABLE public.meta_capi_event_attempts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_capi_event_attempts IS 'Tentativas de envio à API de Conversões: só resumo técnico (campos presentes, códigos, fbtrace_id). Nunca token, hash ou dado pessoal.';

-- Reserva: eventos prontos ou com nova tentativa vencida, só com production_enabled e o mesmo Pixel.
CREATE OR REPLACE FUNCTION public.claim_meta_capi_lead_events(p_limit integer)
RETURNS TABLE(id uuid, lead_id uuid, event_id text, event_name text, event_time timestamptz, pixel_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE meta_capi_lead_events e SET status = CASE WHEN s.company_key IS NULL THEN 'waiting_settings' WHEN NOT s.enabled THEN 'paused' ELSE 'ready' END,
   pixel_id = coalesce(e.pixel_id, s.pixel_id), updated_at = now()
  FROM (SELECT x.id AS eid, c.company_key, c.enabled, c.pixel_id FROM meta_capi_lead_events x LEFT JOIN meta_capi_settings c ON c.company_key = x.company_key
        WHERE x.status IN ('waiting_settings','paused','ready')) s
  WHERE e.id = s.eid;
 UPDATE meta_capi_lead_events e SET status='pixel_changed', updated_at=now() FROM meta_capi_settings c
  WHERE c.company_key = e.company_key AND e.status IN ('ready','retry_scheduled') AND e.pixel_id IS DISTINCT FROM c.pixel_id;
 RETURN QUERY
 UPDATE meta_capi_lead_events e SET status='sending', attempts = e.attempts + 1, last_attempt_at = now(), next_attempt_at = NULL, updated_at=now()
 FROM (SELECT x.id AS eid FROM meta_capi_lead_events x JOIN meta_capi_settings c ON c.company_key = x.company_key
       WHERE (x.status='ready' OR (x.status='retry_scheduled' AND coalesce(x.next_attempt_at, now()) <= now()))
         AND c.enabled AND c.production_enabled AND x.pixel_id = c.pixel_id
       ORDER BY x.created_at LIMIT least(greatest(p_limit,1),20) FOR UPDATE OF x SKIP LOCKED) d
 WHERE e.id = d.eid
 RETURNING e.id, e.lead_id, e.event_id, e.event_name, e.event_time, e.pixel_id;
END $$;

-- Registra o resultado de uma tentativa reservada. Recuperável: até 5 tentativas automáticas com espera crescente.
CREATE FUNCTION public.record_meta_capi_attempt(p_event uuid, p_trigger text, p_outcome text, p_http integer, p_code text, p_request jsonb, p_response jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e meta_capi_lead_events;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_outcome NOT IN ('accepted','rejected','recoverable','unknown') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
 SELECT * INTO e FROM meta_capi_lead_events WHERE id = p_event FOR UPDATE;
 IF e IS NULL OR e.status <> 'sending' THEN RETURN 'not_sending'; END IF;
 INSERT INTO meta_capi_event_attempts (event_row, company_key, attempt_no, trigger, outcome, http, code, request_summary, response_summary)
 VALUES (e.id, e.company_key, e.attempts, CASE WHEN p_trigger = 'manual' THEN 'manual' ELSE 'automatic' END, p_outcome, p_http, left(p_code,80), coalesce(p_request,'{}'), coalesce(p_response,'{}'))
 ON CONFLICT (event_row, attempt_no) DO NOTHING;
 UPDATE meta_capi_lead_events SET
  status = CASE p_outcome WHEN 'accepted' THEN 'sent' WHEN 'rejected' THEN 'failed' WHEN 'unknown' THEN 'unknown'
           ELSE CASE WHEN e.attempts < 5 THEN 'retry_scheduled' ELSE 'failed' END END,
  retryable = p_outcome IN ('recoverable','unknown'),
  next_attempt_at = CASE WHEN p_outcome = 'recoverable' AND e.attempts < 5 THEN now() + make_interval(mins => 5 * (2 ^ (e.attempts - 1))::int) END,
  sent_at = CASE WHEN p_outcome = 'accepted' THEN now() ELSE sent_at END,
  last_http = p_http, last_code = CASE WHEN p_outcome = 'accepted' THEN NULL ELSE left(p_code,80) END, updated_at = now()
 WHERE id = e.id;
 RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.record_meta_capi_attempt(uuid,text,text,integer,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_meta_capi_attempt(uuid,text,text,integer,text,jsonb,jsonb) TO service_role;

-- Nova tentativa manual: só para falhas recuperáveis ou resultado incerto, e só dentro da própria empresa.
-- A Meta descarta repetições com o mesmo event_id, por isso reenviar não duplica a conversão.
CREATE FUNCTION public.request_meta_capi_retry(p_event uuid, p_company text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e meta_capi_lead_events;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO e FROM meta_capi_lead_events WHERE id = p_event AND company_key = p_company FOR UPDATE;
 IF e IS NULL THEN RETURN 'not_found'; END IF;
 IF NOT e.retryable OR e.status NOT IN ('failed','unknown','retry_scheduled') THEN RETURN 'not_retryable'; END IF;
 IF e.attempts >= 10 THEN RETURN 'limit'; END IF;
 UPDATE meta_capi_lead_events SET status = 'retry_scheduled', next_attempt_at = now(), updated_at = now() WHERE id = e.id;
 RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.request_meta_capi_retry(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_meta_capi_retry(uuid,text) TO service_role;