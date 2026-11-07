-- Fix: text[] appends use array_append (a bare 'cnpj' literal was parsed as an array literal).
CREATE OR REPLACE FUNCTION public.apply_b2b_public_enrichment(p_lead uuid, p_fields jsonb, p_replace text[], p_cnpj text, p_profile jsonb, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l leads%ROWTYPE; k text; v text; cur text; applied text[] := '{}'; skipped text[] := '{}'; conflict boolean := false; comp b2b_companies%ROWTYPE; cnpj_value text := coalesce(p_cnpj, ''); entry jsonb := NULL; prof jsonb := p_profile;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR (p_profile IS NOT NULL AND (jsonb_typeof(p_profile) <> 'object' OR octet_length(p_profile::text) > 20000))
     OR NOT (cnpj_value = '' OR cnpj_value ~ '^[A-Z0-9]{12}[0-9]{2}$') OR char_length(coalesce(p_note, '')) > 500 THEN RAISE EXCEPTION 'invalid_enrichment'; END IF;
  SELECT * INTO l FROM leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  IF cnpj_value <> '' AND EXISTS (SELECT 1 FROM b2b_companies WHERE cnpj = cnpj_value AND lead_id IS DISTINCT FROM p_lead) THEN conflict := true; cnpj_value := ''; prof := NULL; END IF;
  FOR k, v IN SELECT key, btrim(value) FROM jsonb_each_text(p_fields) LOOP
    IF k NOT IN ('company','email','whatsapp','website') OR (conflict AND k = 'company') OR v = '' OR char_length(v) > 700 THEN CONTINUE; END IF;
    cur := CASE k WHEN 'company' THEN l.company WHEN 'email' THEN l.email WHEN 'whatsapp' THEN l.whatsapp ELSE l.website END;
    IF btrim(cur) = btrim(v) THEN CONTINUE; END IF;
    IF btrim(cur) <> '' AND NOT (k = ANY(coalesce(p_replace, '{}'))) THEN skipped := array_append(skipped, k::text); CONTINUE; END IF;
    applied := array_append(applied, k::text);
    IF k = 'company' THEN l.company := v; ELSIF k = 'email' THEN l.email := lower(v); ELSIF k = 'whatsapp' THEN l.whatsapp := v; ELSE l.website := v; END IF;
  END LOOP;

  SELECT * INTO comp FROM b2b_companies WHERE lead_id = p_lead FOR UPDATE;
  IF comp.id IS NOT NULL THEN
    IF cnpj_value <> '' AND comp.cnpj <> '' AND comp.cnpj <> cnpj_value AND NOT ('cnpj' = ANY(coalesce(p_replace, '{}'))) THEN skipped := array_append(skipped, 'cnpj'::text); cnpj_value := ''; prof := NULL; END IF;
    IF cnpj_value <> '' AND comp.cnpj IS DISTINCT FROM cnpj_value THEN applied := array_append(applied, 'cnpj'::text); END IF;
    UPDATE b2b_companies SET cnpj = CASE WHEN cnpj_value <> '' THEN cnpj_value ELSE cnpj END, profile = coalesce(prof, profile) WHERE id = comp.id;
  ELSIF prof IS NOT NULL THEN
    IF cnpj_value <> '' THEN applied := array_append(applied, 'cnpj'::text); END IF;
    INSERT INTO b2b_companies (cnpj, lead_id, place_id, profile) VALUES (cnpj_value, p_lead, '', prof);
  END IF;

  IF array_length(applied, 1) IS NOT NULL THEN
    entry := jsonb_build_object('id', gen_random_uuid()::text, 'date', to_char(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'), 'text', left(coalesce(nullif(p_note, ''), 'Consulta Pública Gratuita') || ' · campos preenchidos: ' || array_to_string(ARRAY(SELECT CASE x WHEN 'company' THEN 'empresa' WHEN 'whatsapp' THEN 'telefone/WhatsApp' WHEN 'email' THEN 'e-mail' WHEN 'website' THEN 'site' ELSE 'CNPJ' END FROM unnest(applied) x), ', '), 600), 'source', 'b2b');
    UPDATE leads SET company = l.company, email = l.email, whatsapp = l.whatsapp, website = l.website, history = jsonb_build_array(entry) || history WHERE id = p_lead;
  END IF;
  RETURN jsonb_build_object('applied', to_jsonb(applied), 'skipped', to_jsonb(skipped), 'cnpjConflict', conflict, 'entry', entry);
END $$;
REVOKE ALL ON FUNCTION public.apply_b2b_public_enrichment(uuid, jsonb, text[], text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_b2b_public_enrichment(uuid, jsonb, text[], text, jsonb, text) TO service_role;