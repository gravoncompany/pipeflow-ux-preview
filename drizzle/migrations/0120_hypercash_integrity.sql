ALTER TABLE public.crm_external_integrations ADD COLUMN encrypted_transactions_credentials text;
ALTER TABLE public.crm_external_integrations ADD COLUMN transactions_check_status text;
ALTER TABLE public.crm_external_integrations ADD COLUMN transactions_check_at timestamptz;
ALTER TABLE public.crm_external_integrations ADD COLUMN auto_sync boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_hypercash_subscriptions ADD COLUMN payment_method text;
ALTER TABLE public.crm_hypercash_charges ADD COLUMN finance_charge_id uuid REFERENCES public.crm_client_charges(id);
CREATE TABLE public.crm_hypercash_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),charge_id uuid REFERENCES public.crm_hypercash_charges(id),subscription_id text,event text NOT NULL,before_data jsonb,after_data jsonb NOT NULL,actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT ON public.crm_hypercash_audit TO service_role;
ALTER TABLE public.crm_hypercash_audit ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.crm_hypercash_payout_links(company_key text NOT NULL CHECK(company_key='crm:1'),bank_transaction_id text NOT NULL,charge_id uuid NOT NULL REFERENCES public.crm_hypercash_charges(id),gross_cents bigint NOT NULL,fee_cents bigint NOT NULL CHECK(fee_cents>=0),actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(company_key,bank_transaction_id,charge_id),UNIQUE(charge_id),FOREIGN KEY(company_key,bank_transaction_id) REFERENCES public.polp_bank_transactions(company_key,polp_transaction_id));
GRANT SELECT,INSERT ON public.crm_hypercash_payout_links TO service_role;
ALTER TABLE public.crm_hypercash_payout_links ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.confirm_hypercash_receipt(p_actor uuid,p_charge uuid,p_account uuid,p_target_charge uuid DEFAULT NULL,p_target_payment uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE hc public.crm_hypercash_charges;ch public.crm_client_charges;pay public.crm_client_payments;tid uuid;pid uuid;dt date;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.commercial_knowledge_access(p_actor,'crm:1') THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:crm:1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('hypercash:sync',0));
 SELECT * INTO hc FROM public.crm_hypercash_charges WHERE id=p_charge FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'charge_not_found';END IF;
 IF hc.finance_payment_id IS NOT NULL THEN RETURN jsonb_build_object('already',true,'payment',hc.finance_payment_id);END IF;
 IF hc.status<>'paid' OR hc.amount_cents<=0 OR hc.paid_at IS NULL OR hc.client_id IS NULL THEN RAISE EXCEPTION 'paid_receipt_required';END IF;
 dt:=(hc.paid_at AT TIME ZONE 'America/Sao_Paulo')::date;
 IF dt>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'future_payment';END IF;
 IF p_target_charge IS NOT NULL AND p_target_payment IS NOT NULL THEN RAISE EXCEPTION 'one_target_required';END IF;
 IF hc.transaction_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.crm_hypercash_charges WHERE id<>hc.id AND transaction_id=hc.transaction_id AND finance_payment_id IS NOT NULL) THEN RAISE EXCEPTION 'transaction_already_linked';END IF;
 IF p_target_payment IS NOT NULL THEN
  SELECT * INTO pay FROM public.crm_client_payments WHERE id=p_target_payment FOR UPDATE;
  IF NOT FOUND OR pay.amount<>hc.amount_cents::numeric/100 OR pay.paid_at<>dt THEN RAISE EXCEPTION 'payment_mismatch';END IF;
  SELECT * INTO ch FROM public.crm_client_charges WHERE id=pay.charge_id FOR UPDATE;
  IF ch.client_id<>hc.client_id OR ch.status='cancelado' OR pay.confirmed_by='' THEN RAISE EXCEPTION 'client_mismatch';END IF;
  IF EXISTS(SELECT 1 FROM public.crm_hypercash_charges WHERE finance_payment_id=pay.id) THEN RAISE EXCEPTION 'payment_already_linked';END IF;
  IF pay.finance_operation IS NULL OR pay.finance_account_id IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.finance_records WHERE id=p_account AND kind='account' AND scope='crm:1') THEN RAISE EXCEPTION 'account_unavailable';END IF;
   UPDATE public.crm_client_payments SET finance_operation=hc.id,finance_account_id=p_account WHERE id=pay.id;
  END IF;
  pid:=pay.id;tid:=pay.charge_id;
 ELSE
  tid:=p_target_charge;
  IF tid IS NOT NULL THEN
   SELECT * INTO ch FROM public.crm_client_charges WHERE id=tid FOR UPDATE;
   IF NOT FOUND OR ch.client_id<>hc.client_id THEN RAISE EXCEPTION 'client_mismatch';END IF;
  ELSE
   INSERT INTO public.crm_client_charges(client_id,description,amount,due_date,recurrence,recurrence_interval,payment_method,status,created_by) VALUES(hc.client_id,'Assinatura HyperCash · '||coalesce(hc.transaction_id,hc.charge_id),hc.amount_cents::numeric/100,coalesce(hc.billing_date::date,dt),'unica',0,'Pix · HyperCash','pendente',p_actor::text) RETURNING id INTO tid;
  END IF;
  pid:=public.register_finance_client_payment(p_actor::text,hc.id,tid,p_account,hc.amount_cents::numeric/100,dt,true);
  UPDATE public.crm_client_payments SET method='Pix · HyperCash',note='Recebimento HyperCash confirmado' WHERE id=pid;
 END IF;
 UPDATE public.crm_hypercash_charges SET finance_payment_id=pid,finance_charge_id=tid WHERE id=hc.id;
 INSERT INTO public.crm_hypercash_audit(charge_id,event,before_data,after_data,actor) VALUES(hc.id,'receipt_confirmed',jsonb_build_object('payment',null),jsonb_build_object('payment',pid,'charge',tid),p_actor::text);
 RETURN jsonb_build_object('already',false,'payment',pid);
