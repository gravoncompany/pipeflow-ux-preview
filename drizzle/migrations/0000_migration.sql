CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL UNIQUE,
  instance text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  phone_key text NOT NULL DEFAULT '',
  from_me boolean NOT NULL DEFAULT false,
  push_name text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_messages_phone_key_idx ON public.whatsapp_messages (phone_key, sent_at);
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;