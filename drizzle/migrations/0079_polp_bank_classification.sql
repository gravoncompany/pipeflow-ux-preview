-- Fase 2 — Classificação das movimentações bancárias (correção manual e regras reutilizáveis).
-- Aditiva: apenas tabelas e uma RPC novas. Não altera polp_bank_transactions (registro bancário original),
-- lançamentos financeiros, faturamento ou Universe. Classificação automática não é gravada: é calculada na leitura.
-- Segurança: RLS sem políticas; anon/authenticated sem acesso; service_role apenas SELECT; escrita somente pela RPC.
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.polp_bank_classification_overrides (
 company_key text NOT NULL CHECK (company_key ~ '^crm:[0-9]{1,9}$'),
 polp_transaction_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('receita_operacional','despesa_operacional','aplicacao','resgate','rendimento','transferencia_interna','emprestimo','nao_classificado')),
 category text CHECK (category IS NULL OR category IN ('inteligencia_artificial','softwares_assinaturas','publicidade_marketing','hospedagem_infraestrutura','fornecedores','equipe','impostos','despesas_administrativas','outras_despesas')),
 vendor text CHECK (vendor IS NULL OR length(vendor) BETWEEN 1 AND 80),
 revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
 updated_by text NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 120),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (kind = 'despesa_operacional' OR category IS NULL),
 PRIMARY KEY (company_key, polp_transaction_id),
 FOREIGN KEY (company_key, polp_transaction_id) REFERENCES public.polp_bank_transactions(company_key, polp_transaction_id)
);

CREATE TABLE public.polp_bank_classification_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_key text NOT NULL CHECK (company_key ~ '^crm:[0-9]{1,9}$'),
 field text NOT NULL CHECK (field IN ('description','counterparty')),
 pattern text NOT NULL CHECK (length(pattern) BETWEEN 3 AND 120),
 direction text NOT NULL DEFAULT 'qualquer' CHECK (direction IN ('CREDITO','DEBITO','qualquer')),
 kind text NOT NULL CHECK (kind IN ('receita_operacional','despesa_operacional','aplicacao','resgate','rendimento','transferencia_interna','emprestimo','nao_classificado')),
 category text CHECK (category IS NULL OR category IN ('inteligencia_artificial','softwares_assinaturas','publicidade_marketing','hospedagem_infraestrutura','fornecedores','equipe','impostos','despesas_administrativas','outras_despesas')),
 vendor text CHECK (vendor IS NULL OR length(vendor) BETWEEN 1 AND 80),
 created_from text,
 created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (kind = 'despesa_operacional' OR category IS NULL),
 UNIQUE (company_key, field, pattern, direction)
);

-- Auditoria append-only de toda correção e regra.
CREATE TABLE public.polp_bank_classification_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_key text NOT NULL,
 polp_transaction_id text NOT NULL,
 before_data jsonb,
 after_data jsonb NOT NULL,
 rule_id uuid,
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.polp_bank_classification_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'polp_bank_classification_audit_immutable'; END;
$$;
CREATE TRIGGER polp_bank_classification_audit_guard BEFORE UPDATE OR DELETE ON public.polp_bank_classification_audit FOR EACH ROW EXECUTE FUNCTION public.polp_bank_classification_audit_guard();

-- Grava a correção manual com controle de revisão (p_expected_revision = 0 para a primeira) e, opcionalmente,
-- cria/atualiza uma regra reutilizável. Trava por empresa evita gravações concorrentes.
CREATE OR REPLACE FUNCTION public.save_polp_bank_classification(p_company_key text, p_transaction_id text, p_kind text, p_category text, p_vendor text,
 p_expected_revision integer, p_rule_field text, p_rule_pattern text, p_rule_direction text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cur public.polp_bank_classification_overrides; v_rule uuid; v_rev integer; v_category text; v_after jsonb;
BEGIN
 IF p_company_key IS NULL OR p_company_key !~ '^crm:[0-9]{1,9}$' THEN RAISE EXCEPTION 'invalid company'; END IF;
 IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid actor'; END IF;
 IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN RAISE EXCEPTION 'invalid revision'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('polp_bank_classification:'||p_company_key,0));
 PERFORM 1 FROM public.polp_bank_transactions WHERE company_key = p_company_key AND polp_transaction_id = p_transaction_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'polp_transaction_not_found'; END IF;
 v_category := CASE WHEN p_kind = 'despesa_operacional' THEN p_category ELSE NULL END;
 SELECT * INTO cur FROM public.polp_bank_classification_overrides WHERE company_key = p_company_key AND polp_transaction_id = p_transaction_id FOR UPDATE;
 IF FOUND THEN
  IF cur.revision <> p_expected_revision THEN RAISE EXCEPTION 'polp_classification_changed'; END IF;
  UPDATE public.polp_bank_classification_overrides SET kind = p_kind, category = v_category, vendor = NULLIF(trim(p_vendor),''), revision = cur.revision + 1,
   updated_by = p_actor, updated_at = now() WHERE company_key = p_company_key AND polp_transaction_id = p_transaction_id;
  v_rev := cur.revision + 1;
 ELSE
  IF p_expected_revision <> 0 THEN RAISE EXCEPTION 'polp_classification_changed'; END IF;
  INSERT INTO public.polp_bank_classification_overrides(company_key, polp_transaction_id, kind, category, vendor, updated_by)
   VALUES (p_company_key, p_transaction_id, p_kind, v_category, NULLIF(trim(p_vendor),''), p_actor);
  v_rev := 1;
 END IF;
 IF p_rule_field IS NOT NULL THEN
  INSERT INTO public.polp_bank_classification_rules(company_key, field, pattern, direction, kind, category, vendor, created_from, created_by)
   VALUES (p_company_key, p_rule_field, lower(trim(p_rule_pattern)), COALESCE(p_rule_direction,'qualquer'), p_kind, v_category, NULLIF(trim(p_vendor),''), p_transaction_id, p_actor)
   ON CONFLICT (company_key, field, pattern, direction) DO UPDATE SET kind = EXCLUDED.kind, category = EXCLUDED.category, vendor = EXCLUDED.vendor, updated_at = now()
   RETURNING id INTO v_rule;
 END IF;
 v_after := jsonb_build_object('kind', p_kind, 'category', v_category, 'vendor', NULLIF(trim(p_vendor),''), 'revision', v_rev);
 INSERT INTO public.polp_bank_classification_audit(company_key, polp_transaction_id, before_data, after_data, rule_id, actor)
  VALUES (p_company_key, p_transaction_id, CASE WHEN cur.polp_transaction_id IS NULL THEN NULL ELSE jsonb_build_object('kind', cur.kind, 'category', cur.category, 'vendor', cur.vendor, 'revision', cur.revision) END,
   v_after, v_rule, p_actor);
 RETURN v_after || jsonb_build_object('rule_id', v_rule);
END;
$$;

ALTER TABLE public.polp_bank_classification_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polp_bank_classification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polp_bank_classification_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.polp_bank_classification_overrides, public.polp_bank_classification_rules, public.polp_bank_classification_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.polp_bank_classification_overrides, public.polp_bank_classification_rules, public.polp_bank_classification_audit TO service_role;
REVOKE ALL ON FUNCTION public.polp_bank_classification_audit_guard(),
 public.save_polp_bank_classification(text,text,text,text,text,integer,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_polp_bank_classification(text,text,text,text,text,integer,text,text,text,text) TO service_role;