END;$$;
REVOKE ALL ON FUNCTION public.confirm_hypercash_receipt(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_hypercash_receipt(uuid,uuid,uuid,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.link_hypercash_payout(p_actor uuid,p_bank text,p_charges uuid[],p_fee bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tx public.polp_bank_transactions;gross bigint;n integer;hc public.crm_hypercash_charges;items jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.commercial_knowledge_access(p_actor,'crm:1') THEN RAISE EXCEPTION 'forbidden';END IF;
 IF cardinality(p_charges) NOT BETWEEN 1 AND 100 OR p_fee IS NULL OR p_fee<0 THEN RAISE EXCEPTION 'invalid_payout';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:crm:1',0));PERFORM pg_advisory_xact_lock(hashtextextended('hypercash:sync',0));
 SELECT * INTO tx FROM public.polp_bank_transactions WHERE company_key='crm:1' AND polp_transaction_id=p_bank FOR UPDATE;
 IF NOT FOUND OR tx.direction<>'CREDITO' OR tx.currency<>'BRL' OR tx.amount_cents<=0 THEN RAISE EXCEPTION 'bank_mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.polp_bank_reconciliations WHERE company_key='crm:1' AND polp_transaction_id=p_bank) THEN RAISE EXCEPTION 'already_reconciled_as_revenue';END IF;
 IF EXISTS(SELECT 1 FROM public.crm_hypercash_payout_links WHERE company_key='crm:1' AND bank_transaction_id=p_bank) THEN RAISE EXCEPTION 'payout_already_linked';END IF;
 PERFORM 1 FROM public.crm_hypercash_charges WHERE id=ANY(p_charges) ORDER BY id FOR UPDATE;
 SELECT count(DISTINCT id),sum(amount_cents) INTO n,gross FROM public.crm_hypercash_charges WHERE id=ANY(p_charges) AND status='paid' AND finance_payment_id IS NOT NULL;
 IF n<>cardinality(p_charges) OR gross-p_fee<>tx.amount_cents THEN RAISE EXCEPTION 'payout_totals_mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.crm_hypercash_payout_links WHERE charge_id=ANY(p_charges)) THEN RAISE EXCEPTION 'receipt_already_paid_out';END IF;
 SELECT jsonb_build_array(jsonb_build_object('transaction_id',p_bank,'kind','transferencia_interna','category',null,'vendor','HyperCash','expected_revision',coalesce((SELECT revision FROM public.polp_bank_classification_overrides WHERE company_key='crm:1' AND polp_transaction_id=p_bank),0),'decision','corrigido','rule',null)) INTO items;
 PERFORM public.save_polp_bank_classifications('crm:1',items,p_actor::text);
 FOR hc IN SELECT * FROM public.crm_hypercash_charges WHERE id=ANY(p_charges) ORDER BY id LOOP
  INSERT INTO public.crm_hypercash_payout_links(company_key,bank_transaction_id,charge_id,gross_cents,fee_cents,actor) VALUES('crm:1',p_bank,hc.id,hc.amount_cents,CASE WHEN hc.id=p_charges[1] THEN p_fee ELSE 0 END,p_actor::text);
 END LOOP;
 INSERT INTO public.crm_hypercash_audit(event,after_data,actor) VALUES('payout_linked',jsonb_build_object('bank',p_bank,'charges',p_charges,'gross',gross,'fee',p_fee),p_actor::text);
END;$$;
REVOKE ALL ON FUNCTION public.link_hypercash_payout(uuid,text,uuid[],bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.link_hypercash_payout(uuid,text,uuid[],bigint) TO service_role;
CREATE OR REPLACE FUNCTION public.audit_hypercash_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NEW.status IS DISTINCT FROM OLD.status OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN INSERT INTO public.crm_hypercash_audit(charge_id,event,before_data,after_data,actor) VALUES(NEW.id,'provider_update',jsonb_build_object('status',OLD.status,'amount',OLD.amount_cents,'paid_at',OLD.paid_at),jsonb_build_object('status',NEW.status,'amount',NEW.amount_cents,'paid_at',NEW.paid_at),'hypercash_sync');END IF;RETURN NEW;END;$$;
CREATE TRIGGER hypercash_status_audit AFTER UPDATE ON public.crm_hypercash_charges FOR EACH ROW EXECUTE FUNCTION public.audit_hypercash_status();