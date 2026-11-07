CREATE TABLE public.crm_meta_ad_accounts (
 account_id text PRIMARY KEY CHECK (account_id ~ '^act_[0-9]{5,25}$'),
 account_name text NOT NULL DEFAULT '' CHECK (char_length(account_name) <= 500),
 business_id text NOT NULL DEFAULT '' CHECK (char_length(business_id) <= 40),
 business_name text NOT NULL DEFAULT '' CHECK (char_length(business_name) <= 500),
 account_status integer,
 accessible boolean NOT NULL DEFAULT true,
 added_by text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 last_synced_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_meta_ad_accounts TO service_role;
REVOKE ALL ON public.crm_meta_ad_accounts FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_meta_ad_accounts ENABLE ROW LEVEL SECURITY;