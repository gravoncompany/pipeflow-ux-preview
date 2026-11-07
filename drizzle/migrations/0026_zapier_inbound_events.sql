CREATE TABLE public.zapier_inbound_events (
  event_id text PRIMARY KEY CHECK (char_length(event_id) BETWEEN 1 AND 200),
  pipeline_id uuid,
  lead_id uuid,
  created_lead boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.zapier_inbound_events TO service_role;
ALTER TABLE public.zapier_inbound_events ENABLE ROW LEVEL SECURITY;