-- Revisão financeira: esfera pessoal, novas categorias, decisão (aprovado/corrigido), classificação em massa e regras
-- editáveis (ativar/desativar). Requer 0079. Não altera registros bancários, valores, datas ou identificadores;
-- decisões manuais existentes são preservadas (marcadas como 'corrigido').
SET LOCAL lock_timeout = '5s';

-- Novos tipos/categorias: substitui as restrições criadas na 0079 por versões nomeadas e ampliadas.
ALTER TABLE public.polp_bank_classification_overrides
 DROP CONSTRAINT IF EXISTS polp_bank_classification_overrides_kind_check,
 DROP CONSTRAINT IF EXISTS polp_bank_classification_overrides_category_check,
 DROP CONSTRAINT IF EXISTS polp_bank_classification_overrides_check;
ALTER TABLE public.polp_bank_classification_rules
 DROP CONSTRAINT IF EXISTS polp_bank_classification_rules_kind_check,
 DROP CONSTRAINT IF EXISTS polp_bank_classification_rules_category_check,
 DROP CONSTRAINT IF EXISTS polp_bank_classification_rules_check;

ALTER TABLE public.polp_bank_classification_overrides
 ADD COLUMN IF NOT EXISTS decision text NOT NULL DEFAULT 'corrigido',
 ADD CONSTRAINT polp_bank_overrides_decision_ck CHECK (decision IN ('aprovado','corrigido')),
 ADD CONSTRAINT polp_bank_overrides_kind_ck CHECK (kind IN ('receita_operacional','despesa_operacional','despesa_pessoal','entrada_pessoal','aplicacao','resgate','rendimento','transferencia_interna','emprestimo','nao_classificado')),
 ADD CONSTRAINT polp_bank_overrides_category_ck CHECK (
  category IS NULL
  OR (kind = 'despesa_operacional' AND category IN ('publicidade_marketing','softwares_assinaturas','inteligencia_artificial','hospedagem_infraestrutura','aluguel_comercial','fornecedores','equipe','impostos','despesas_administrativas','outras_despesas'))
  OR (kind = 'despesa_pessoal' AND category IN ('alimentacao','moradia','contas_domesticas','compras_pessoais','transporte_pessoal','outras_pessoais')));

ALTER TABLE public.polp_bank_classification_rules
 ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
 ADD CONSTRAINT polp_bank_rules_kind_ck CHECK (kind IN ('receita_operacional','despesa_operacional','despesa_pessoal','entrada_pessoal','aplicacao','resgate','rendimento','transferencia_interna','emprestimo','nao_classificado')),
 ADD CONSTRAINT polp_bank_rules_category_ck CHECK (
  category IS NULL
  OR (kind = 'despesa_operacional' AND category IN ('publicidade_marketing','softwares_assinaturas','inteligencia_artificial','hospedagem_infraestrutura','aluguel_comercial','fornecedores','equipe','impostos','despesas_administrativas','outras_despesas'))
  OR (kind = 'despesa_pessoal' AND category IN ('alimentacao','moradia','contas_domesticas','compras_pessoais','transporte_pessoal','outras_pessoais')));

