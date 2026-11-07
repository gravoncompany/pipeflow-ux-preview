-- Run only in a disposable database with synthetic fixtures, never production.
BEGIN;
INSERT INTO public.gravon_ai_test_settings(id,enabled,authorized_phone,crm_read_enabled,crm_read_instance,crm_read_phone,crm_read_revision)
VALUES(1,true,'5511999998888',true,'fake','5511999998888','r');
INSERT INTO public.leads(id,name,company,stage,entry_date,potential_value) VALUES
('00000000-0000-0000-0000-000000000001','Fechado fictício','Exemplo','fechado','2026-10-01',3000),
('00000000-0000-0000-0000-000000000002','Fechado sem valor','Exemplo 2','fechado','2026-10-31',0),
('00000000-0000-0000-0000-000000000003','Perda fictícia','Exemplo 3','perda','2026-10-15',5000),
('00000000-0000-0000-0000-000000000004','Fora período','Exemplo 4','fechado','2026-09-30',7000),
('00000000-0000-0000-0000-000000000005','Homônimo fictício','Exemplo 5','fechado','2026-10-15',100),
('00000000-0000-0000-0000-000000000006','Homônimo fictício','Exemplo 6','lead-novo','2026-10-15',999);
DO $$ BEGIN
 BEGIN PERFORM public.gravon_sales_summary('fake','5511999998888','r','f','2026-10-01','2026-10-31'); RAISE EXCEPTION 'Default financial grant was enabled'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.gravon_sales_summary(text,text,text,text,date,date)','EXECUTE') OR has_function_privilege('authenticated','public.gravon_closed_value(text,text,text,text,text,text)','EXECUTE') OR has_function_privilege('anon','public.gravon_require_finance_grant(text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Public financial access'; END IF;
 IF NOT has_function_privilege('service_role','public.gravon_sales_summary(text,text,text,text,date,date)','EXECUTE') THEN RAISE EXCEPTION 'Missing service grant'; END IF;
END $$;
UPDATE public.gravon_ai_test_settings SET crm_finance_enabled=true,crm_finance_instance='fake',crm_finance_phone='5511999998888',crm_finance_revision='f',crm_finance_read_revision='r',crm_finance_authorized_phone=authorized_phone;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.gravon_sales_summary('fake','5511999998888','r','f','2026-10-01','2026-10-31');
 IF r<>jsonb_build_object('count',3,'potentialValue',3100,'missing',1) THEN RAISE EXCEPTION 'Sales mismatch %',r; END IF;
 r:=public.gravon_sales_summary('fake','5511999998888','r','f','2027-01-01','2027-01-31');
 IF r<>jsonb_build_object('count',0,'potentialValue',0,'missing',0) THEN RAISE EXCEPTION 'Empty mismatch %',r; END IF;
 r:=public.gravon_closed_value('fake','5511999998888','r','f','name','Fechado fictício');
 IF r->'leads'->0->>'potentialValue'<>'3000' OR r->'leads'->0->>'closed'<>'true' THEN RAISE EXCEPTION 'Value mismatch %',r; END IF;
 r:=public.gravon_closed_value('fake','5511999998888','r','f','name','Fechado sem valor');
 IF r->'leads'->0->'potentialValue'<>'null'::jsonb THEN RAISE EXCEPTION 'Missing is not null'; END IF;
 r:=public.gravon_closed_value('fake','5511999998888','r','f','name','Homônimo fictício');
 IF r->>'ambiguous'<>'true' OR jsonb_array_length(r->'leads')<>2 OR (r->'leads'->0)?'potentialValue' THEN RAISE EXCEPTION 'Homonym values leaked'; END IF;
 r:=public.gravon_closed_value('fake','5511999998888','r','f','name','Perda fictícia');
 IF r->'leads'->0->>'closed'<>'false' OR r->'leads'->0->'potentialValue'<>'null'::jsonb THEN RAISE EXCEPTION 'Nonclosed value leaked'; END IF;
 BEGIN PERFORM public.gravon_sales_summary('wrong','5511999998888','r','f','2026-10-01','2026-10-31'); RAISE EXCEPTION 'Wrong instance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.gravon_sales_summary('fake','5521999998888','r','f','2026-10-01','2026-10-31'); RAISE EXCEPTION 'Wrong phone'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.gravon_sales_summary('fake','5511999998888','r','new','2026-10-01','2026-10-31'); RAISE EXCEPTION 'Wrong revision'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM public.leads)<>6 THEN RAISE EXCEPTION 'Leads changed'; END IF;
END $$;
UPDATE public.gravon_ai_test_settings SET crm_read_revision='new';
DO $$ BEGIN
 BEGIN PERFORM public.gravon_require_finance_grant('fake','5511999998888','new','f'); RAISE EXCEPTION 'Read revision renewal failed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE public.gravon_ai_test_settings SET crm_read_revision='r',crm_finance_enabled=false;
DO $$ BEGIN
 BEGIN PERFORM public.gravon_require_finance_grant('fake','5511999998888','r','f'); RAISE EXCEPTION 'Revocation failed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;