CREATE TABLE public.b2b_lookup_cache (
 query_key text PRIMARY KEY CHECK(length(query_key)=64), provider text NOT NULL CHECK(provider IN ('public','deskdata')),
 state text NOT NULL CHECK(state IN ('reserved','success','failed')), profile jsonb, checked_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NOT NULL,
 CHECK(profile IS NULL OR octet_length(profile::text)<=20000)
);
GRANT ALL ON public.b2b_lookup_cache TO service_role;
REVOKE ALL ON public.b2b_lookup_cache FROM PUBLIC,anon,authenticated;
ALTER TABLE public.b2b_lookup_cache ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.b2b_lookup_cache IS 'Private sanitized CNPJ results and durable paid claims; no raw provider payload, CPF or sensitive person-basic fields. Failed/uncertain paid claims block automatic repetition. Full CRM session checked before all access.';
CREATE FUNCTION public.claim_b2b_lookup(p_key text,p_provider text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE inserted integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
 IF p_provider IS DISTINCT FROM 'deskdata' OR p_key !~ '^[a-f0-9]{64}$' OR p_key IS NULL THEN RAISE EXCEPTION 'invalid_claim'; END IF;
 INSERT INTO b2b_lookup_cache(query_key,provider,state,valid_until) VALUES(p_key,p_provider,'reserved',now()+interval '30 days') ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 RETURN inserted=1;
END $$;
REVOKE ALL ON FUNCTION public.claim_b2b_lookup(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_b2b_lookup(text,text) TO service_role;