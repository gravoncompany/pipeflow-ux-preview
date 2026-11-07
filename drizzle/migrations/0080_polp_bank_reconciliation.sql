-- Fase 3 (mínima) — Conciliação de recebimentos bancários com clientes e lançamentos existentes.
-- Requer 0078 e 0079. Aditiva: uma tabela de vínculos e uma RPC. Reutiliza register_finance_client_payment (0069),
-- de modo que o faturamento confirmado e o Gravon Universe seguem a mesma regra de universe_confirmed_sources.
-- Garantias: um recebimento bancário só concilia uma vez; um pagamento/liquidação só recebe um recebimento;
-- pagamento já registrado manualmente é vinculado (nunca somado de novo); investimentos, resgates, rendimentos,
-- transferências próprias e empréstimos são recusados. Registro bancário original não é alterado.
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.polp_bank_reconciliations (
 company_key text NOT NULL CHECK (company_key = 'crm:1'),
 polp_transaction_id text NOT NULL,
 target_type text NOT NULL CHECK (target_type IN ('client_charge','client_payment','finance_settlement')),
 client_payment_id uuid UNIQUE REFERENCES public.crm_client_payments(id),
 finance_settlement_id uuid UNIQUE REFERENCES public.finance_records(id),
 charge_id uuid,
 amount_cents bigint NOT NULL CHECK (amount_cents > 0),
 operation uuid NOT NULL,
 mode text NOT NULL CHECK (mode IN ('auto','manual')),
 actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 160),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((client_payment_id IS NULL) <> (finance_settlement_id IS NULL)),
 PRIMARY KEY (company_key, polp_transaction_id),
 FOREIGN KEY (company_key, polp_transaction_id) REFERENCES public.polp_bank_transactions(company_key, polp_transaction_id)
);

CREATE OR REPLACE FUNCTION public.polp_bank_reconciliation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'polp_bank_reconciliation_immutable'; END;
$$;
CREATE TRIGGER polp_bank_reconciliation_guard BEFORE UPDATE OR DELETE ON public.polp_bank_reconciliations FOR EACH ROW EXECUTE FUNCTION public.polp_bank_reconciliation_guard();

