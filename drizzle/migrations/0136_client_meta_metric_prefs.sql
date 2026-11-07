CREATE TABLE IF NOT EXISTS public.crm_client_metric_prefs (
 client_id uuid PRIMARY KEY REFERENCES public.crm_clients(id) ON DELETE CASCADE,
 metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics)='array' AND jsonb_array_length(metrics) BETWEEN 1 AND 12),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.crm_client_metric_prefs TO service_role;
REVOKE ALL ON public.crm_client_metric_prefs FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_client_metric_prefs ENABLE ROW LEVEL SECURITY;