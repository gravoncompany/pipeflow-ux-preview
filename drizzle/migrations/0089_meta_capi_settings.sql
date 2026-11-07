CREATE TABLE public.meta_capi_settings (
  company_key text PRIMARY KEY CHECK (company_key ~ '^crm:[0-9]+$'),
  pixel_id text NOT NULL CHECK (pixel_id ~ '^[0-9]{6,25}$'),
  encrypted_token text NOT NULL CHECK (length(encrypted_token) BETWEEN 20 AND 20000),
  enabled boolean NOT NULL DEFAULT true,
  -- Production sends stay off until the user validates; nothing in the app turns this on yet.
  production_enabled boolean NOT NULL DEFAULT false CHECK (production_enabled = false),
  pixel_name text CHECK (pixel_name IS NULL OR length(pixel_name) <= 200),
  last_check_at timestamptz,
  last_check_status text CHECK (last_check_status IS NULL OR last_check_status IN ('ok','failed')),
  last_check_http integer,
  last_check_code text CHECK (last_check_code IS NULL OR length(last_check_code) <= 80),
  last_test_event_at timestamptz,
  last_test_event_status text CHECK (last_test_event_status IS NULL OR last_test_event_status IN ('accepted','failed')),
  last_test_event_http integer,
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.meta_capi_settings TO service_role;
ALTER TABLE public.meta_capi_settings ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_capi_settings IS 'Private Meta Conversions API configuration; token AES-GCM encrypted server-side; service-only.';