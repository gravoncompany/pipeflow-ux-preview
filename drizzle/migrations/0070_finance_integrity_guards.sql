CREATE OR REPLACE FUNCTION public.finance_integrity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE day date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; acc public.finance_records; bal numeric; reserved numeric; target_reserved numeric;
BEGIN
 IF NEW.kind IN ('settlement','allocation') THEN
  IF NEW.data->>'confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  IF (NEW.data->>'date')::date>day THEN RAISE EXCEPTION 'future_settlement'; END IF;
 END IF;
 IF NEW.kind='entry' AND NEW.data->>'accountId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.finance_records WHERE id=(NEW.data->>'accountId')::uuid AND scope=NEW.scope AND kind='account') THEN RAISE EXCEPTION 'account_unavailable'; END IF;
 IF NEW.kind='charge_meta' THEN
  IF NEW.scope<>'crm:1' OR NOT EXISTS(SELECT 1 FROM public.crm_client_charges WHERE id=(NEW.data->>'chargeId')::uuid) THEN RAISE EXCEPTION 'charge_unavailable'; END IF;
 END IF;
 IF NEW.kind='allocation' AND NEW.data->>'direction'='release' THEN
  SELECT coalesce(sum(CASE WHEN data->>'direction'='release' THEN -(data->>'amount')::numeric ELSE (data->>'amount')::numeric END),0) INTO target_reserved FROM public.finance_records WHERE scope=NEW.scope AND kind='allocation' AND data->>'targetId'=NEW.data->>'targetId';
  IF EXISTS(SELECT 1 FROM public.finance_records WHERE id=(NEW.data->>'targetId')::uuid AND data->>'status'='concluida' AND (data->>'amount')::numeric>target_reserved-(NEW.data->>'amount')::numeric) THEN RAISE EXCEPTION 'reopen_goal_before_release'; END IF;
 END IF;
 IF NEW.kind='settlement' THEN
  SELECT * INTO acc FROM public.finance_records WHERE id=(NEW.data->>'accountId')::uuid AND scope=NEW.scope AND kind='account';
  IF EXISTS(SELECT 1 FROM public.finance_records WHERE id=(NEW.data->>'targetId')::uuid AND data->>'direction'='out') THEN
   SELECT coalesce(sum(CASE WHEN e.data->>'direction'='in' THEN (s.data->>'amount')::numeric ELSE -(s.data->>'amount')::numeric END),0) INTO bal FROM public.finance_records s JOIN public.finance_records e ON e.id=(s.data->>'targetId')::uuid WHERE s.scope=NEW.scope AND s.kind='settlement' AND s.data->>'accountId'=acc.id::text AND (s.data->>'date')::date>(acc.data->>'referenceDate')::date;
   SELECT coalesce(sum(CASE WHEN data->>'direction'='release' THEN -(data->>'amount')::numeric ELSE (data->>'amount')::numeric END),0) INTO reserved FROM public.finance_records WHERE scope=NEW.scope AND kind='allocation' AND data->>'accountId'=acc.id::text;
   IF (NEW.data->>'date')::date>(acc.data->>'referenceDate')::date AND (acc.data->>'amount')::numeric+bal-(NEW.data->>'amount')::numeric<reserved THEN RAISE EXCEPTION 'release_reserve_before_payment'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_integrity BEFORE INSERT OR UPDATE ON public.finance_records FOR EACH ROW EXECUTE FUNCTION public.finance_integrity_guard();
REVOKE ALL ON FUNCTION public.finance_integrity_guard() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.finance_client_date_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.finance_operation IS NOT NULL AND NEW.paid_at>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'future_settlement'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_client_payment_date BEFORE INSERT ON public.crm_client_payments FOR EACH ROW EXECUTE FUNCTION public.finance_client_date_guard();