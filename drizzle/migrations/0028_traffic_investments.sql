CREATE TABLE public.traffic_investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_key text NOT NULL DEFAULT 'crm:1',
  pipeline_key text NOT NULL DEFAULT 'main',
  from_date date NOT NULL,
  to_date date NOT NULL,
  amount numeric(14,2) NULL CHECK (amount IS NULL OR amount >= 0),
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_date <= to_date),
  UNIQUE (company_key, pipeline_key, from_date, to_date)
);
GRANT ALL ON public.traffic_investments TO service_role;
ALTER TABLE public.traffic_investments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER traffic_investments_updated_at BEFORE UPDATE ON public.traffic_investments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();