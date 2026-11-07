ALTER TABLE public.crm_external_integrations ADD COLUMN sync_lease uuid;
ALTER TABLE public.crm_external_integrations ADD COLUMN sync_lease_until timestamptz;
CREATE OR REPLACE FUNCTION public.claim_hypercash_sync(p_lease uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden';END IF;UPDATE public.crm_external_integrations SET sync_lease=p_lease,sync_lease_until=now()+interval '15 minutes' WHERE provider='hypercash' AND status='ativa' AND (sync_lease_until IS NULL OR sync_lease_until<now());RETURN FOUND;END;$$;
REVOKE ALL ON FUNCTION public.claim_hypercash_sync(uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.claim_hypercash_sync(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.apply_hypercash_snapshot(p_lease uuid,p_revision integer,p_subs jsonb,p_charges jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i jsonb; client uuid;prev_client uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR jsonb_typeof(p_subs)<>'array' OR jsonb_typeof(p_charges)<>'array' THEN RAISE EXCEPTION 'forbidden';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hypercash:sync',0));
 PERFORM 1 FROM public.crm_external_integrations WHERE provider='hypercash' AND status='ativa' AND revision=p_revision AND sync_lease=p_lease AND sync_lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'sync_configuration_changed';END IF;
 FOR i IN SELECT value FROM jsonb_array_elements(p_subs) LOOP
  client:=NULL; SELECT min(id::text)::uuid INTO client FROM public.crm_clients WHERE lower(btrim(email))=lower(btrim(i->>'customerEmail')) HAVING count(*)=1;
  INSERT INTO public.crm_hypercash_subscriptions(subscription_id,customer_name,customer_email,product_name,amount_cents,frequency,status,next_billing_date,last_payment_at,payment_method,client_id,synced_at) VALUES(i->>'subscriptionId',i->>'customerName',i->>'customerEmail',i->>'productName',(i->>'amountCents')::integer,i->>'frequency',i->>'status',i->>'nextBillingDate',(i->>'lastPaymentAt')::timestamptz,i->>'paymentMethod',client,now()) ON CONFLICT(subscription_id) DO UPDATE SET customer_name=EXCLUDED.customer_name,customer_email=EXCLUDED.customer_email,product_name=EXCLUDED.product_name,amount_cents=EXCLUDED.amount_cents,frequency=EXCLUDED.frequency,status=EXCLUDED.status,next_billing_date=EXCLUDED.next_billing_date,last_payment_at=EXCLUDED.last_payment_at,payment_method=EXCLUDED.payment_method,client_id=coalesce(crm_hypercash_subscriptions.client_id,EXCLUDED.client_id),synced_at=now();
 END LOOP;
 FOR i IN SELECT value FROM jsonb_array_elements(p_charges) LOOP
  SELECT client_id INTO client FROM public.crm_hypercash_subscriptions WHERE subscription_id=i->>'subscriptionId';
  IF EXISTS(SELECT 1 FROM public.crm_hypercash_charges WHERE charge_id=i->>'chargeId' AND finance_payment_id IS NOT NULL AND (amount_cents<>(i->>'amountCents')::integer OR paid_at IS DISTINCT FROM (i->>'paidAt')::timestamptz OR transaction_id IS DISTINCT FROM i->>'transactionId')) THEN RAISE EXCEPTION 'confirmed_receipt_changed_requires_review';END IF;
  INSERT INTO public.crm_hypercash_charges(charge_id,subscription_id,transaction_id,order_id,amount_cents,status,billing_date,paid_at,customer_name,customer_email,client_id,synced_at) VALUES(i->>'chargeId',i->>'subscriptionId',i->>'transactionId',i->>'orderId',(i->>'amountCents')::integer,i->>'status',i->>'billingDate',(i->>'paidAt')::timestamptz,i->>'customerName',i->>'customerEmail',client,now()) ON CONFLICT(charge_id) DO UPDATE SET subscription_id=EXCLUDED.subscription_id,transaction_id=EXCLUDED.transaction_id,order_id=EXCLUDED.order_id,amount_cents=EXCLUDED.amount_cents,status=EXCLUDED.status,billing_date=EXCLUDED.billing_date,paid_at=EXCLUDED.paid_at,customer_name=EXCLUDED.customer_name,customer_email=EXCLUDED.customer_email,client_id=coalesce(crm_hypercash_charges.client_id,EXCLUDED.client_id),synced_at=now();
 END LOOP;
 UPDATE public.crm_external_integrations SET sync_lease=NULL,sync_lease_until=NULL WHERE provider='hypercash' AND sync_lease=p_lease;
END;$$;
REVOKE ALL ON FUNCTION public.apply_hypercash_snapshot(uuid,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.apply_hypercash_snapshot(uuid,integer,jsonb,jsonb) TO service_role;