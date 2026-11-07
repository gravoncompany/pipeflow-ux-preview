ALTER TABLE public.crm_external_integrations DROP CONSTRAINT IF EXISTS crm_external_integrations_provider_check;
ALTER TABLE public.crm_external_integrations ADD CONSTRAINT crm_external_integrations_provider_check CHECK (provider IN ('hypercash','custom'));
ALTER TABLE public.crm_external_integrations DROP CONSTRAINT IF EXISTS crm_external_integrations_provider_key;
CREATE UNIQUE INDEX IF NOT EXISTS crm_external_integrations_single_provider ON public.crm_external_integrations(provider) WHERE provider <> 'custom';
ALTER TABLE public.crm_external_integrations ADD COLUMN IF NOT EXISTS base_url text;
ALTER TABLE public.crm_external_integrations ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'none' CHECK (auth_method IN ('none','bearer','api_key_header','basic'));
ALTER TABLE public.crm_external_integrations ADD COLUMN IF NOT EXISTS auth_header text;
ALTER TABLE public.crm_external_integrations ADD COLUMN IF NOT EXISTS endpoints jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS crm_external_integrations_custom_name ON public.crm_external_integrations(lower(name)) WHERE provider = 'custom';