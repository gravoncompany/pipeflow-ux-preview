ALTER TABLE public.b2b_instagram_profiles ADD COLUMN IF NOT EXISTS contact_sources jsonb NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS public_checked_at timestamptz;
CREATE TABLE public.b2b_instagram_public_cache (cache_key text PRIMARY KEY, result jsonb NOT NULL DEFAULT '{}', checked_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NOT NULL);
GRANT ALL ON public.b2b_instagram_public_cache TO service_role;
REVOKE ALL ON public.b2b_instagram_public_cache FROM PUBLIC, anon, authenticated;
ALTER TABLE public.b2b_instagram_public_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_instagram_public_cache FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.b2b_instagram_public_cache IS 'Private bounded public commercial-contact evidence; no paid Apify runs, no raw pages or credentials.';