-- Classificação individual ou em massa (até 200 itens), tudo-ou-nada, com revisão por item, decisão e auditoria.
-- p_items: [{transaction_id, kind, category, vendor, expected_revision, decision, rule:{field,pattern,direction}|null}]
CREATE OR REPLACE FUNCTION public.save_polp_bank_classifications(p_company_key text, p_items jsonb, p_actor text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE it jsonb; cur public.polp_bank_classification_overrides; v_rule uuid; v_count integer := 0; v_kind text; v_cat text; v_vendor text; v_rev integer; v_dec text; v_tx text; v_after jsonb;
BEGIN
 IF p_company_key IS NULL OR p_company_key !~ '^crm:[0-9]{1,9}$' THEN RAISE EXCEPTION 'invalid company'; END IF;
 IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid actor'; END IF;
 IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid items'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('polp_bank_classification:'||p_company_key,0));
 FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
  v_tx := it->>'transaction_id'; v_kind := it->>'kind'; v_cat := NULLIF(it->>'category',''); v_vendor := NULLIF(trim(coalesce(it->>'vendor','')),'');
  v_dec := coalesce(it->>'decision','corrigido'); v_rev := (it->>'expected_revision')::integer;
  IF v_rev IS NULL OR v_rev < 0 THEN RAISE EXCEPTION 'invalid revision'; END IF;
  IF v_kind NOT IN ('despesa_operacional','despesa_pessoal') THEN v_cat := NULL; END IF;
  PERFORM 1 FROM public.polp_bank_transactions WHERE company_key = p_company_key AND polp_transaction_id = v_tx;
  IF NOT FOUND THEN RAISE EXCEPTION 'polp_transaction_not_found'; END IF;
  SELECT * INTO cur FROM public.polp_bank_classification_overrides WHERE company_key = p_company_key AND polp_transaction_id = v_tx FOR UPDATE;
  IF FOUND THEN
   IF cur.revision <> v_rev THEN RAISE EXCEPTION 'polp_classification_changed'; END IF;
   UPDATE public.polp_bank_classification_overrides SET kind = v_kind, category = v_cat, vendor = v_vendor, decision = v_dec, revision = cur.revision + 1, updated_by = p_actor, updated_at = now()
    WHERE company_key = p_company_key AND polp_transaction_id = v_tx;
  ELSE
   IF v_rev <> 0 THEN RAISE EXCEPTION 'polp_classification_changed'; END IF;
   INSERT INTO public.polp_bank_classification_overrides(company_key, polp_transaction_id, kind, category, vendor, decision, updated_by)
    VALUES (p_company_key, v_tx, v_kind, v_cat, v_vendor, v_dec, p_actor);
  END IF;
  v_rule := NULL;
  IF jsonb_typeof(it->'rule') = 'object' THEN
   INSERT INTO public.polp_bank_classification_rules(company_key, field, pattern, direction, kind, category, vendor, created_from, created_by, active)
    VALUES (p_company_key, it->'rule'->>'field', lower(trim(it->'rule'->>'pattern')), coalesce(it->'rule'->>'direction','qualquer'), v_kind, v_cat, v_vendor, v_tx, p_actor, true)
    ON CONFLICT (company_key, field, pattern, direction) DO UPDATE SET kind = EXCLUDED.kind, category = EXCLUDED.category, vendor = EXCLUDED.vendor, active = true, updated_at = now()
    RETURNING id INTO v_rule;
  END IF;
  v_after := jsonb_build_object('kind', v_kind, 'category', v_cat, 'vendor', v_vendor, 'decision', v_dec, 'revision', coalesce(cur.revision, 0) + 1);
  INSERT INTO public.polp_bank_classification_audit(company_key, polp_transaction_id, before_data, after_data, rule_id, actor)
   VALUES (p_company_key, v_tx, CASE WHEN cur.polp_transaction_id IS NULL THEN NULL ELSE jsonb_build_object('kind', cur.kind, 'category', cur.category, 'vendor', cur.vendor, 'decision', cur.decision, 'revision', cur.revision) END,
    v_after, v_rule, p_actor);
  cur := NULL;
  v_count := v_count + 1;
 END LOOP;
 RETURN v_count;
END;
$$;

-- Regras editáveis: ativar/desativar (nunca apagar), com auditoria.
CREATE OR REPLACE FUNCTION public.set_polp_bank_rule_active(p_company_key text, p_rule_id uuid, p_active boolean, p_actor text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.polp_bank_classification_rules;
BEGIN
 IF p_company_key IS NULL OR p_company_key !~ '^crm:[0-9]{1,9}$' OR p_active IS NULL THEN RAISE EXCEPTION 'invalid input'; END IF;
 IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid actor'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('polp_bank_classification:'||p_company_key,0));
 UPDATE public.polp_bank_classification_rules SET active = p_active, updated_at = now() WHERE company_key = p_company_key AND id = p_rule_id RETURNING * INTO r;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.polp_bank_classification_audit(company_key, polp_transaction_id, before_data, after_data, rule_id, actor)
  VALUES (p_company_key, coalesce(r.created_from, 'regra'), jsonb_build_object('active', NOT p_active), jsonb_build_object('active', p_active, 'pattern', r.pattern), r.id, p_actor);
 RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.save_polp_bank_classifications(text,jsonb,text), public.set_polp_bank_rule_active(text,uuid,boolean,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_polp_bank_classifications(text,jsonb,text), public.set_polp_bank_rule_active(text,uuid,boolean,text) TO service_role;
