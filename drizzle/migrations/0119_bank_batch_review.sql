CREATE TABLE public.polp_bank_review_operations (
 company_key text NOT NULL CHECK(company_key='crm:1'), operation uuid NOT NULL, payload jsonb NOT NULL, saved integer NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_key,operation)
);
GRANT SELECT ON public.polp_bank_review_operations TO service_role;
ALTER TABLE public.polp_bank_review_operations ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.polp_bank_client_links (
 company_key text NOT NULL CHECK(company_key='crm:1'), polp_transaction_id text NOT NULL, client_id uuid NOT NULL REFERENCES public.crm_clients(id), actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_key,polp_transaction_id), FOREIGN KEY(company_key,polp_transaction_id) REFERENCES public.polp_bank_transactions(company_key,polp_transaction_id)
);
GRANT SELECT ON public.polp_bank_client_links TO service_role;
ALTER TABLE public.polp_bank_client_links ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.review_polp_bank_batch(p_company_key text,p_operation uuid,p_items jsonb,p_actor text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prev public.polp_bank_review_operations; it jsonb; tx public.polp_bank_transactions; v_client uuid; v_kind text; n integer:=0; chunks jsonb; r public.polp_bank_reconciliations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_company_key IS DISTINCT FROM 'crm:1' OR p_operation IS NULL OR p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 120 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 3000 THEN RAISE EXCEPTION 'invalid_batch'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:crm:1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('polp_bank_classification:crm:1',0));
 SELECT * INTO prev FROM public.polp_bank_review_operations WHERE company_key=p_company_key AND operation=p_operation;
 IF FOUND THEN IF prev.payload IS DISTINCT FROM p_items OR prev.actor IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'operation_conflict'; END IF; RETURN prev.saved; END IF;
 IF (SELECT count(DISTINCT value->>'transaction_id') FROM jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'duplicate_transaction'; END IF;
 FOR it IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'transaction_id' LOOP
  SELECT * INTO tx FROM public.polp_bank_transactions WHERE company_key=p_company_key AND polp_transaction_id=it->>'transaction_id' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'polp_transaction_not_found'; END IF;
  v_kind:=it->>'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('receita_operacional','despesa_operacional','despesa_pessoal','entrada_pessoal','aplicacao','resgate','rendimento','transferencia_interna','emprestimo','nao_classificado') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF tx.direction IS NULL OR tx.currency<>'BRL' OR tx.amount_cents IS NULL OR tx.transaction_at IS NULL THEN RAISE EXCEPTION 'invalid_transaction'; END IF;
  IF (tx.direction='DEBITO' AND v_kind IN ('receita_operacional','entrada_pessoal','resgate','rendimento')) OR (tx.direction='CREDITO' AND v_kind IN ('despesa_operacional','despesa_pessoal','aplicacao')) THEN RAISE EXCEPTION 'invalid_direction'; END IF;
  IF v_kind IN ('despesa_operacional','despesa_pessoal') AND NULLIF(it->>'category','') IS NULL THEN RAISE EXCEPTION 'category_required'; END IF;
  IF v_kind='receita_operacional' AND (tx.transaction_type IN ('APLICACAO_FINANCEIRA','RESGATE_APLIC_FINANCEIRA','RENDIMENTO_APLIC_FINANCEIRA','TRANSFERENCIA_SALDO_RESERVADO','OPERACAO_CREDITO','TRANSFERENCIA_MESMA_INSTITUICAO') OR tx.category_ref IN ('TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS','TRANSFER_IN_SAVINGS','TRANSFER_IN_ACCOUNT_TRANSFER','INCOME_INTEREST_EARNED','INCOME_DIVIDENDS') OR tx.category_ref LIKE 'LOAN_%' OR lower(coalesce(tx.description,'')||' '||coalesce(tx.counterparty_name,'')) ~ 'hyper\s?cash') THEN RAISE EXCEPTION 'not_operating_receipt'; END IF;
  SELECT * INTO r FROM public.polp_bank_reconciliations WHERE company_key=p_company_key AND polp_transaction_id=tx.polp_transaction_id;
  IF FOUND AND v_kind<>'receita_operacional' THEN RAISE EXCEPTION 'already_reconciled'; END IF;
  v_client:=NULLIF(it->>'client_id','')::uuid;
  IF v_client IS NOT NULL THEN
   IF v_kind<>'receita_operacional' OR NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=v_client) THEN RAISE EXCEPTION 'invalid_client'; END IF;
   IF EXISTS(SELECT 1 FROM public.polp_bank_client_links WHERE company_key=p_company_key AND polp_transaction_id=tx.polp_transaction_id AND client_id<>v_client) THEN RAISE EXCEPTION 'client_link_conflict'; END IF;
  END IF;
 END LOOP;
 FOR chunks IN SELECT jsonb_agg(value ORDER BY ord) FROM jsonb_array_elements(p_items) WITH ORDINALITY a(value,ord) GROUP BY (ord-1)/200 ORDER BY (ord-1)/200 LOOP
  n:=n+public.save_polp_bank_classifications(p_company_key,chunks,p_actor);
 END LOOP;
 FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  v_client:=NULLIF(it->>'client_id','')::uuid;
  IF v_client IS NOT NULL THEN
   INSERT INTO public.polp_bank_client_links(company_key,polp_transaction_id,client_id,actor) VALUES(p_company_key,it->>'transaction_id',v_client,p_actor) ON CONFLICT DO NOTHING;
   INSERT INTO public.polp_bank_classification_audit(company_key,polp_transaction_id,after_data,actor) VALUES(p_company_key,it->>'transaction_id',jsonb_build_object('client_id',v_client,'operation',p_operation),p_actor);
  END IF;
  IF jsonb_typeof(it->'reconciliation')='object' THEN
   IF v_client IS NULL OR NOT EXISTS(SELECT 1 FROM public.crm_client_charges ch WHERE ch.client_id=v_client AND (ch.id=(it->'reconciliation'->>'target_id')::uuid OR ch.id=(SELECT charge_id FROM public.crm_client_payments WHERE id=(it->'reconciliation'->>'target_id')::uuid))) THEN RAISE EXCEPTION 'invalid_client_target'; END IF;
   PERFORM public.reconcile_polp_bank_receipt(p_company_key,it->>'transaction_id',it->'reconciliation'->>'target',(it->'reconciliation'->>'target_id')::uuid,NULLIF(it->'reconciliation'->>'account_id','')::uuid,p_operation,'manual',p_actor);
  END IF;
 END LOOP;
 INSERT INTO public.polp_bank_review_operations(company_key,operation,payload,saved,actor) VALUES(p_company_key,p_operation,p_items,n,p_actor);
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.review_polp_bank_batch(text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_polp_bank_batch(text,uuid,jsonb,text) TO service_role;