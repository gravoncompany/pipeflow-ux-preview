CREATE TABLE public.finance_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope text NOT NULL CHECK(scope='crm:1' OR scope LIKE 'personal:%'), kind text NOT NULL CHECK(kind IN ('account','entry','goal','estimate','allocation','settlement','charge_meta','milestone')), data jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0, initial_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE ON public.finance_records TO service_role;
ALTER TABLE public.finance_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_records FROM anon,authenticated;
CREATE INDEX finance_records_scope ON public.finance_records(scope,kind);
CREATE TABLE public.finance_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation uuid NOT NULL UNIQUE, scope text NOT NULL, record_id uuid NOT NULL REFERENCES public.finance_records(id), actor text NOT NULL, action text NOT NULL, before_data jsonb, after_data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT ON public.finance_audit TO service_role;
ALTER TABLE public.finance_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_audit FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.finance_scope_allowed(p_scope text,p_actor text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.role()='service_role' AND (p_scope='crm:1' OR (p_scope='personal:'||p_actor AND EXISTS(SELECT 1 FROM public.user_roles r JOIN auth.users u ON u.id=r.user_id WHERE r.user_id::text=p_actor AND r.role='admin' AND u.email_confirmed_at IS NOT NULL)))
$$;
REVOKE ALL ON FUNCTION public.finance_scope_allowed(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_scope_allowed(text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.save_finance_record(p_scope text,p_actor text,p_operation uuid,p_id uuid,p_kind text,p_revision bigint,p_data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.finance_records; acc public.finance_records; target public.finance_records; rid uuid; replay public.finance_audit; available numeric; allocated numeric; paid numeric; amount numeric; refdate date;
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
 END IF;
 IF p_kind IN ('allocation','settlement') THEN
  IF amount<=0 OR p_data->>'confirmed'<>'true' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  SELECT * INTO acc FROM public.finance_records WHERE id=(p_data->>'accountId')::uuid AND scope=p_scope AND kind='account';
  IF NOT FOUND THEN RAISE EXCEPTION 'account_unavailable'; END IF;
  IF p_kind='settlement' THEN
   SELECT * INTO target FROM public.finance_records WHERE id=(p_data->>'targetId')::uuid AND scope=p_scope AND kind='entry';
   IF NOT FOUND OR target.data->>'status'='cancelado' THEN RAISE EXCEPTION 'entry_unavailable'; END IF;
   SELECT coalesce(sum((s.data->>'amount')::numeric),0) INTO paid FROM public.finance_records s WHERE s.scope=p_scope AND s.kind='settlement' AND s.data->>'targetId'=target.id::text;
   IF paid+amount>(target.data->>'amount')::numeric THEN RAISE EXCEPTION 'overpayment'; END IF;
  ELSE
   SELECT * INTO target FROM public.finance_records WHERE id=(p_data->>'targetId')::uuid AND scope=p_scope AND kind='goal';
   IF NOT FOUND THEN RAISE EXCEPTION 'goal_unavailable'; END IF;
   SELECT coalesce(sum(CASE WHEN s.data->>'direction'='release' THEN -(s.data->>'amount')::numeric ELSE (s.data->>'amount')::numeric END),0) INTO allocated FROM public.finance_records s WHERE s.scope=p_scope AND s.kind='allocation' AND s.data->>'targetId'=target.id::text AND s.data->>'accountId'=acc.id::text;
   IF p_data->>'direction'='release' THEN
    IF amount>allocated THEN RAISE EXCEPTION 'insufficient_reserved'; END IF;
   ELSE
    refdate:=(acc.data->>'referenceDate')::date;
    SELECT coalesce(sum(CASE WHEN e.data->>'direction'='in' THEN (s.data->>'amount')::numeric ELSE -(s.data->>'amount')::numeric END),0) INTO paid FROM public.finance_records s JOIN public.finance_records e ON e.id=(s.data->>'targetId')::uuid AND e.scope=p_scope WHERE s.scope=p_scope AND s.kind='settlement' AND s.data->>'accountId'=acc.id::text AND (s.data->>'date')::date>refdate;
    SELECT coalesce(sum(CASE WHEN s.data->>'direction'='release' THEN -(s.data->>'amount')::numeric ELSE (s.data->>'amount')::numeric END),0) INTO allocated FROM public.finance_records s WHERE s.scope=p_scope AND s.kind='allocation' AND s.data->>'accountId'=acc.id::text;
    available:=(acc.data->>'amount')::numeric+paid-allocated;
    IF amount>available THEN RAISE EXCEPTION 'insufficient_free_balance'; END IF;
   END IF;
  END IF;
 END IF;
 IF p_kind='goal' AND p_data->>'status'='concluida' THEN
  SELECT coalesce(sum(CASE WHEN s.data->>'direction'='release' THEN -(s.data->>'amount')::numeric ELSE (s.data->>'amount')::numeric END),0) INTO allocated FROM public.finance_records s WHERE s.scope=p_scope AND s.kind='allocation' AND s.data->>'targetId'=p_id::text;
  IF amount<=0 OR allocated<amount THEN RAISE EXCEPTION 'goal_not_funded'; END IF;
 END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.finance_records(scope,kind,data) VALUES(p_scope,p_kind,p_data) RETURNING id INTO rid;
 ELSE
  UPDATE public.finance_records SET data=p_data,revision=revision+1,updated_at=now() WHERE id=p_id RETURNING id INTO rid;
 END IF;
 INSERT INTO public.finance_audit(operation,scope,record_id,actor,action,before_data,after_data) VALUES(p_operation,p_scope,rid,p_actor,p_kind,old.data,p_data);
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.save_finance_record(text,text,uuid,uuid,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_finance_record(text,text,uuid,uuid,text,bigint,jsonb) TO service_role;