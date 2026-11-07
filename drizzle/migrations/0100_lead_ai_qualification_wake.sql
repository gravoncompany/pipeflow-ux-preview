-- Avaliação acordada por evento (entrada em Qualificação ou nova mensagem do cliente), sem varredura frequente.
ALTER TABLE public.lead_ai_qualification_runner ADD COLUMN job_url text NOT NULL DEFAULT '' CHECK (job_url = '' OR job_url ~ '^https://[a-z0-9.-]+/api/public/jobs/lead-qualification$');

CREATE FUNCTION public.wake_lead_ai_qualification() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record;
BEGIN
 SELECT token, job_url, enabled INTO r FROM lead_ai_qualification_runner WHERE id;
 IF r IS NULL OR NOT r.enabled OR r.job_url = '' THEN RETURN; END IF;
 BEGIN
  PERFORM net.http_post(url := r.job_url, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||r.token), body := '{}'::jsonb, timeout_milliseconds := 60000);
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lead_ai_qualification_wake_failed';
 END;
END $$;
REVOKE ALL ON FUNCTION public.wake_lead_ai_qualification() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_lead_ai_qualification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE queued boolean := false;
BEGIN
 IF NEW.pipeline_id IS NULL AND NEW.stage = 'qualificacao'
    AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'qualificacao' OR OLD.pipeline_id IS NOT NULL) THEN
  BEGIN
   INSERT INTO lead_ai_qualifications AS q (lead_id) VALUES (NEW.id)
   ON CONFLICT (lead_id) DO UPDATE SET state='pending', entered_stage_at=now(), next_check_at=now(), attempts=0,
     lease_token=NULL, lease_until=NULL, last_error='', updated_at=now()
   WHERE q.status <> 'qualificado'
   RETURNING true INTO queued;
   IF queued THEN PERFORM wake_lead_ai_qualification(); END IF;
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'lead_ai_qualification_enqueue_failed';
  END;
 END IF;
 RETURN NEW;
END $$;

-- Nova mensagem do cliente para um lead ainda "Em análise" na etapa Qualificação acorda uma reavaliação.
CREATE FUNCTION public.wake_lead_ai_qualification_on_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT NEW.from_me AND EXISTS (
   SELECT 1 FROM lead_ai_qualifications q JOIN leads l ON l.id = q.lead_id
   WHERE q.status = 'em_analise' AND l.pipeline_id IS NULL AND l.stage = 'qualificacao' AND crm_phone_key(l.whatsapp) = NEW.phone_key) THEN
  PERFORM wake_lead_ai_qualification();
 END IF;
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 RAISE WARNING 'lead_ai_qualification_message_wake_failed';
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.wake_lead_ai_qualification_on_message() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER whatsapp_messages_wake_ai_qualification AFTER INSERT ON public.whatsapp_messages
 FOR EACH ROW EXECUTE FUNCTION public.wake_lead_ai_qualification_on_message();

-- Reavaliações sem espera (o lease evita concorrência e a exigência de mensagem nova evita repetição); falhas esperam 30 min.
CREATE OR REPLACE FUNCTION public.finish_lead_ai_qualification(p_lead uuid, p_lease uuid, p_outcome text, p_summary text, p_fit text,
 p_evidence jsonb, p_fingerprint text, p_last_inbound timestamptz, p_error text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q lead_ai_qualifications; l record; s record; company text := 'crm:1'; ev_status text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_outcome NOT IN ('qualified','insufficient','no_conversation','ambiguous','failed') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
 SELECT * INTO q FROM lead_ai_qualifications WHERE lead_id = p_lead FOR UPDATE;
 IF q IS NULL OR q.lease_token IS DISTINCT FROM p_lease THEN RETURN 'lease_lost'; END IF;
 SELECT id, pipeline_id, stage INTO l FROM leads WHERE id = p_lead;
 IF l IS NULL OR l.pipeline_id IS NOT NULL OR (p_outcome = 'qualified' AND l.stage IS DISTINCT FROM 'qualificacao') THEN
  UPDATE lead_ai_qualifications SET state='done', lease_token=NULL, lease_until=NULL, updated_at=now() WHERE lead_id = p_lead;
  RETURN 'stale';
 END IF;
 IF p_outcome = 'qualified' AND (jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence) = 0) THEN RAISE EXCEPTION 'evidence_required'; END IF;
 UPDATE lead_ai_qualifications SET
  status = CASE WHEN p_outcome = 'qualified' THEN 'qualificado' ELSE status END,
  state = CASE p_outcome WHEN 'qualified' THEN 'done' WHEN 'insufficient' THEN 'done' ELSE p_outcome END,
  attempts = CASE WHEN p_outcome = 'failed' THEN attempts + 1 ELSE 0 END,
  next_check_at = CASE WHEN p_outcome = 'failed' THEN now() + interval '30 minutes' ELSE now() END,
  summary = CASE WHEN p_outcome = 'failed' THEN summary ELSE left(coalesce(p_summary,''),4000) END,
  fit_reason = CASE WHEN p_outcome = 'failed' THEN fit_reason ELSE left(coalesce(p_fit,''),2000) END,
  evidence = CASE WHEN p_outcome = 'failed' THEN evidence ELSE coalesce(p_evidence,'[]') END,
  fingerprint = CASE WHEN p_outcome = 'failed' THEN fingerprint ELSE p_fingerprint END,
  last_inbound_at = CASE WHEN p_outcome = 'failed' THEN last_inbound_at ELSE coalesce(p_last_inbound, last_inbound_at) END,
  assessed_at = CASE WHEN p_outcome = 'failed' THEN assessed_at ELSE now() END,
  qualified_at = CASE WHEN p_outcome = 'qualified' THEN now() ELSE qualified_at END,
  last_error = CASE WHEN p_outcome = 'failed' THEN left(coalesce(p_error,''),300) ELSE '' END,
  lease_token = NULL, lease_until = NULL, updated_at = now()
 WHERE lead_id = p_lead;
 IF p_outcome = 'qualified' THEN
  SELECT pixel_id, enabled INTO s FROM meta_capi_settings WHERE company_key = company;
  ev_status := CASE WHEN s IS NULL THEN 'waiting_settings' WHEN NOT s.enabled THEN 'paused' ELSE 'ready' END;
  INSERT INTO meta_capi_lead_events (company_key, lead_id, event_name, event_id, event_time, pixel_id, status)
  VALUES (company, p_lead, 'QualifiedLead', 'pipeflow-qualified-' || p_lead::text, now(), s.pixel_id, ev_status)
  ON CONFLICT (company_key, lead_id, event_name) DO NOTHING;
 END IF;
 RETURN 'ok';
END $$;

UPDATE public.lead_ai_qualification_runner SET job_url = 'https://project--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app/api/public/jobs/lead-qualification' WHERE id;