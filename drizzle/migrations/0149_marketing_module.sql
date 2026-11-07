CREATE TABLE public.marketing_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_key text NOT NULL DEFAULT 'crm:1',
  platform text NOT NULL CHECK (platform IN ('meta','google')),
  account_id text NOT NULL,
  account_name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_key, platform, account_id)
);
GRANT ALL ON public.marketing_integrations TO service_role;
ALTER TABLE public.marketing_integrations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.marketing_integrations IS 'Contas de anúncios (Meta/Google) habilitadas por empresa no módulo Marketing; acesso somente via service_role após sessão CRM completa.';

CREATE TABLE public.marketing_event_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_key text NOT NULL DEFAULT 'crm:1',
  crm_stage text NOT NULL,
  meta_event text NOT NULL DEFAULT '',
  google_action text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_key, crm_stage)
);
GRANT ALL ON public.marketing_event_mappings TO service_role;
ALTER TABLE public.marketing_event_mappings ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.marketing_event_mappings IS 'Mapeamento etapa do CRM -> evento Meta/Google por empresa; service_role apenas. Envios reais permanecem desligados até configuração válida.';

INSERT INTO public.marketing_event_mappings (company_key, crm_stage, meta_event, google_action, active) VALUES
  ('crm:1', 'lead-novo', 'Lead', '', true),
  ('crm:1', 'qualificacao', 'QualifiedLead', '', true),
  ('crm:1', 'reuniao-agendada', 'Schedule', '', false),
  ('crm:1', 'fechado', 'Purchase', '', false);