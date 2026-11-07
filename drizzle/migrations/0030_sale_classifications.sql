ALTER TABLE public.leads ADD COLUMN closed_at date;
COMMENT ON COLUMN public.leads.closed_at IS 'Data da transição para a etapa fechado; preenchida na transição, nunca pela classificação.';

CREATE OR REPLACE FUNCTION public.set_lead_closed_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stage = 'fechado' AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'fechado') THEN
    NEW.closed_at := current_date;
  ELSIF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM 'fechado' THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER leads_closed_at_insert BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_lead_closed_at();
CREATE TRIGGER leads_closed_at_update BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_lead_closed_at();

CREATE TABLE public.sale_classifications (
  id uuid primary key default gen_random_uuid(),
  company_key text not null default 'crm:1',
  lead_id uuid not null references public.leads(id) on delete cascade,
  customer_key text not null,
  sale_type text not null check (sale_type in ('novo','renovacao','adicional')),
  first_acquisition boolean not null,
  closed_on date not null,
  classified_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  revision bigint not null default 1
);
CREATE UNIQUE INDEX sale_classifications_lead_key ON public.sale_classifications(lead_id);
CREATE INDEX sale_classifications_customer_key ON public.sale_classifications(company_key, customer_key);
GRANT ALL ON public.sale_classifications TO service_role;
ALTER TABLE public.sale_classifications ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER sale_classifications_updated_at BEFORE UPDATE ON public.sale_classifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();