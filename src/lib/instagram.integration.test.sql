-- Run in a disposable database loaded with 0036, never in the live CRM.
INSERT INTO public.instagram_accounts(id,company_key,instagram_id,username,token_secret_name,app_secret_name,greeting_enabled,greeting,updated_by)
VALUES ('00000000-0000-4000-8000-000000000001','test:a','111','test_only','TEST_TOKEN_A','TEST_APP',true,'Saudação de teste','00000000-0000-4000-8000-000000000099'),
('00000000-0000-4000-8000-000000000002','test:b','112','test_only_b','TEST_TOKEN_B','TEST_APP',true,'Outra saudação','00000000-0000-4000-8000-000000000098');
DO $$ DECLARE r jsonb; c uuid; BEGIN
 r:=public.ingest_instagram_message('00000000-0000-4000-8000-000000000001','222','test-mid','Olá','text',now(),true,now());
 IF r->>'greet'<>'true' THEN RAISE EXCEPTION 'First greeting not claimed'; END IF; c:=(r->>'contact_id')::uuid;
 r:=public.ingest_instagram_message('00000000-0000-4000-8000-000000000001','222','test-mid','Olá','text',now(),true,now());
 IF r->>'duplicate'<>'true' OR r ? 'greet' THEN RAISE EXCEPTION 'Duplicate reprocessed'; END IF;
 r:=public.ingest_instagram_message('00000000-0000-4000-8000-000000000001','222','test-mid-2','Olá de novo','text',now(),true,now());
 IF r->>'greet'<>'false' THEN RAISE EXCEPTION 'Second greeting claimed'; END IF;
 PERFORM public.finish_instagram_greeting('00000000-0000-4000-8000-000000000001',c,'accepted','test-send-mid',now());
 PERFORM public.finish_instagram_greeting('00000000-0000-4000-8000-000000000001',c,'accepted','test-send-mid',now());
 IF (SELECT count(*) FROM public.instagram_messages WHERE message_id='test-send-mid')<>1 THEN RAISE EXCEPTION 'Accepted message duplicated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.instagram_contacts WHERE id=c AND greeting_state='accepted' AND greeting_provider_id='test-send-mid') THEN RAISE EXCEPTION 'Receipt not stored'; END IF;
 r:=public.ingest_instagram_message('00000000-0000-4000-8000-000000000002','222','test-mid','Outra empresa','text',now(),true,now());
 IF r->>'greet'<>'true' OR (r->>'contact_id')::uuid=c THEN RAISE EXCEPTION 'Companies conflated'; END IF;
 IF (SELECT count(*) FROM public.instagram_contacts WHERE sender_id='222')<>2 THEN RAISE EXCEPTION 'Company contacts not isolated'; END IF;
 r:=public.ingest_instagram_message('00000000-0000-4000-8000-000000000001','111','own-mid','Own','text',now(),true,now());
 IF r->>'ignored'<>'true' THEN RAISE EXCEPTION 'Own number accepted'; END IF;
 r:=public.ingest_instagram_message('00000000-0000-4000-8000-000000000001','333','old-mid','Old','text',now()-interval '25 hours',true,now());
 IF r->>'greet'<>'false' THEN RAISE EXCEPTION 'Old event greeted'; END IF;
 r:=public.ingest_instagram_message('00000000-0000-4000-8000-000000000001','444','echo-mid','Echo','text',now(),false,now());
 IF r->>'ignored'<>'true' THEN RAISE EXCEPTION 'Echo creates contact'; END IF;
 r:=public.ingest_instagram_message('00000000-0000-4000-8000-000000000001','555','unknown-mid','Hello','text',now(),true,now()); c:=(r->>'contact_id')::uuid;
 PERFORM public.finish_instagram_greeting('00000000-0000-4000-8000-000000000001',c,'unknown','',now());
 r:=public.ingest_instagram_message('00000000-0000-4000-8000-000000000001','555','unknown-mid-2','Again','text',now(),true,now());
 IF r->>'greet'<>'false' OR (SELECT greeting_state FROM public.instagram_contacts WHERE id=c)<>'unknown' THEN RAISE EXCEPTION 'Unknown send retried'; END IF;
 BEGIN
  INSERT INTO public.instagram_messages(company_key,account_id,contact_id,message_id,from_me,kind,sent_at) VALUES('test:b','00000000-0000-4000-8000-000000000001',c,'cross-company',false,'text',now());
  RAISE EXCEPTION 'Cross-company message accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 IF has_table_privilege('anon','public.instagram_accounts','SELECT') OR has_table_privilege('authenticated','public.instagram_contacts','INSERT') OR has_function_privilege('authenticated','public.ingest_instagram_message(uuid,text,text,text,text,timestamptz,boolean,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Private access exposed'; END IF;
END $$;