CREATE OR REPLACE FUNCTION public.reconcile_polp_bank_receipt(p_company_key text, p_transaction_id text, p_target text, p_target_id uuid, p_account uuid, p_operation uuid, p_mode text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tx public.polp_bank_transactions; prev public.polp_bank_reconciliations; pay public.crm_client_payments; ov text; v_date date; v_payment uuid; v_settlement uuid; v_charge uuid; v_amount bigint;
BEGIN
 IF p_company_key IS DISTINCT FROM 'crm:1' THEN RAISE EXCEPTION 'invalid company'; END IF;
 IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid actor'; END IF;
 IF p_target NOT IN ('client_charge','client_payment','finance_settlement') OR p_target_id IS NULL OR p_operation IS NULL OR p_mode NOT IN ('auto','manual') THEN RAISE EXCEPTION 'invalid reconciliation'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:crm:1',0));
 SELECT * INTO tx FROM public.polp_bank_transactions WHERE company_key = p_company_key AND polp_transaction_id = p_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'polp_transaction_not_found'; END IF;
 -- Repetição idempotente: mesmo alvo devolve o vínculo existente; outro alvo é recusado.
 SELECT * INTO prev FROM public.polp_bank_reconciliations WHERE company_key = p_company_key AND polp_transaction_id = p_transaction_id;
 IF FOUND THEN
  IF prev.target_type = p_target AND (CASE p_target WHEN 'client_charge' THEN prev.charge_id WHEN 'client_payment' THEN prev.client_payment_id ELSE prev.finance_settlement_id END) = p_target_id THEN
   RETURN jsonb_build_object('replayed', true, 'client_payment_id', prev.client_payment_id, 'finance_settlement_id', prev.finance_settlement_id);
  END IF;
  RAISE EXCEPTION 'already_reconciled';
 END IF;
 IF tx.direction IS DISTINCT FROM 'CREDITO' OR tx.currency <> 'BRL' OR tx.amount_cents IS NULL OR tx.amount_cents <= 0 OR tx.transaction_at IS NULL THEN RAISE EXCEPTION 'not_a_receipt'; END IF;
 -- Movimentações não operacionais nunca viram faturamento.
 IF tx.transaction_type IN ('APLICACAO_FINANCEIRA','RESGATE_APLIC_FINANCEIRA','RENDIMENTO_APLIC_FINANCEIRA','TRANSFERENCIA_SALDO_RESERVADO','OPERACAO_CREDITO','TRANSFERENCIA_MESMA_INSTITUICAO')
  OR tx.category_ref IN ('TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS','TRANSFER_IN_SAVINGS','TRANSFER_IN_ACCOUNT_TRANSFER','INCOME_INTEREST_EARNED','INCOME_DIVIDENDS')
  OR tx.category_ref LIKE 'LOAN_%' THEN RAISE EXCEPTION 'not_operating_receipt'; END IF;
 SELECT kind INTO ov FROM public.polp_bank_classification_overrides WHERE company_key = p_company_key AND polp_transaction_id = p_transaction_id;
 IF ov IS NOT NULL AND ov <> 'receita_operacional' THEN RAISE EXCEPTION 'not_operating_receipt'; END IF;
 v_amount := tx.amount_cents;
 v_date := (tx.transaction_at AT TIME ZONE 'America/Sao_Paulo')::date;
 IF p_target = 'client_charge' THEN
  -- Reutiliza o registro oficial: valida conta, cobrança aberta e excesso; atualiza status e Universe.
  v_payment := public.register_finance_client_payment(p_actor, p_operation, p_target_id, p_account, (v_amount::numeric / 100), v_date, true);
  v_charge := p_target_id;
 ELSIF p_target = 'client_payment' THEN
  SELECT * INTO pay FROM public.crm_client_payments WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_unavailable'; END IF;
  IF round(pay.amount * 100)::bigint <> v_amount THEN RAISE EXCEPTION 'amount_mismatch'; END IF;
  IF pay.finance_operation IS NULL THEN
   -- Pagamento registrado manualmente (Clientes): passa a contar uma única vez ao receber a conta do Financeiro.
   IF NOT EXISTS (SELECT 1 FROM public.finance_records WHERE id = p_account AND scope = 'crm:1' AND kind = 'account') THEN RAISE EXCEPTION 'account_unavailable'; END IF;
   IF pay.paid_at > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'future_settlement'; END IF;
   UPDATE public.crm_client_payments SET finance_operation = p_operation, finance_account_id = p_account WHERE id = pay.id;
   PERFORM public.universe_refresh_awards();
  END IF;
  v_payment := pay.id; v_charge := pay.charge_id;
 ELSE
  SELECT id INTO v_settlement FROM public.finance_records WHERE id = p_target_id AND scope = 'crm:1' AND kind = 'settlement'
   AND data->>'confirmed' = 'true' AND (data->>'amount')::bigint = v_amount FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_unavailable'; END IF;
 END IF;
 INSERT INTO public.polp_bank_reconciliations(company_key, polp_transaction_id, target_type, client_payment_id, finance_settlement_id, charge_id, amount_cents, operation, mode, actor)
  VALUES (p_company_key, p_transaction_id, p_target, v_payment, v_settlement, v_charge, v_amount, p_operation, p_mode, p_actor);
 RETURN jsonb_build_object('replayed', false, 'client_payment_id', v_payment, 'finance_settlement_id', v_settlement);
END;
$$;

ALTER TABLE public.polp_bank_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.polp_bank_reconciliations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.polp_bank_reconciliations TO service_role;
REVOKE ALL ON FUNCTION public.polp_bank_reconciliation_guard(), public.reconcile_polp_bank_receipt(text,text,text,uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_polp_bank_receipt(text,text,text,uuid,uuid,uuid,text,text) TO service_role;
