CREATE OR REPLACE FUNCTION public.correct_crm_receipt_payment(p_actor text,p_operation uuid,p_payment uuid,p_expected_charge uuid,p_target uuid,p_reason text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pay public.crm_client_payments; target public.crm_client_charges; source public.crm_client_charges; total numeric; old jsonb; prior public.crm_receipt_audit;
BEGIN
 IF NOT public.finance_scope_allowed('crm:1',p_actor) OR p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_operation IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'invalid_correction'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:crm:1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:client-charges',0));
 SELECT * INTO prior FROM public.crm_receipt_audit WHERE operation=p_operation AND kind='payment_relinked';
 IF FOUND THEN
  IF prior.entity_id<>p_payment OR (prior.after_data->>'charge_id')::uuid<>p_target OR prior.actor<>p_actor THEN RAISE EXCEPTION 'operation_conflict'; END IF;
  RETURN true;
 END IF;
 SELECT * INTO pay FROM public.crm_client_payments WHERE id=p_payment FOR UPDATE;
 IF NOT FOUND OR pay.charge_id IS DISTINCT FROM p_expected_charge THEN RAISE EXCEPTION 'payment_changed'; END IF;
 IF pay.charge_id=p_target THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.crm_hypercash_charges WHERE finance_payment_id=p_payment) THEN RAISE EXCEPTION 'hypercash_link_protected'; END IF;
 SELECT * INTO source FROM public.crm_client_charges WHERE id=pay.charge_id FOR UPDATE;
 SELECT * INTO target FROM public.crm_client_charges WHERE id=p_target FOR UPDATE;
 IF NOT FOUND OR target.status='cancelado' THEN RAISE EXCEPTION 'target_unavailable'; END IF;
 IF source.client_id<>target.client_id THEN RAISE EXCEPTION 'different_client'; END IF;
 SELECT coalesce(sum(amount),0) INTO total FROM public.crm_client_payments WHERE charge_id=p_target;
 IF total+pay.amount>target.amount THEN RAISE EXCEPTION 'overpayment'; END IF;
 old:=to_jsonb(pay); PERFORM set_config('pipeflow.receipt_actor',p_actor,true);
 UPDATE public.crm_client_payments SET charge_id=p_target WHERE id=p_payment;
 INSERT INTO public.crm_receipt_audit(entity_id,kind,actor,operation,before_data,after_data) SELECT p_payment,'payment_relinked',p_actor,p_operation,old,to_jsonb(p)||jsonb_build_object('reason',p_reason) FROM public.crm_client_payments p WHERE id=p_payment;
 UPDATE public.crm_client_charges c SET status=CASE WHEN (SELECT coalesce(sum(amount),0) FROM public.crm_client_payments WHERE charge_id=c.id)>=c.amount THEN 'pago' WHEN c.due_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'vencido' ELSE 'pendente' END,revision=revision+1,updated_at=now() WHERE id IN (pay.charge_id,p_target) AND status<>'cancelado';
 RETURN true;
END $$;