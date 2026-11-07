CREATE UNIQUE INDEX finance_occurrence_unique ON public.finance_records(scope,(data->>'seriesKey'),(data->>'occurrence')) WHERE kind='entry' AND data->>'seriesKey' IS NOT NULL;
CREATE UNIQUE INDEX finance_charge_meta_unique ON public.finance_records(scope,(data->>'chargeId')) WHERE kind='charge_meta';
CREATE OR REPLACE FUNCTION public.create_finance_series(p_scope text,p_actor text,p_operation uuid,p_entries jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; i integer:=0; first_id uuid; rid uuid;
BEGIN
 IF NOT public.finance_scope_allowed(p_scope,p_actor) THEN RAISE EXCEPTION 'finance_forbidden'; END IF;
 IF jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'invalid_series'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:'||p_scope,0));
 FOR item IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
  rid:=public.save_finance_record(p_scope,p_actor,md5(p_operation::text||':'||i::text)::uuid,NULL,'entry',0,item);
  IF i=0 THEN first_id:=rid; END IF;
  i:=i+1;
 END LOOP;
 RETURN first_id;
END $$;
REVOKE ALL ON FUNCTION public.create_finance_series(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_finance_series(text,text,uuid,jsonb) TO service_role;
ALTER TABLE public.crm_client_payments ADD COLUMN finance_operation uuid UNIQUE;
ALTER TABLE public.crm_client_payments ADD COLUMN finance_account_id uuid REFERENCES public.finance_records(id);
CREATE OR REPLACE FUNCTION public.register_finance_client_payment(p_actor text,p_operation uuid,p_charge uuid,p_account uuid,p_amount numeric,p_date date,p_confirmed boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ch public.crm_client_charges; total numeric; rid uuid; prev public.crm_client_payments;
BEGIN
 IF NOT public.finance_scope_allowed('crm:1',p_actor) THEN RAISE EXCEPTION 'finance_forbidden'; END IF;
 IF p_confirmed IS DISTINCT FROM true OR p_amount IS NULL OR p_amount<=0 OR p_amount>100000000 OR p_date IS NULL THEN RAISE EXCEPTION 'payment_not_confirmed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:crm:1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-charge:'||p_charge::text,0));
 SELECT * INTO prev FROM public.crm_client_payments WHERE finance_operation=p_operation;
 IF FOUND THEN
  IF prev.charge_id<>p_charge OR prev.finance_account_id<>p_account OR prev.amount<>p_amount OR prev.paid_at<>p_date OR prev.confirmed_by<>p_actor THEN RAISE EXCEPTION 'operation_conflict'; END IF;
  RETURN prev.id;
 END IF;
 SELECT * INTO ch FROM public.crm_client_charges WHERE id=p_charge FOR UPDATE;
 IF NOT FOUND OR ch.status IN ('pago','cancelado') THEN RAISE EXCEPTION 'charge_paid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.finance_records WHERE id=p_account AND scope='crm:1' AND kind='account') THEN RAISE EXCEPTION 'account_unavailable'; END IF;
 SELECT coalesce(sum(amount),0) INTO total FROM public.crm_client_payments WHERE charge_id=p_charge;
 IF total+p_amount>ch.amount THEN RAISE EXCEPTION 'overpayment'; END IF;
 INSERT INTO public.crm_client_payments(charge_id,amount,paid_at,method,note,confirmed_by,finance_operation,finance_account_id) VALUES(p_charge,p_amount,p_date,'Conciliação manual','Registrado no Financeiro',p_actor,p_operation,p_account) RETURNING id INTO rid;
 UPDATE public.crm_client_charges SET status=CASE WHEN total+p_amount>=amount THEN 'pago' WHEN due_date<current_date THEN 'vencido' ELSE 'pendente' END,revision=revision+1,updated_at=now() WHERE id=p_charge;
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.register_finance_client_payment(text,uuid,uuid,uuid,numeric,date,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_finance_client_payment(text,uuid,uuid,uuid,numeric,date,boolean) TO service_role;