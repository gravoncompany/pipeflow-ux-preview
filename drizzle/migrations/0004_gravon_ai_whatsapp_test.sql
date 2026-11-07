CREATE TABLE public.gravon_ai_test_settings (id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), enabled boolean NOT NULL DEFAULT false, authorized_phone text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.gravon_ai_test_settings TO service_role;
ALTER TABLE public.gravon_ai_test_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.gravon_ai_test_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event text NOT NULL, phone text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'ok', detail text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.gravon_ai_test_log TO service_role;
ALTER TABLE public.gravon_ai_test_log ENABLE ROW LEVEL SECURITY;

INSERT INTO public.gravon_ai_test_settings (id, enabled, authorized_phone) VALUES (1, false, '');