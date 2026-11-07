CREATE TABLE public.crm_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id),
  trade_name text NOT NULL,
  legal_name text NOT NULL DEFAULT '',
  cnpj text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  whatsapp text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  relationship_start date,
  services text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'implantacao' CHECK (status IN ('implantacao','ativo','pausado','encerrado')),
  internal_responsible text NOT NULL DEFAULT '',
  reminder_days integer NOT NULL DEFAULT 5 CHECK (reminder_days BETWEEN 0 AND 60),
  notes text NOT NULL DEFAULT '',
  revision bigint NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_clients_lead_unique ON public.crm_clients(lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX crm_clients_cnpj_unique ON public.crm_clients(cnpj) WHERE cnpj <> '';
GRANT SELECT,INSERT,UPDATE ON public.crm_clients TO service_role;
ALTER TABLE public.crm_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_clients FROM anon,authenticated;

CREATE TABLE public.crm_client_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.crm_clients(id),
  kind text NOT NULL CHECK (kind IN ('cadastro','conversa','servico','planejamento','documento','registro','tarefa','campanha','preferencia','manual','resumo')),
  title text NOT NULL DEFAULT '',
  text text NOT NULL,
  source text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_client_knowledge_client ON public.crm_client_knowledge(client_id,created_at);
GRANT SELECT,INSERT ON public.crm_client_knowledge TO service_role;
ALTER TABLE public.crm_client_knowledge ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_client_knowledge FROM anon,authenticated;

CREATE TABLE public.crm_client_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.crm_clients(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aprovado')),
  current_version integer NOT NULL DEFAULT 0,
  approved_version integer,
  revision bigint NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_client_plans_client ON public.crm_client_plans(client_id);
GRANT SELECT,INSERT,UPDATE ON public.crm_client_plans TO service_role;
ALTER TABLE public.crm_client_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_client_plans FROM anon,authenticated;

CREATE TABLE public.crm_client_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.crm_client_plans(id),
  version integer NOT NULL,
  content text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('manual','ia')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,version)
);
GRANT SELECT,INSERT ON public.crm_client_plan_versions TO service_role;
ALTER TABLE public.crm_client_plan_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_client_plan_versions FROM anon,authenticated;

CREATE TABLE public.crm_client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.crm_clients(id),
  category text NOT NULL CHECK (category IN ('contrato','proposta','briefing','relatorio','apresentacao','outro')),
  name text NOT NULL,
  path text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  content_type text NOT NULL DEFAULT '',
  ai_authorized boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_client_documents_client ON public.crm_client_documents(client_id,created_at);
GRANT SELECT,INSERT ON public.crm_client_documents TO service_role;
ALTER TABLE public.crm_client_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_client_documents FROM anon,authenticated;

CREATE TABLE public.crm_client_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.crm_clients(id),
  kind text NOT NULL CHECK (kind IN ('reuniao','decisao','solicitacao','campanha','observacao','compromisso','pendencia')),
  description text NOT NULL,
  author text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_client_records_client ON public.crm_client_records(client_id,created_at);
GRANT SELECT,INSERT ON public.crm_client_records TO service_role;
ALTER TABLE public.crm_client_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_client_records FROM anon,authenticated;

