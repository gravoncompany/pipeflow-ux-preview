CREATE TABLE public.commercial_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_key text NOT NULL DEFAULT 'crm:1',
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  action_plan text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_key, month)
);
GRANT ALL ON public.commercial_goals TO service_role;
ALTER TABLE public.commercial_goals ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER commercial_goals_updated_at BEFORE UPDATE ON public.commercial_goals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();