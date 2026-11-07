-- Qualificação automática da Gravon IA no funil principal + evento "lead qualificado" preparado para a Meta.
-- Nada aqui altera cards (etapa, etiquetas, histórico) nem envia mensagens.

CREATE TABLE public.lead_ai_qualifications (
 lead_id uuid PRIMARY KEY,
 status text NOT NULL DEFAULT 'em_analise' CHECK (status IN ('em_analise','qualificado')),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','done','no_conversation','ambiguous','failed')),
 entered_stage_at timestamptz NOT NULL DEFAULT now(),
 next_check_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,
 lease_until timestamptz,
 summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 4000),
 fit_reason text NOT NULL DEFAULT '' CHECK (length(fit_reason) <= 2000),
 evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence) = 'array'),
 fingerprint text,
 last_inbound_at timestamptz,
 assessed_at timestamptz,
 qualified_at timestamptz,
 last_error text NOT NULL DEFAULT '' CHECK (length(last_error) <= 300),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_ai_qualifications_due_idx ON public.lead_ai_qualifications (next_check_at) WHERE status = 'em_analise';
GRANT SELECT ON public.lead_ai_qualifications TO service_role;
REVOKE ALL ON public.lead_ai_qualifications FROM PUBLIC, anon, authenticated;
ALTER TABLE public.lead_ai_qualifications ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.lead_ai_qualifications IS 'Status automático da Gravon IA (Em análise/Qualificado) para leads do funil principal na etapa Qualificação. Service-only; nunca move cards.';

CREATE TABLE public.meta_capi_lead_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_key text NOT NULL CHECK (company_key ~ '^crm:[0-9]+$'),
 lead_id uuid NOT NULL,
 event_name text NOT NULL CHECK (event_name IN ('QualifiedLead')),
 event_id text NOT NULL UNIQUE,
 event_time timestamptz NOT NULL,
 pixel_id text CHECK (pixel_id IS NULL OR pixel_id ~ '^[0-9]{6,25}$'),
 status text NOT NULL CHECK (status IN ('waiting_settings','paused','ready','sending','sent','failed','unknown','pixel_changed')),
 last_http integer,
 last_code text CHECK (last_code IS NULL OR length(last_code) <= 80),
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (company_key, lead_id, event_name)
);
GRANT SELECT, UPDATE ON public.meta_capi_lead_events TO service_role;
REVOKE ALL ON public.meta_capi_lead_events FROM PUBLIC, anon, authenticated;
ALTER TABLE public.meta_capi_lead_events ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_capi_lead_events IS 'Eventos da API de Conversões preparados quando um lead vira Qualificado; um por lead/evento/empresa. Só são enviados com production_enabled, que segue travado em false.';

CREATE TABLE public.lead_ai_qualification_runner (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 enabled boolean NOT NULL DEFAULT true,
 token text NOT NULL DEFAULT replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 ai_blocked_reason text NOT NULL DEFAULT '' CHECK (length(ai_blocked_reason) <= 300),
 last_run_at timestamptz,
 last_result jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO public.lead_ai_qualification_runner (id) VALUES (true);
GRANT SELECT, UPDATE ON public.lead_ai_qualification_runner TO service_role;
REVOKE ALL ON public.lead_ai_qualification_runner FROM PUBLIC, anon, authenticated;
ALTER TABLE public.lead_ai_qualification_runner ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.lead_ai_qualification_runner.token IS 'Token privado do executor agendado; lido só pelo pg_cron e pelo servidor. Nunca exibido.';

-- Entrada na etapa Qualificação do funil principal enfileira uma avaliação. Quem já é Qualificado continua Qualificado.
CREATE FUNCTION public.enqueue_lead_ai_qualification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.pipeline_id IS NULL AND NEW.stage = 'qualificacao'
    AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'qualificacao' OR OLD.pipeline_id IS NOT NULL) THEN
  BEGIN
   INSERT INTO lead_ai_qualifications AS q (lead_id) VALUES (NEW.id)
   ON CONFLICT (lead_id) DO UPDATE SET state='pending', entered_stage_at=now(), next_check_at=now(), attempts=0,
     lease_token=NULL, lease_until=NULL, last_error='', updated_at=now()
   WHERE q.status <> 'qualificado';
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'lead_ai_qualification_enqueue_failed';
  END;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_lead_ai_qualification() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER leads_enqueue_ai_qualification AFTER INSERT OR UPDATE OF stage, pipeline_id ON public.leads
 FOR EACH ROW EXECUTE FUNCTION public.enqueue_lead_ai_qualification();