CREATE TABLE public.crm_client_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.crm_clients(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  responsible text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa','media','alta')),
  due_date date,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida')),
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','ia','lembrete')),
  charge_id uuid,
  revision bigint NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_client_tasks_client ON public.crm_client_tasks(client_id,status);
GRANT SELECT,INSERT,UPDATE ON public.crm_client_tasks TO service_role;
ALTER TABLE public.crm_client_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_client_tasks FROM anon,authenticated;

CREATE TABLE public.crm_client_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.crm_clients(id),
  parent_charge_id uuid,
  description text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  due_date date NOT NULL,
  recurrence text NOT NULL DEFAULT 'unica' CHECK (recurrence IN ('unica','semanal','quinzenal','mensal','personalizada')),
  recurrence_interval integer NOT NULL DEFAULT 0 CHECK (recurrence_interval BETWEEN 0 AND 365),
  payment_method text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','vencido','cancelado')),
  revision bigint NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_client_charges_client ON public.crm_client_charges(client_id,status,due_date);
GRANT SELECT,INSERT,UPDATE ON public.crm_client_charges TO service_role;
ALTER TABLE public.crm_client_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_client_charges FROM anon,authenticated;

CREATE TABLE public.crm_client_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.crm_client_charges(id),
  amount numeric NOT NULL CHECK (amount > 0),
  paid_at date NOT NULL,
  method text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  confirmed_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_client_payments_charge ON public.crm_client_payments(charge_id);
GRANT SELECT,INSERT ON public.crm_client_payments TO service_role;
ALTER TABLE public.crm_client_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_client_payments FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_crm_client(p_actor text,p_id uuid,p_lead uuid,p_trade_name text,p_legal_name text,p_cnpj text,p_contact_name text,p_phone text,p_whatsapp text,p_email text,p_address text,p_website text,p_relationship_start date,p_services text[],p_status text,p_internal_responsible text,p_reminder_days integer,p_notes text,p_revision bigint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.crm_clients%ROWTYPE; new_id uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_trade_name IS NULL OR length(p_trade_name) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'invalid_client'; END IF;
  IF p_status NOT IN ('implantacao','ativo','pausado','encerrado') THEN RAISE EXCEPTION 'invalid_client'; END IF;
  IF p_reminder_days IS NULL OR p_reminder_days NOT BETWEEN 0 AND 60 THEN RAISE EXCEPTION 'invalid_client'; END IF;
  IF p_cnpj IS NOT NULL AND p_cnpj <> '' AND p_cnpj !~ '^[0-9]{14}$' THEN RAISE EXCEPTION 'invalid_cnpj'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:clients',0));
  IF p_id IS NULL THEN
    IF p_cnpj IS NOT NULL AND p_cnpj <> '' AND EXISTS(SELECT 1 FROM public.crm_clients WHERE cnpj=p_cnpj) THEN RAISE EXCEPTION 'duplicate_cnpj'; END IF;
    IF p_lead IS NOT NULL AND EXISTS(SELECT 1 FROM public.crm_clients WHERE lead_id=p_lead) THEN RAISE EXCEPTION 'already_client'; END IF;
    INSERT INTO public.crm_clients(lead_id,trade_name,legal_name,cnpj,contact_name,phone,whatsapp,email,address,website,relationship_start,services,status,internal_responsible,reminder_days,notes,created_by)
    VALUES(p_lead,left(p_trade_name,200),left(coalesce(p_legal_name,''),200),coalesce(p_cnpj,''),left(coalesce(p_contact_name,''),200),left(coalesce(p_phone,''),40),left(coalesce(p_whatsapp,''),40),left(coalesce(p_email,''),200),left(coalesce(p_address,''),500),left(coalesce(p_website,''),500),p_relationship_start,coalesce(p_services,'{}'),p_status,left(coalesce(p_internal_responsible,''),160),p_reminder_days,left(coalesce(p_notes,''),5000),left(p_actor,160))
    RETURNING id INTO new_id;
    RETURN new_id;
  END IF;
  SELECT * INTO c FROM public.crm_clients WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  IF c.revision<>p_revision THEN RAISE EXCEPTION 'client_changed'; END IF;
  IF p_cnpj IS NOT NULL AND p_cnpj <> '' AND EXISTS(SELECT 1 FROM public.crm_clients WHERE cnpj=p_cnpj AND id<>p_id) THEN RAISE EXCEPTION 'duplicate_cnpj'; END IF;
  UPDATE public.crm_clients SET trade_name=left(p_trade_name,200),legal_name=left(coalesce(p_legal_name,''),200),cnpj=coalesce(p_cnpj,''),contact_name=left(coalesce(p_contact_name,''),200),phone=left(coalesce(p_phone,''),40),whatsapp=left(coalesce(p_whatsapp,''),40),email=left(coalesce(p_email,''),200),address=left(coalesce(p_address,''),500),website=left(coalesce(p_website,''),500),relationship_start=p_relationship_start,services=coalesce(p_services,'{}'),status=p_status,internal_responsible=left(coalesce(p_internal_responsible,''),160),reminder_days=p_reminder_days,notes=left(coalesce(p_notes,''),5000),revision=revision+1,updated_at=now() WHERE id=p_id;
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.convert_lead_to_client(p_actor text,p_lead uuid,p_status text,p_internal_responsible text,p_services text[],p_notes text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.leads%ROWTYPE; new_id uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_status NOT IN ('implantacao','ativo','pausado','encerrado') THEN RAISE EXCEPTION 'invalid_client'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:clients',0));
  SELECT * INTO l FROM public.leads WHERE id=p_lead FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_clients WHERE lead_id=p_lead) THEN RAISE EXCEPTION 'already_client'; END IF;
  INSERT INTO public.crm_clients(lead_id,trade_name,contact_name,whatsapp,email,website,relationship_start,services,status,internal_responsible,notes,created_by)
  VALUES(p_lead,left(nullif(l.company,''),200),left(l.name,200),left(l.whatsapp,40),left(l.email,200),left(l.website,500),current_date,coalesce(p_services,'{}'),p_status,left(coalesce(p_internal_responsible,''),160),left(coalesce(p_notes,''),5000),left(p_actor,160))
  RETURNING id INTO new_id;
  UPDATE public.leads SET history=coalesce(history,'[]'::jsonb)||jsonb_build_object('id','client:'||new_id||':converted','date',now(),'text','Contato convertido em cliente da Gravon Company.','kind','client_converted','source','clients','client',new_id,'responsible',left(p_actor,160)) WHERE id=p_lead;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.add_crm_client_knowledge(p_actor text,p_client uuid,p_kind text,p_title text,p_text text,p_source text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_id uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_kind NOT IN ('cadastro','conversa','servico','planejamento','documento','registro','tarefa','campanha','preferencia','manual','resumo') THEN RAISE EXCEPTION 'invalid_knowledge'; END IF;
  IF p_text IS NULL OR length(p_text) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'invalid_knowledge'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p_client) THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  INSERT INTO public.crm_client_knowledge(client_id,kind,title,text,source,created_by) VALUES(p_client,p_kind,left(coalesce(p_title,''),300),p_text,left(coalesce(p_source,''),300),left(p_actor,160)) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_crm_client_plan(p_actor text,p_client uuid,p_plan uuid,p_title text,p_content text,p_origin text,p_expected_version integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.crm_client_plans%ROWTYPE; new_id uuid; next_version integer; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_origin NOT IN ('manual','ia') THEN RAISE EXCEPTION 'invalid_plan'; END IF;
  IF p_content IS NULL OR length(p_content) NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'invalid_plan'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p_client) THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:client-plan',0));
  IF p_plan IS NULL THEN
    IF p_title IS NULL OR length(p_title) NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'invalid_plan'; END IF;
    INSERT INTO public.crm_client_plans(client_id,title,status,current_version,created_by) VALUES(p_client,left(p_title,300),'rascunho',1,left(p_actor,160)) RETURNING id INTO new_id;
    INSERT INTO public.crm_client_plan_versions(plan_id,version,content,origin,created_by) VALUES(new_id,1,p_content,p_origin,left(p_actor,160));
    RETURN new_id;
  END IF;
  SELECT * INTO p FROM public.crm_client_plans WHERE id=p_plan AND client_id=p_client FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_unavailable'; END IF;
  IF p.current_version<>p_expected_version THEN RAISE EXCEPTION 'plan_changed'; END IF;
  next_version := p.current_version+1;
  INSERT INTO public.crm_client_plan_versions(plan_id,version,content,origin,created_by) VALUES(p_plan,next_version,p_content,p_origin,left(p_actor,160));
  UPDATE public.crm_client_plans SET current_version=next_version,status='rascunho',revision=revision+1,updated_at=now() WHERE id=p_plan;
  RETURN p_plan;
END $$;

CREATE OR REPLACE FUNCTION public.approve_crm_client_plan(p_actor text,p_plan uuid,p_version integer,p_revision bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.crm_client_plans%ROWTYPE; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:client-plan',0));
  SELECT * INTO p FROM public.crm_client_plans WHERE id=p_plan FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_unavailable'; END IF;
  IF p.revision<>p_revision THEN RAISE EXCEPTION 'plan_changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_client_plan_versions WHERE plan_id=p_plan AND version=p_version) THEN RAISE EXCEPTION 'version_unavailable'; END IF;
  UPDATE public.crm_client_plans SET status='aprovado',approved_version=p_version,revision=revision+1,updated_at=now() WHERE id=p_plan;
END $$;

CREATE OR REPLACE FUNCTION public.add_crm_client_record(p_actor text,p_client uuid,p_kind text,p_description text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_id uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_kind NOT IN ('reuniao','decisao','solicitacao','campanha','observacao','compromisso','pendencia') THEN RAISE EXCEPTION 'invalid_record'; END IF;
  IF p_description IS NULL OR length(p_description) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid_record'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p_client) THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  INSERT INTO public.crm_client_records(client_id,kind,description,author) VALUES(p_client,p_kind,p_description,left(p_actor,160)) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_crm_client_task(p_actor text,p_id uuid,p_client uuid,p_title text,p_description text,p_responsible text,p_priority text,p_due date,p_status text,p_origin text,p_revision bigint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.crm_client_tasks%ROWTYPE; new_id uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_title IS NULL OR length(p_title) NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'invalid_task'; END IF;
  IF p_priority NOT IN ('baixa','media','alta') OR p_status NOT IN ('pendente','em_andamento','concluida') OR p_origin NOT IN ('manual','ia','lembrete') THEN RAISE EXCEPTION 'invalid_task'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p_client) THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.crm_client_tasks(client_id,title,description,responsible,priority,due_date,status,origin,created_by) VALUES(p_client,left(p_title,300),left(coalesce(p_description,''),5000),left(coalesce(p_responsible,''),160),p_priority,p_due,p_status,p_origin,left(p_actor,160)) RETURNING id INTO new_id;
    RETURN new_id;
  END IF;
  SELECT * INTO t FROM public.crm_client_tasks WHERE id=p_id AND client_id=p_client FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_unavailable'; END IF;
  IF t.revision<>p_revision THEN RAISE EXCEPTION 'task_changed'; END IF;
  UPDATE public.crm_client_tasks SET title=left(p_title,300),description=left(coalesce(p_description,''),5000),responsible=left(coalesce(p_responsible,''),160),priority=p_priority,due_date=p_due,status=p_status,revision=revision+1,updated_at=now() WHERE id=p_id;
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_crm_client_charge(p_actor text,p_id uuid,p_client uuid,p_description text,p_amount numeric,p_due date,p_recurrence text,p_interval integer,p_method text,p_revision bigint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.crm_client_charges%ROWTYPE; new_id uuid; step interval; next_due date; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_description IS NULL OR length(p_description) NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'invalid_charge'; END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 100000000 THEN RAISE EXCEPTION 'invalid_charge'; END IF;
  IF p_due IS NULL THEN RAISE EXCEPTION 'invalid_charge'; END IF;
  IF p_recurrence NOT IN ('unica','semanal','quinzenal','mensal','personalizada') THEN RAISE EXCEPTION 'invalid_charge'; END IF;
  IF p_recurrence='personalizada' AND (p_interval IS NULL OR p_interval NOT BETWEEN 1 AND 365) THEN RAISE EXCEPTION 'invalid_charge'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p_client) THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:client-charges',0));
  IF p_id IS NULL THEN
    INSERT INTO public.crm_client_charges(client_id,description,amount,due_date,recurrence,recurrence_interval,payment_method,created_by) VALUES(p_client,left(p_description,300),p_amount,p_due,p_recurrence,coalesce(p_interval,0),left(coalesce(p_method,''),120),left(p_actor,160)) RETURNING id INTO new_id;
    IF p_recurrence<>'unica' THEN
      step := CASE p_recurrence WHEN 'semanal' THEN interval '7 days' WHEN 'quinzenal' THEN interval '14 days' WHEN 'mensal' THEN interval '1 month' ELSE make_interval(days => p_interval) END;
      next_due := (p_due::timestamptz + step)::date;
      WHILE next_due <= (current_date + interval '12 months')::date LOOP
        INSERT INTO public.crm_client_charges(client_id,parent_charge_id,description,amount,due_date,recurrence,recurrence_interval,payment_method,created_by) VALUES(p_client,new_id,left(p_description,300),p_amount,next_due,p_recurrence,coalesce(p_interval,0),left(coalesce(p_method,''),120),left(p_actor,160));
        next_due := (next_due::timestamptz + step)::date;
      END LOOP;
    END IF;
    RETURN new_id;
  END IF;
  SELECT * INTO c FROM public.crm_client_charges WHERE id=p_id AND client_id=p_client FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'charge_unavailable'; END IF;
  IF c.revision<>p_revision THEN RAISE EXCEPTION 'charge_changed'; END IF;
  IF c.status='pago' THEN RAISE EXCEPTION 'charge_paid'; END IF;
  UPDATE public.crm_client_charges SET description=left(p_description,300),amount=p_amount,due_date=p_due,payment_method=left(coalesce(p_method,''),120),revision=revision+1,updated_at=now() WHERE id=p_id;
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.register_crm_client_payment(p_actor text,p_charge uuid,p_amount numeric,p_method text,p_note text,p_confirmed boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.crm_client_charges%ROWTYPE; new_id uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'payment_not_confirmed'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000000 THEN RAISE EXCEPTION 'invalid_payment'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:client-charges',0));
  SELECT * INTO c FROM public.crm_client_charges WHERE id=p_charge FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'charge_unavailable'; END IF;
  IF c.status='pago' THEN RAISE EXCEPTION 'charge_paid'; END IF;
  IF c.status='cancelado' THEN RAISE EXCEPTION 'charge_cancelled'; END IF;
  INSERT INTO public.crm_client_payments(charge_id,amount,paid_at,method,note,confirmed_by) VALUES(p_charge,p_amount,current_date,left(coalesce(p_method,''),120),left(coalesce(p_note,''),2000),left(p_actor,160)) RETURNING id INTO new_id;
  UPDATE public.crm_client_charges SET status='pago',revision=revision+1,updated_at=now() WHERE id=p_charge;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_crm_client_charge(p_actor text,p_charge uuid,p_revision bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.crm_client_charges%ROWTYPE; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:client-charges',0));
  SELECT * INTO c FROM public.crm_client_charges WHERE id=p_charge FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'charge_unavailable'; END IF;
  IF c.revision<>p_revision THEN RAISE EXCEPTION 'charge_changed'; END IF;
  IF c.status='pago' THEN RAISE EXCEPTION 'charge_paid'; END IF;
  UPDATE public.crm_client_charges SET status='cancelado',revision=revision+1,updated_at=now() WHERE id=p_charge;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_crm_charge_status() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.crm_client_charges SET status='vencido',updated_at=now() WHERE status='pendente' AND due_date < current_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.create_due_charge_reminders(p_actor text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; n integer := 0; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  PERFORM public.refresh_crm_charge_status();
  FOR r IN
    SELECT ch.id AS charge_id, ch.client_id, ch.description, ch.amount, ch.due_date, ch.status, cl.trade_name, cl.reminder_days
    FROM public.crm_client_charges ch JOIN public.crm_clients cl ON cl.id=ch.client_id
    WHERE ch.status IN ('pendente','vencido')
      AND ch.due_date - cl.reminder_days <= current_date
      AND cl.status IN ('implantacao','ativo')
      AND NOT EXISTS(SELECT 1 FROM public.crm_client_tasks t WHERE t.charge_id=ch.id AND t.status<>'concluida')
  LOOP
    INSERT INTO public.crm_client_tasks(client_id,title,description,responsible,priority,due_date,status,origin,charge_id,created_by)
    VALUES(r.client_id,'Lembrete de cobrança — '||r.trade_name,CASE WHEN r.status='vencido' THEN 'Cobrança vencida' ELSE 'Cobrança próxima do vencimento' END||': "'||r.description||'" de R$ '||to_char(r.amount,'FM999G999G990D00')||' com vencimento em '||to_char(r.due_date,'DD/MM/YYYY')||'. Nenhum e-mail foi enviado: revise e contate o cliente manualmente.',left(p_actor,160),CASE WHEN r.status='vencido' THEN 'alta' ELSE 'media' END,r.due_date,'pendente','lembrete',r.charge_id,left(p_actor,160));
    n := n+1;
  END LOOP;
  RETURN n;
END $$;