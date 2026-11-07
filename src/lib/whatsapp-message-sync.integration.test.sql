-- Run only against a disposable local database loaded with the CRM message schema.
DO $$
BEGIN
  IF NOT public.save_gravon_accepted_message('test-accepted','test-instance','5511999998888@s.whatsapp.net','1199998888','fictional reply',now()) THEN RAISE EXCEPTION 'Acceptance not persisted'; END IF;
  IF (SELECT send_state FROM public.whatsapp_messages WHERE message_id='test-accepted') <> 'accepted' THEN RAISE EXCEPTION 'Acceptance state wrong'; END IF;
  IF EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE message_id='test-accepted' AND delivered_at IS NOT NULL) THEN RAISE EXCEPTION 'False delivery'; END IF;
END $$;
-- Echo after acceptance does not replace metadata.
INSERT INTO public.whatsapp_messages(message_id,instance,phone,phone_key,from_me,body)
VALUES('test-accepted','test-instance','5511999998888','1199998888',true,'fictional reply') ON CONFLICT(message_id) DO NOTHING;
-- Echo first can be safely enriched by provider acceptance.
INSERT INTO public.whatsapp_messages(message_id,instance,phone,phone_key,from_me,body)
VALUES('test-echo-first','test-instance','5511999998888','1199998888',true,'fictional reply');
SELECT public.save_gravon_accepted_message('test-echo-first','test-instance','5511999998888@s.whatsapp.net','1199998888','fictional reply',now());
UPDATE public.whatsapp_messages SET send_state='delivered',delivered_at=now() WHERE message_id='test-echo-first';
SELECT public.save_gravon_accepted_message('test-echo-first','test-instance','5511999998888@s.whatsapp.net','1199998888','fictional reply',now());
DO $$
BEGIN
  IF (SELECT count(*) FROM public.whatsapp_messages WHERE message_id='test-accepted') <> 1 THEN RAISE EXCEPTION 'Duplicate echo'; END IF;
  IF (SELECT send_state FROM public.whatsapp_messages WHERE message_id='test-echo-first') <> 'delivered' THEN RAISE EXCEPTION 'Delivery regressed'; END IF;
  IF public.save_gravon_accepted_message('test-accepted','wrong-instance','5511999998888@s.whatsapp.net','1199998888','fictional reply',now()) THEN RAISE EXCEPTION 'Conflicting instance allowed'; END IF;
  IF public.save_gravon_accepted_message('test-accepted','test-instance','5521888887777@s.whatsapp.net','2188887777','fictional reply',now()) THEN RAISE EXCEPTION 'Conflicting recipient allowed'; END IF;
  IF has_function_privilege('anon','public.save_gravon_accepted_message(text,text,text,text,text,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous RPC exposed'; END IF;
  IF has_function_privilege('authenticated','public.save_gravon_accepted_message(text,text,text,text,text,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Browser RPC exposed'; END IF;
  IF NOT has_function_privilege('service_role','public.save_gravon_accepted_message(text,text,text,text,text,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Server RPC missing grant'; END IF;
END $$;
INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id) VALUES('inbound','received','test-instance','claim-1');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id) VALUES('inbound','received','test-instance','claim-1');
    RAISE EXCEPTION 'Duplicate claim allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;