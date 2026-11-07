CREATE TABLE public.crm_external_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('hypercash')),
  name text NOT NULL DEFAULT 'HyperCash',
  encrypted_credentials text,
  status text NOT NULL DEFAULT 'desativada' CHECK (status IN ('ativa','desativada','erro')),
  last_check_at timestamptz,
  last_check_status text,
  last_sync_at timestamptz,
  last_sync_status text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider)
);
GRANT ALL ON public.crm_external_integrations TO service_role;
ALTER TABLE public.crm_external_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_external_integrations FROM anon, authenticated;

CREATE TABLE public.crm_hypercash_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id text NOT NULL UNIQUE,
  customer_name text,
  customer_email text,
  product_name text,
  amount_cents integer,
  frequency text,
  status text,
  next_billing_date text,
  last_payment_at timestamptz,
  client_id uuid REFERENCES public.crm_clients(id),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_hc_subscriptions_client ON public.crm_hypercash_subscriptions(client_id);
GRANT ALL ON public.crm_hypercash_subscriptions TO service_role;
ALTER TABLE public.crm_hypercash_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_hypercash_subscriptions FROM anon, authenticated;

CREATE TABLE public.crm_hypercash_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id text NOT NULL UNIQUE,
  subscription_id text,
  transaction_id text,
  order_id text,
  amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  billing_date text,
  paid_at timestamptz,
  customer_name text,
  customer_email text,
  client_id uuid REFERENCES public.crm_clients(id),
  finance_payment_id uuid REFERENCES public.crm_client_payments(id),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_hc_charges_client ON public.crm_hypercash_charges(client_id);
CREATE INDEX crm_hc_charges_status ON public.crm_hypercash_charges(status);
GRANT ALL ON public.crm_hypercash_charges TO service_role;
ALTER TABLE public.crm_hypercash_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_hypercash_charges FROM anon, authenticated;

CREATE TABLE public.crm_hypercash_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.crm_external_integrations(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok','erro')),
  subscriptions_count integer NOT NULL DEFAULT 0,
  charges_count integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT ''
);
GRANT ALL ON public.crm_hypercash_sync_log TO service_role;
ALTER TABLE public.crm_hypercash_sync_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_hypercash_sync_log FROM anon, authenticated;