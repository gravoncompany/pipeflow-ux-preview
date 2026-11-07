-- Central de Notificações: inscrições push, preferências por evento/canal e registro com deduplicação.
-- Acesso somente pelo papel de serviço (servidor); sem políticas para anon/authenticated.

CREATE TABLE public.crm_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  disabled_at timestamptz
);

CREATE TABLE public.crm_notification_prefs (
  event text NOT NULL,
  channel text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event, channel)
);

CREATE TABLE public.crm_notification_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  email_target text NOT NULL DEFAULT '',
  whatsapp_target text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  event text NOT NULL,
  channel text NOT NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (event_key, channel)
);

ALTER TABLE public.crm_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_notification_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.crm_push_subscriptions FROM anon, authenticated;
REVOKE ALL ON public.crm_notification_prefs FROM anon, authenticated;
REVOKE ALL ON public.crm_notification_settings FROM anon, authenticated;
REVOKE ALL ON public.crm_notification_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_push_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_notification_prefs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_notification_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_notification_log TO service_role;

-- Reserva atômica de envio: a mesma notificação (evento + canal) nunca sai duas vezes.
CREATE FUNCTION public.claim_crm_notification(p_event_key text, p_event text, p_channel text, p_title text, p_body text, p_url text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
  INSERT INTO public.crm_notification_log (event_key, event, channel, title, body, url)
  VALUES (left(p_event_key, 300), left(p_event, 60), left(p_channel, 20), left(p_title, 200), left(p_body, 1000), left(p_url, 500))
  ON CONFLICT (event_key, channel) DO NOTHING
  RETURNING id INTO n;
  RETURN n;
END $$;

CREATE FUNCTION public.finish_crm_notification(p_id uuid, p_status text, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
  IF p_status NOT IN ('sent', 'failed', 'skipped') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.crm_notification_log
  SET status = p_status, error = left(coalesce(p_error, ''), 300), sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END
  WHERE id = p_id AND status = 'pending';
END $$;