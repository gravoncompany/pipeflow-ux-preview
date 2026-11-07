CREATE TABLE public.b2b_public_enrichment_jobs (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','found','no_data','error')),
  origin text NOT NULL CHECK (origin IN ('bulk','card')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  lease_until timestamptz,
  result jsonb CHECK (result IS NULL OR octet_length(result::text) <= 40000),
  applied jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applied) = 'array'),
  outcome_code text CHECK (outcome_code IS NULL OR length(outcome_code) <= 60),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX b2b_public_enrichment_jobs_queue ON public.b2b_public_enrichment_jobs (status, requested_at);
GRANT ALL ON public.b2b_public_enrichment_jobs TO service_role;
ALTER TABLE public.b2b_public_enrichment_jobs ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.b2b_public_enrichment_jobs IS 'Free public company lookup per lead (one row per lead = dedupe). Service-only; results never contain paid data.';

CREATE FUNCTION public.claim_b2b_public_enrichment(p_limit integer) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  UPDATE b2b_public_enrichment_jobs SET status = 'error', outcome_code = 'lease_expired', lease_until = NULL, finished_at = now(), updated_at = now()
    WHERE status = 'running' AND lease_until < now() AND attempts >= 3;
  RETURN QUERY
  UPDATE b2b_public_enrichment_jobs j SET status = 'running', attempts = j.attempts + 1, lease_until = now() + interval '3 minutes', started_at = now(), updated_at = now()
  WHERE j.lead_id IN (
    SELECT q.lead_id FROM b2b_public_enrichment_jobs q
    WHERE q.status = 'queued' OR (q.status = 'running' AND q.lease_until < now())
    ORDER BY q.requested_at LIMIT least(greatest(coalesce(p_limit, 1), 1), 5)
    FOR UPDATE SKIP LOCKED)
  RETURNING j.lead_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_b2b_public_enrichment(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_b2b_public_enrichment(integer) TO service_role;

-- Fills only empty card fields unless the field is explicitly listed in p_replace (user confirmation).
CREATE FUNCTION public.apply_b2b_public_enrichment(p_lead uuid, p_fields jsonb, p_replace text[], p_cnpj text, p_profile jsonb, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l leads%ROWTYPE; k text; v text; cur text; applied text[] := '{}'; skipped text[] := '{}'; conflict boolean := false; comp b2b_companies%ROWTYPE; cnpj_value text := coalesce(p_cnpj, '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR (p_profile IS NOT NULL AND (jsonb_typeof(p_profile) <> 'object' OR octet_length(p_profile::text) > 20000))
     OR NOT (cnpj_value = '' OR cnpj_value ~ '^[A-Z0-9]{12}[0-9]{2}$') OR char_length(coalesce(p_note, '')) > 500 THEN RAISE EXCEPTION 'invalid_enrichment'; END IF;
  SELECT * INTO l FROM leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  FOR k, v IN SELECT key, btrim(value) FROM jsonb_each_text(p_fields) LOOP
    IF k NOT IN ('company','email','whatsapp','website') OR v = '' OR char_length(v) > 700 THEN CONTINUE; END IF;
    cur := CASE k WHEN 'company' THEN l.company WHEN 'email' THEN l.email WHEN 'whatsapp' THEN l.whatsapp ELSE l.website END;
    IF btrim(cur) = btrim(v) THEN CONTINUE; END IF;
    IF btrim(cur) <> '' AND NOT (k = ANY(coalesce(p_replace, '{}'))) THEN skipped := skipped || k; CONTINUE; END IF;
    applied := applied || k;
    IF k = 'company' THEN l.company := v; ELSIF k = 'email' THEN l.email := lower(v); ELSIF k = 'whatsapp' THEN l.whatsapp := v; ELSE l.website := v; END IF;
  END LOOP;

  SELECT * INTO comp FROM b2b_companies WHERE lead_id = p_lead FOR UPDATE;
  IF cnpj_value <> '' AND EXISTS (SELECT 1 FROM b2b_companies WHERE cnpj = cnpj_value AND lead_id IS DISTINCT FROM p_lead) THEN conflict := true; cnpj_value := ''; END IF;
  IF comp.id IS NOT NULL THEN
    IF cnpj_value <> '' AND comp.cnpj <> '' AND comp.cnpj <> cnpj_value AND NOT ('cnpj' = ANY(coalesce(p_replace, '{}'))) THEN skipped := skipped || 'cnpj'; cnpj_value := ''; END IF;
    IF cnpj_value <> '' AND comp.cnpj IS DISTINCT FROM cnpj_value THEN applied := applied || 'cnpj'; END IF;
    UPDATE b2b_companies SET cnpj = CASE WHEN cnpj_value <> '' THEN cnpj_value ELSE cnpj END, profile = coalesce(p_profile, profile) WHERE id = comp.id;
  ELSIF p_profile IS NOT NULL THEN
    IF cnpj_value <> '' THEN applied := applied || 'cnpj'; END IF;
    INSERT INTO b2b_companies (cnpj, lead_id, place_id, profile) VALUES (cnpj_value, p_lead, '', p_profile);
  END IF;

  IF array_length(applied, 1) IS NOT NULL THEN
    UPDATE leads SET company = l.company, email = l.email, whatsapp = l.whatsapp, website = l.website,
      history = jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'date', to_char(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'), 'text', left(coalesce(nullif(p_note, ''), 'Consulta Pública Gratuita') || ' · campos preenchidos: ' || array_to_string(applied, ', '), 600), 'source', 'b2b')) || history
    WHERE id = p_lead;
  END IF;
  RETURN jsonb_build_object('applied', to_jsonb(applied), 'skipped', to_jsonb(skipped), 'cnpjConflict', conflict);
END $$;
REVOKE ALL ON FUNCTION public.apply_b2b_public_enrichment(uuid, jsonb, text[], text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_b2b_public_enrichment(uuid, jsonb, text[], text, jsonb, text) TO service_role;