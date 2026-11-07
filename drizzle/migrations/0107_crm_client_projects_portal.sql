-- Fase 1 — Clientes: projetos por cliente, documentos por projeto, vínculo de contas de anúncio do Portal ao cliente,
-- relatório da Gravon IA guardado no conhecimento do cliente e conversão de lead aproveitando o cadastro da empresa.
-- Nenhum cliente, projeto ou integração existente é alterado.
CREATE TABLE public.crm_client_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES public.crm_clients(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
 service text NOT NULL DEFAULT '' CHECK (char_length(service) <= 300),
 responsible text NOT NULL DEFAULT '' CHECK (char_length(responsible) <= 160),
 start_date date,
 end_date date,
 status text NOT NULL DEFAULT 'planejado' CHECK (status IN ('planejado','em_andamento','pausado','concluido','cancelado')),
 objectives text NOT NULL DEFAULT '' CHECK (char_length(objectives) <= 5000),
 strategic_plan text NOT NULL DEFAULT '' CHECK (char_length(strategic_plan) <= 20000),
 crm_project_id uuid REFERENCES public.crm_projects(id) ON DELETE SET NULL,
 revision integer NOT NULL DEFAULT 1,
 created_by text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX crm_client_projects_client ON public.crm_client_projects(client_id, created_at);
CREATE UNIQUE INDEX crm_client_projects_link ON public.crm_client_projects(client_id, crm_project_id) WHERE crm_project_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON public.crm_client_projects TO service_role;
REVOKE ALL ON public.crm_client_projects FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_client_projects ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_client_documents ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.crm_client_projects(id) ON DELETE SET NULL;

-- Cada conta de anúncio (Google Ads / Meta Ads, identificador da própria plataforma) pertence a no máximo um cliente.
CREATE TABLE public.crm_client_ad_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES public.crm_clients(id) ON DELETE CASCADE,
 platform text NOT NULL CHECK (platform IN ('meta_ads','google_ads')),
 account_id text NOT NULL CHECK (char_length(account_id) BETWEEN 1 AND 200),
 account_name text NOT NULL DEFAULT '' CHECK (char_length(account_name) <= 500),
 created_by text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (platform, account_id)
);
CREATE INDEX crm_client_ad_accounts_client ON public.crm_client_ad_accounts(client_id);
GRANT SELECT, INSERT, DELETE ON public.crm_client_ad_accounts TO service_role;
REVOKE ALL ON public.crm_client_ad_accounts FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_client_ad_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_client_knowledge DROP CONSTRAINT IF EXISTS crm_client_knowledge_kind_check;
ALTER TABLE public.crm_client_knowledge ADD CONSTRAINT crm_client_knowledge_kind_check CHECK (kind IN ('cadastro','conversa','servico','planejamento','documento','registro','tarefa','campanha','preferencia','manual','resumo','relatorio_ia'));

-- Conversão de lead: além do card, aproveita razão social, CNPJ, telefone e endereço da Prospecção B2B
-- (só quando o CNPJ não pertence a outro cliente) e usa o nome do perfil como responsável interno quando não informado.
CREATE OR REPLACE FUNCTION public.convert_lead_to_client(p_actor text, p_lead uuid, p_status text, p_internal_responsible text, p_services text[], p_notes text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE l public.leads%ROWTYPE; new_id uuid; b record; doc text; resp text; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_status NOT IN ('implantacao','ativo','pausado','encerrado') THEN RAISE EXCEPTION 'invalid_client'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:clients',0));
  SELECT * INTO l FROM public.leads WHERE id=p_lead FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_clients WHERE lead_id=p_lead) THEN RAISE EXCEPTION 'already_client'; END IF;
  SELECT cnpj, profile INTO b FROM public.b2b_companies WHERE lead_id=p_lead LIMIT 1;
  doc := CASE WHEN b.cnpj ~ '^\d{14}$' AND NOT EXISTS (SELECT 1 FROM public.crm_clients WHERE cnpj=b.cnpj) THEN b.cnpj ELSE NULL END;
  resp := nullif(btrim(coalesce(p_internal_responsible,'')),'');
  IF resp IS NULL THEN SELECT nullif(btrim(display_name),'') INTO resp FROM public.crm_profile WHERE company_key='crm:1'; END IF;
  INSERT INTO public.crm_clients(lead_id,trade_name,legal_name,cnpj,contact_name,phone,whatsapp,email,address,website,relationship_start,services,status,internal_responsible,notes,created_by)
  VALUES(p_lead,left(coalesce(nullif(l.company,''),nullif(b.profile->>'tradeName',''),nullif(b.profile->>'legalName',''),l.name),200),
    left(coalesce(b.profile->>'legalName',''),200), doc, left(l.name,200), left(coalesce(b.profile->'phones'->>0,''),40),
    left(l.whatsapp,40),left(coalesce(nullif(l.email,''),b.profile->'emails'->>0,''),200),left(coalesce(b.profile->>'address',''),500),
    left(coalesce(nullif(l.website,''),b.profile->>'website',''),500),current_date,coalesce(p_services,'{}'),p_status,left(coalesce(resp,''),160),left(coalesce(p_notes,''),5000),left(p_actor,160))
  RETURNING id INTO new_id;
  UPDATE public.leads SET history=coalesce(history,'[]'::jsonb)||jsonb_build_object('id','client:'||new_id||':converted','date',now(),'text','Contato convertido em cliente da Gravon Company.','kind','client_converted','source','clients','client',new_id,'responsible',left(p_actor,160)) WHERE id=p_lead;
  RETURN new_id;
END $function$;