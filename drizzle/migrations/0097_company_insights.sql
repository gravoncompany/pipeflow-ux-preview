CREATE TABLE public.meta_instagram_research_settings (
  company_key text PRIMARY KEY CHECK (company_key ~ '^crm:[0-9]+$'),
  ig_user_id text NOT NULL CHECK (ig_user_id ~ '^[0-9]{6,25}$'),
  ig_username text CHECK (ig_username IS NULL OR length(ig_username) <= 60),
  encrypted_token text NOT NULL CHECK (length(encrypted_token) BETWEEN 20 AND 20000),
  last_check_at timestamptz,
  last_check_status text CHECK (last_check_status IS NULL OR last_check_status IN ('ok','failed')),
  last_check_http integer,
  last_check_code text CHECK (last_check_code IS NULL OR length(last_check_code) <= 80),
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.meta_instagram_research_settings TO service_role;
ALTER TABLE public.meta_instagram_research_settings ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_instagram_research_settings IS 'Private Instagram Business Discovery access (official Graph API); token AES-GCM encrypted server-side; service-only.';

CREATE TABLE public.b2b_company_insights (
  lead_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
  insight jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text CHECK (error_code IS NULL OR length(error_code) <= 80),
  lease_token uuid,
  lease_until timestamptz,
  analyzed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.b2b_company_insights TO service_role;
ALTER TABLE public.b2b_company_insights ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.b2b_company_insights IS 'Private AI summary of a company''s own website and public Instagram (Business Discovery). Never changes the lead; only informs approved e-mail personalization. Service-only.';

CREATE OR REPLACE FUNCTION public.claim_b2b_company_insight(p_lead uuid, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.b2b_company_insights AS i (lead_id, status, lease_token, lease_until, updated_at)
  VALUES (p_lead, 'running', p_token, now() + interval '3 minutes', now())
  ON CONFLICT (lead_id) DO UPDATE SET status = 'running', lease_token = p_token, lease_until = now() + interval '3 minutes', error_code = NULL, updated_at = now()
  WHERE i.status <> 'running' OR i.lease_until IS NULL OR i.lease_until < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

CREATE OR REPLACE FUNCTION public.finish_b2b_company_insight(p_lead uuid, p_token uuid, p_status text, p_insight jsonb, p_sources jsonb, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF p_status NOT IN ('done','error') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.b2b_company_insights SET
    status = p_status,
    insight = CASE WHEN p_status = 'done' THEN p_insight ELSE insight END,
    sources = COALESCE(p_sources, '[]'::jsonb),
    error_code = CASE WHEN p_status = 'error' THEN left(p_error, 80) ELSE NULL END,
    analyzed_at = CASE WHEN p_status = 'done' THEN now() ELSE analyzed_at END,
    lease_token = NULL, lease_until = NULL, updated_at = now()
  WHERE lead_id = p_lead AND lease_token = p_token AND status = 'running';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

REVOKE ALL ON FUNCTION public.claim_b2b_company_insight(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_b2b_company_insight(uuid, uuid, text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_b2b_company_insight(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_b2b_company_insight(uuid, uuid, text, jsonb, jsonb, text) TO service_role;