-- Investimento em anúncios da Meta por empresa (Gravon ou cliente). Só informativo: nunca vira despesa do Financeiro.
CREATE TABLE public.meta_ads_spend_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_kind text NOT NULL CHECK (owner_kind IN ('gravon','client')),
 client_id uuid REFERENCES public.crm_clients(id),
 ad_account_id text NOT NULL UNIQUE CHECK (ad_account_id ~ '^act_[0-9]{5,25}$'),
 account_name text NOT NULL DEFAULT '' CHECK (length(account_name) <= 200),
 currency text NOT NULL DEFAULT '' CHECK (currency = '' OR currency ~ '^[A-Z]{3}$'),
 timezone text NOT NULL DEFAULT '' CHECK (length(timezone) <= 80),
 active boolean NOT NULL DEFAULT true,
 sync_enabled boolean NOT NULL DEFAULT false,
 last_test_at timestamptz,
 last_test_ok boolean,
 last_test_code text CHECK (last_test_code IS NULL OR length(last_test_code) <= 80),
 last_sync_at timestamptz,
 last_sync_status text CHECK (last_sync_status IS NULL OR last_sync_status IN ('ok','failed')),
 last_sync_code text CHECK (last_sync_code IS NULL OR length(last_sync_code) <= 80),
 synced_from date,
 revision integer NOT NULL DEFAULT 1,
 created_by text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((owner_kind = 'client') = (client_id IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE ON public.meta_ads_spend_accounts TO service_role;
REVOKE ALL ON public.meta_ads_spend_accounts FROM PUBLIC, anon, authenticated;
ALTER TABLE public.meta_ads_spend_accounts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_ads_spend_accounts IS 'Contas de anúncios da Meta vinculadas a uma única empresa (Gravon ou cliente). Importação só após teste e ativação.';

CREATE TABLE public.meta_ads_spend_daily (
 ad_account_id text NOT NULL REFERENCES public.meta_ads_spend_accounts(ad_account_id),
 spend_date date NOT NULL,
 campaign_id text NOT NULL CHECK (campaign_id ~ '^[0-9]{1,30}$'),
 campaign_name text NOT NULL DEFAULT '' CHECK (length(campaign_name) <= 400),
 adset_id text NOT NULL CHECK (adset_id ~ '^[0-9]{1,30}$'),
 adset_name text NOT NULL DEFAULT '' CHECK (length(adset_name) <= 400),
 spend_cents bigint NOT NULL CHECK (spend_cents >= 0),
 currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (ad_account_id, spend_date, adset_id)
);
CREATE INDEX meta_ads_spend_daily_date_idx ON public.meta_ads_spend_daily (spend_date);
GRANT SELECT, INSERT, UPDATE ON public.meta_ads_spend_daily TO service_role;
REVOKE ALL ON public.meta_ads_spend_daily FROM PUBLIC, anon, authenticated;
ALTER TABLE public.meta_ads_spend_daily ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.meta_ads_spend_daily IS 'Gasto diário por conjunto de anúncios lido da Meta; uma linha por conta/dia/conjunto (reimportar substitui o valor). Nunca é despesa do Financeiro nem soma com Open Finance.';

CREATE TABLE public.meta_ads_spend_runner (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 token text NOT NULL DEFAULT replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 last_run_at timestamptz,
 last_result jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO public.meta_ads_spend_runner (id) VALUES (true);
GRANT SELECT, UPDATE ON public.meta_ads_spend_runner TO service_role;
REVOKE ALL ON public.meta_ads_spend_runner FROM PUBLIC, anon, authenticated;
ALTER TABLE public.meta_ads_spend_runner ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.meta_ads_spend_runner.token IS 'Token privado da importação diária; lido só pelo pg_cron e pelo servidor. Nunca exibido.';