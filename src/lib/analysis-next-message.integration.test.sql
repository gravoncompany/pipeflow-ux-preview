-- Disposable local database only, with 0031/0032/0033 and stub account tables.
INSERT INTO public.portal_admin_channels(user_id,instance,company_key) VALUES ('00000000-0000-4000-8000-000000000001','test-instance','crm:1');
INSERT INTO public.analysis_message_drafts(id,company_key,author_id,instance,phone,phone_key,recipient_name,anchor_id,anchor_from_me,remote_jid,analysis_result,analyzed_at,db_snapshot,provider_snapshot,lead_snapshot,suggestion)
VALUES ('00000000-0000-4000-8000-000000000002','crm:1','00000000-0000-4000-8000-000000000001','test-instance','5511999998888','1199998888','Fictício','anchor',false,'5511999998888@s.whatsapp.net','{}',now(),'[]','version-1','{}','rascunho');
DO $$ DECLARE r jsonb; BEGIN
 r:=public.claim_analysis_message('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',E'  texto revisado\nexato  ');
 IF (r->>'claimed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Claim failed'; END IF;
 IF (SELECT approved_text FROM public.analysis_message_drafts WHERE id='00000000-0000-4000-8000-000000000002') IS DISTINCT FROM E'  texto revisado\nexato  ' THEN RAISE EXCEPTION 'Text rewritten'; END IF;
 r:=public.claim_analysis_message('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',E'  texto revisado\nexato  ');
 IF (r->>'claimed')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'Duplicate claim'; END IF;
 BEGIN
  PERFORM public.claim_analysis_message('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','changed');
  RAISE EXCEPTION 'Changed approval accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Changed approval accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.claim_analysis_message('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000099','x');
  RAISE EXCEPTION 'Different actor accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('authenticated','public.claim_analysis_message(uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Browser claim exposed'; END IF;
 IF has_table_privilege('anon','public.analysis_message_drafts','SELECT') THEN RAISE EXCEPTION 'Anonymous draft read exposed'; END IF;
END $$;
-- Receipt before accepted persistence is retained, replay-safe and never cross-instance.
INSERT INTO public.analysis_delivery_receipts(instance,message_id,remote_jid,state,received_at) VALUES('test-instance','early-receipt','5511999998888@s.whatsapp.net','READ','2026-10-27T10:00:00Z');
SELECT public.reconcile_analysis_delivery('test-instance','early-receipt');
INSERT INTO public.whatsapp_messages(message_id,instance,phone,phone_key,from_me,body,send_state) VALUES('early-receipt','test-instance','5511999998888','1199998888',true,'Fictício','accepted');
SELECT public.reconcile_analysis_delivery('wrong-instance','early-receipt');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE message_id='early-receipt' AND read_at IS NOT NULL) THEN RAISE EXCEPTION 'Cross-instance receipt'; END IF; END $$;
SELECT public.reconcile_analysis_delivery('test-instance','early-receipt');
INSERT INTO public.analysis_delivery_receipts(instance,message_id,remote_jid,state,received_at) VALUES('test-instance','early-receipt','5511999998888@s.whatsapp.net','DELIVERY_ACK','2026-10-27T09:00:00Z');
SELECT public.reconcile_analysis_delivery('test-instance','early-receipt');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE message_id='early-receipt' AND read_at='2026-10-27T10:00:00Z' AND send_state='read') THEN RAISE EXCEPTION 'Read missing or regressed'; END IF;
 IF has_table_privilege('anon','public.analysis_delivery_receipts','SELECT') OR has_function_privilege('authenticated','public.reconcile_analysis_delivery(text,text)','EXECUTE') THEN RAISE EXCEPTION 'Private receipts exposed'; END IF;
END $$;
INSERT INTO public.analysis_message_drafts(id,company_key,author_id,instance,phone,phone_key,recipient_name,anchor_id,anchor_from_me,remote_jid,analysis_result,analyzed_at,db_snapshot,provider_snapshot,lead_snapshot,suggestion)
SELECT '00000000-0000-4000-8000-000000000003',company_key,author_id,instance,phone,phone_key,recipient_name,anchor_id,anchor_from_me,remote_jid,analysis_result,analyzed_at,db_snapshot,provider_snapshot,lead_snapshot,suggestion FROM public.analysis_message_drafts WHERE id='00000000-0000-4000-8000-000000000002';
DO $$ BEGIN
 BEGIN
  PERFORM public.claim_analysis_message('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','x');
  RAISE EXCEPTION 'Unresolved second send accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unresolved second send accepted' THEN RAISE; END IF; END;
END $$;
UPDATE public.analysis_message_drafts SET status='failed' WHERE id='00000000-0000-4000-8000-000000000002';
INSERT INTO public.whatsapp_messages(message_id,instance,phone,phone_key,body) VALUES('new-inbound','test-instance','5511999998888','1199998888','Nova mensagem');
DO $$ DECLARE r jsonb; BEGIN
 r:=public.claim_analysis_message('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','x');
 IF r->>'status'<>'stale' OR (r->>'claimed')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'Changed conversation sent'; END IF;
END $$;