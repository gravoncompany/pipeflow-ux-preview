ALTER TABLE public.crm_client_charges ADD COLUMN project_id uuid REFERENCES public.crm_client_projects(id);
CREATE TABLE public.crm_receipt_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.crm_clients(id), project_id uuid REFERENCES public.crm_client_projects(id), config jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, operation uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_receipt_schedules TO service_role;
ALTER TABLE public.crm_receipt_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_client_charges ADD COLUMN receipt_schedule_id uuid REFERENCES public.crm_receipt_schedules(id);
CREATE UNIQUE INDEX crm_receipt_schedule_due ON public.crm_client_charges(receipt_schedule_id,due_date) WHERE receipt_schedule_id IS NOT NULL;
CREATE TABLE public.crm_receipt_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_id uuid NOT NULL, kind text NOT NULL, actor text NOT NULL, operation uuid, before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_receipt_audit TO service_role;
ALTER TABLE public.crm_receipt_audit ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX crm_receipt_correction_operation ON public.crm_receipt_audit(operation) WHERE kind='payment_relinked';
CREATE OR REPLACE FUNCTION public.audit_crm_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.crm_receipt_audit(entity_id,kind,actor,before_data,after_data) VALUES(NEW.id,TG_TABLE_NAME||':'||TG_OP,coalesce(nullif(current_setting('pipeflow.receipt_actor',true),''),CASE WHEN TG_TABLE_NAME='crm_client_payments' THEN to_jsonb(NEW)->>'confirmed_by' ELSE to_jsonb(NEW)->>'created_by' END,'Sistema'),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE TRIGGER crm_receipt_charge_audit AFTER INSERT OR UPDATE ON public.crm_client_charges FOR EACH ROW EXECUTE FUNCTION public.audit_crm_receipt();
CREATE TRIGGER crm_receipt_payment_audit AFTER INSERT OR UPDATE ON public.crm_client_payments FOR EACH ROW EXECUTE FUNCTION public.audit_crm_receipt();
CREATE OR REPLACE FUNCTION public.save_crm_receipt_schedule(p_actor text,p_operation uuid,p_id uuid,p_revision integer,p_client uuid,p_project uuid,p_config jsonb,p_generate boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.crm_receipt_schedules; rid uuid; d date; start_d date; end_d date; f text; amt numeric; label text; day1 integer; day2 integer; lastday integer; month_d date; item date; recurrence_name text; old jsonb;
BEGIN
 IF NOT public.finance_scope_allowed('crm:1',p_actor) OR p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_operation IS NULL OR p_config IS NULL OR jsonb_typeof(p_config)<>'object' THEN RAISE EXCEPTION 'invalid_schedule'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p_client) OR (p_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.crm_client_projects WHERE id=p_project AND client_id=p_client)) THEN RAISE EXCEPTION 'client_project_unavailable'; END IF;
 start_d:=(p_config->>'start')::date; end_d:=(p_config->>'end')::date; f:=p_config->>'frequency'; amt:=(p_config->>'amount')::numeric/100; label:=p_config->>'description'; day1:=(p_config->>'day1')::integer; day2:=(p_config->>'day2')::integer;
 IF start_d IS NULL OR end_d IS NULL OR end_d<start_d OR end_d>start_d+370 OR amt IS NULL OR amt<=0 OR amt>100000000 OR amt<>round(amt,2) OR label IS NULL OR length(label) NOT BETWEEN 2 AND 300 OR f IS NULL OR f NOT IN ('mensal','quinzenal_fixa','quinzenal','semanal') OR day1 IS NULL OR day1 NOT BETWEEN 1 AND 31 OR day2 IS NULL OR day2 NOT BETWEEN 1 AND 31 OR (f='quinzenal_fixa' AND day1>=day2) OR length(coalesce(p_config->>'method',''))>120 THEN RAISE EXCEPTION 'invalid_schedule'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:crm:1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:client-charges',0));
 SELECT * INTO s FROM public.crm_receipt_schedules WHERE operation=p_operation;
 IF FOUND THEN
  IF s.client_id<>p_client OR s.project_id IS DISTINCT FROM p_project OR s.config IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'operation_conflict'; END IF;
  RETURN s.id;
 END IF;
 IF p_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.crm_receipt_schedules WHERE client_id=p_client AND project_id IS NOT DISTINCT FROM p_project AND config->>'description'=label) THEN RAISE EXCEPTION 'schedule_exists'; END IF;
  INSERT INTO public.crm_receipt_schedules(client_id,project_id,config,operation) VALUES(p_client,p_project,p_config,p_operation) RETURNING id INTO rid;
 ELSE
  SELECT * INTO s FROM public.crm_receipt_schedules WHERE id=p_id AND client_id=p_client FOR UPDATE;
  IF NOT FOUND OR s.revision<>p_revision THEN RAISE EXCEPTION 'schedule_changed'; END IF;
  IF s.project_id IS DISTINCT FROM p_project THEN RAISE EXCEPTION 'project_changed'; END IF;
  IF p_generate AND s.config IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'save_before_generate'; END IF;
  old:=s.config; rid:=s.id;
  UPDATE public.crm_receipt_schedules SET config=p_config,revision=revision+1,operation=p_operation,updated_at=now() WHERE id=rid;
 END IF;
 PERFORM set_config('pipeflow.receipt_actor',p_actor,true);
 INSERT INTO public.crm_receipt_audit(entity_id,kind,actor,operation,before_data,after_data) VALUES(rid,'schedule_saved',p_actor,p_operation,old,p_config);
 IF p_generate THEN
  recurrence_name:=CASE WHEN f='quinzenal_fixa' THEN 'quinzenal' ELSE f END;
  d:=start_d;
  WHILE d<=end_d LOOP
   IF (f='mensal' OR f='quinzenal_fixa') THEN
    month_d:=date_trunc('month',d)::date; lastday:=extract(day FROM month_d+interval '1 month'-interval '1 day')::integer;
    IF extract(day FROM d)::integer<>least(day1,lastday) AND (f<>'quinzenal_fixa' OR extract(day FROM d)::integer<>least(day2,lastday)) THEN d:=d+1; CONTINUE; END IF;
   ELSIF f='semanal' AND (d-start_d)%7<>0 THEN d:=d+1; CONTINUE;
   ELSIF f='quinzenal' AND (d-start_d)%14<>0 THEN d:=d+1; CONTINUE;
   END IF;
   -- Never silently duplicate or adopt an existing real charge for this client/date.
   IF NOT EXISTS(SELECT 1 FROM public.crm_client_charges WHERE client_id=p_client AND due_date=d AND status<>'cancelado' AND (receipt_schedule_id=rid OR (project_id IS NOT DISTINCT FROM p_project AND description=label))) THEN
    INSERT INTO public.crm_client_charges(client_id,project_id,receipt_schedule_id,description,amount,due_date,recurrence,recurrence_interval,payment_method,created_by) VALUES(p_client,p_project,rid,label,amt,d,recurrence_name,CASE WHEN f='quinzenal_fixa' THEN 0 WHEN f='quinzenal' THEN 14 WHEN f='semanal' THEN 7 ELSE 0 END,coalesce(p_config->>'method',''),p_actor) ON CONFLICT DO NOTHING;
   END IF;
   d:=d+1;
  END LOOP;
 END IF;
 RETURN rid;
END $$;
CREATE OR REPLACE FUNCTION public.correct_crm_receipt_payment(p_actor text,p_operation uuid,p_payment uuid,p_expected_charge uuid,p_target uuid,p_reason text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pay public.crm_client_payments; target public.crm_client_charges; source public.crm_client_charges; total numeric; old jsonb; tx text; prior public.crm_receipt_audit;
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
 -- HyperCash receipts retain their contractual linkage; do not change them here.
 IF EXISTS(SELECT 1 FROM public.crm_hypercash_charges WHERE client_payment_id=p_payment) THEN RAISE EXCEPTION 'hypercash_link_protected'; END IF;
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
REVOKE ALL ON FUNCTION public.audit_crm_receipt(), public.save_crm_receipt_schedule(text,uuid,uuid,integer,uuid,uuid,jsonb,boolean),public.correct_crm_receipt_payment(text,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_receipt_schedule(text,uuid,uuid,integer,uuid,uuid,jsonb,boolean),public.correct_crm_receipt_payment(text,uuid,uuid,uuid,uuid,text) TO service_role;