-- Reivindica avaliações devidas: novas entradas, falhas com nova tentativa e "Em análise" com mensagem nova do cliente.
CREATE FUNCTION public.claim_lead_ai_qualifications(p_lease uuid, p_limit integer)
RETURNS TABLE(lead_id uuid, name text, company text, service text, whatsapp text, same_phone integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 RETURN QUERY
 WITH due AS (
  SELECT q.lead_id FROM lead_ai_qualifications q JOIN leads l ON l.id = q.lead_id
  WHERE q.status = 'em_analise' AND l.pipeline_id IS NULL AND l.stage = 'qualificacao'
    AND q.next_check_at <= now() AND (q.lease_until IS NULL OR q.lease_until < now())
    AND (q.state IN ('pending','running')
      OR (q.state = 'failed' AND q.attempts < 3)
      OR (q.state IN ('done','no_conversation','ambiguous') AND EXISTS (
        SELECT 1 FROM whatsapp_messages m WHERE m.phone_key = crm_phone_key(l.whatsapp) AND NOT m.from_me
          AND m.sent_at > coalesce(q.last_inbound_at, '-infinity'::timestamptz))))
  ORDER BY q.next_check_at LIMIT least(greatest(p_limit,1),10)
  FOR UPDATE OF q SKIP LOCKED
 ), claimed AS (
  UPDATE lead_ai_qualifications q SET state='running', lease_token=p_lease, lease_until=now()+interval '5 minutes', updated_at=now()
  FROM due WHERE q.lead_id = due.lead_id RETURNING q.lead_id
 )
 SELECT l.id, l.name, l.company, l.service, l.whatsapp,
  (SELECT count(*)::int FROM leads y WHERE y.pipeline_id IS NULL AND crm_phone_key(y.whatsapp) = crm_phone_key(l.whatsapp))
 FROM claimed c JOIN leads l ON l.id = c.lead_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_lead_ai_qualifications(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lead_ai_qualifications(uuid,integer) TO service_role;

-- Grava o resultado. "qualified" exige evidência e prepara (uma única vez) o evento da Meta com o Pixel da empresa.
CREATE FUNCTION public.finish_lead_ai_qualification(p_lead uuid, p_lease uuid, p_outcome text, p_summary text, p_fit text,
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
  next_check_at = now() + CASE WHEN p_outcome = 'failed' THEN interval '30 minutes' ELSE interval '15 minutes' END,
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
REVOKE ALL ON FUNCTION public.finish_lead_ai_qualification(uuid,uuid,text,text,text,jsonb,text,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_lead_ai_qualification(uuid,uuid,text,text,text,jsonb,text,timestamptz,text) TO service_role;

-- Reserva atômica de um evento para envio: só com production_enabled e o mesmo Pixel configurado. Sem reenvio.
CREATE FUNCTION public.claim_meta_capi_lead_events(p_limit integer)
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
  WHERE c.company_key = e.company_key AND e.status = 'ready' AND e.pixel_id IS DISTINCT FROM c.pixel_id;
 RETURN QUERY
 UPDATE meta_capi_lead_events e SET status='sending', updated_at=now()
 FROM (SELECT x.id AS eid FROM meta_capi_lead_events x JOIN meta_capi_settings c ON c.company_key = x.company_key
       WHERE x.status='ready' AND c.enabled AND c.production_enabled AND x.pixel_id = c.pixel_id
       ORDER BY x.created_at LIMIT least(greatest(p_limit,1),20) FOR UPDATE OF x SKIP LOCKED) d
 WHERE e.id = d.eid
 RETURNING e.id, e.lead_id, e.event_id, e.event_name, e.event_time, e.pixel_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_meta_capi_lead_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meta_capi_lead_events(integer) TO service_role;