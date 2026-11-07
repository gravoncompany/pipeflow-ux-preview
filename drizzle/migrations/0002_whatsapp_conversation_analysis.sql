CREATE TABLE public.whatsapp_analyses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone_key text NOT NULL, scope_start text NOT NULL DEFAULT '', scope_end text NOT NULL DEFAULT '', fingerprint text NOT NULL, result jsonb NOT NULL, analyzed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(phone_key, scope_start, scope_end));
GRANT ALL ON public.whatsapp_analyses TO service_role;
ALTER TABLE public.whatsapp_analyses ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.whatsapp_ai_control (id integer PRIMARY KEY CHECK (id = 1), blocked_status integer, blocked_message text, blocked_kind text, updated_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.whatsapp_ai_control TO service_role;
ALTER TABLE public.whatsapp_ai_control ENABLE ROW LEVEL SECURITY;