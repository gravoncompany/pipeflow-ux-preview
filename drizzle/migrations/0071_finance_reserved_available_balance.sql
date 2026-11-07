CREATE OR REPLACE FUNCTION public.finance_available_account(p_scope text,p_account uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (a.data->>'amount')::numeric
 +coalesce((SELECT sum(CASE WHEN e.data->>'direction'='in' THEN (s.data->>'amount')::numeric ELSE -(s.data->>'amount')::numeric END) FROM public.finance_records s JOIN public.finance_records e ON e.id=(s.data->>'targetId')::uuid WHERE s.scope=p_scope AND s.kind='settlement' AND s.data->>'accountId'=a.id::text AND (s.data->>'date')::date>(a.data->>'referenceDate')::date AND (s.data->>'date')::date<=(now() AT TIME ZONE 'America/Sao_Paulo')::date),0)
 +coalesce((SELECT sum(p.amount*100) FROM public.crm_client_payments p WHERE p.finance_account_id=a.id AND p.paid_at>(a.data->>'referenceDate')::date AND p.paid_at<=(now() AT TIME ZONE 'America/Sao_Paulo')::date),0)
 -coalesce((SELECT sum(CASE WHEN r.data->>'direction'='release' THEN -(r.data->>'amount')::numeric ELSE (r.data->>'amount')::numeric END) FROM public.finance_records r WHERE r.scope=p_scope AND r.kind='allocation' AND r.data->>'accountId'=a.id::text),0)
 FROM public.finance_records a WHERE a.id=p_account AND a.scope=p_scope AND a.kind='account'
$$;
REVOKE ALL ON FUNCTION public.finance_available_account(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_available_account(text,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.save_finance_record(p_scope text,p_actor text,p_operation uuid,p_id uuid,p_kind text,p_revision bigint,p_data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.finance_records; acc public.finance_records; target public.finance_records; rid uuid; replay public.finance_audit; available numeric; allocated numeric; paid numeric; amount numeric;
BEGIN
 IF NOT public.finance_scope_allowed(p_scope,p_actor) THEN RAISE EXCEPTION 'finance_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:'||p_scope,0));
 SELECT * INTO replay FROM public.finance_audit WHERE operation=p_operation;
 IF FOUND THEN
  IF replay.scope<>p_scope OR replay.actor<>p_actor OR replay.after_data<>p_data OR replay.action<>p_kind OR (p_id IS NOT NULL AND replay.record_id<>p_id) THEN RAISE EXCEPTION 'operation_conflict'; END IF;
  RETURN replay.record_id;
 END IF;
 IF jsonb_typeof(p_data)<>'object' OR length(p_data::text)>20000 THEN RAISE EXCEPTION 'invalid_finance_data'; END IF;
 amount:=coalesce((p_data->>'amount')::numeric,0);
 IF amount<0 OR amount>100000000000 OR amount<>trunc(amount) THEN RAISE EXCEPTION 'invalid_amount'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO old FROM public.finance_records WHERE id=p_id AND scope=p_scope FOR UPDATE;
  IF NOT FOUND OR old.kind<>p_kind OR old.revision<>p_revision THEN RAISE EXCEPTION 'finance_changed'; END IF;
  IF old.kind IN ('allocation','settlement') THEN RAISE EXCEPTION 'immutable_finance_history'; END IF;
  IF old.kind='entry' AND EXISTS(SELECT 1 FROM public.finance_records s WHERE s.scope=p_scope AND s.kind='settlement' AND s.data->>'targetId'=p_id::text) THEN RAISE EXCEPTION 'settled_entry_immutable'; END IF;
  IF old.kind='account' THEN
   SELECT coalesce(sum(CASE WHEN data->>'direction'='release' THEN -(data->>'amount')::numeric ELSE (data->>'amount')::numeric END),0) INTO allocated FROM public.finance_records WHERE scope=p_scope AND kind='allocation' AND data->>'accountId'=p_id::text;
   IF (p_data->>'referenceDate')::date>(now() AT TIME ZONE 'America/Sao_Paulo')::date OR amount<allocated THEN RAISE EXCEPTION 'invalid_reference_balance'; END IF;
  END IF;
 END IF;
 IF p_kind IN ('allocation','settlement') THEN
  IF amount<=0 OR p_data->>'confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  SELECT * INTO acc FROM public.finance_records WHERE id=(p_data->>'accountId')::uuid AND scope=p_scope AND kind='account';
  IF NOT FOUND THEN RAISE EXCEPTION 'account_unavailable'; END IF;
  IF p_kind='settlement' THEN
   SELECT * INTO target FROM public.finance_records WHERE id=(p_data->>'targetId')::uuid AND scope=p_scope AND kind='entry';
   IF NOT FOUND OR target.data->>'status'='cancelado' THEN RAISE EXCEPTION 'entry_unavailable'; END IF;
   SELECT coalesce(sum((s.data->>'amount')::numeric),0) INTO paid FROM public.finance_records s WHERE s.scope=p_scope AND s.kind='settlement' AND s.data->>'targetId'=target.id::text;
   IF paid+amount>(target.data->>'amount')::numeric THEN RAISE EXCEPTION 'overpayment'; END IF;
   IF target.data->>'direction'='out' AND (p_data->>'date')::date>(acc.data->>'referenceDate')::date AND amount>public.finance_available_account(p_scope,acc.id) THEN RAISE EXCEPTION 'insufficient_free_balance'; END IF;
  ELSE
   SELECT * INTO target FROM public.finance_records WHERE id=(p_data->>'targetId')::uuid AND scope=p_scope AND kind='goal';
   IF NOT FOUND THEN RAISE EXCEPTION 'goal_unavailable'; END IF;
   SELECT coalesce(sum(CASE WHEN s.data->>'direction'='release' THEN -(s.data->>'amount')::numeric ELSE (s.data->>'amount')::numeric END),0) INTO allocated FROM public.finance_records s WHERE s.scope=p_scope AND s.kind='allocation' AND s.data->>'targetId'=target.id::text AND s.data->>'accountId'=acc.id::text;
   IF p_data->>'direction'='release' THEN
    IF amount>allocated THEN RAISE EXCEPTION 'insufficient_reserved'; END IF;
   ELSE
    available:=public.finance_available_account(p_scope,acc.id);
    IF amount>available THEN RAISE EXCEPTION 'insufficient_free_balance'; END IF;
   END IF;
  END IF;
 END IF;
 IF p_kind='goal' AND p_data->>'status'='concluida' THEN
  SELECT coalesce(sum(CASE WHEN s.data->>'direction'='release' THEN -(s.data->>'amount')::numeric ELSE (s.data->>'amount')::numeric END),0) INTO allocated FROM public.finance_records s WHERE s.scope=p_scope AND s.kind='allocation' AND s.data->>'targetId'=p_id::text;
  IF amount<=0 OR allocated<amount THEN RAISE EXCEPTION 'goal_not_funded'; END IF;
 END IF;
 IF p_id IS NULL THEN INSERT INTO public.finance_records(scope,kind,data) VALUES(p_scope,p_kind,p_data) RETURNING id INTO rid;
 ELSE UPDATE public.finance_records SET data=p_data,revision=revision+1,updated_at=now() WHERE id=p_id RETURNING id INTO rid; END IF;
 INSERT INTO public.finance_audit(operation,scope,record_id,actor,action,before_data,after_data) VALUES(p_operation,p_scope,rid,p_actor,p_kind,old.data,p_data);
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.save_finance_record(text,text,uuid,uuid,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_finance_record(text,text,uuid,uuid,text,bigint,jsonb) TO service_role;