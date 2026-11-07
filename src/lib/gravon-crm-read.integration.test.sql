-- Execute only on a disposable local database containing synthetic fixtures.
BEGIN;
INSERT INTO public.gravon_ai_test_settings(id,enabled,authorized_phone) VALUES(1,true,'5511999998888') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.leads(id,name,company,whatsapp,stage,entry_date,service,source,next_action) VALUES
 ('00000000-0000-0000-0000-000000000001','Pessoa fictícia','Empresa Exemplo','5511999998888','tentando-contato','2026-10-01','Tráfego','Site','Ligar'),
 ('00000000-0000-0000-0000-000000000002','Pessoa fictícia','Outra Empresa','5511999998887','tentando-contato','2026-10-24','Tráfego','Site','Ligar'),
 ('00000000-0000-0000-0000-000000000003','Pessoa terceira','Empresa Terceira','5521999998888','fechado','2026-09-01','Tráfego','Site','Ligar');

DO $$ BEGIN
 BEGIN PERFORM public.gravon_count_leads('fake','5511999998888','rev-1'); RAISE EXCEPTION 'Default-off failed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.gravon_count_leads(text,text,text,text,date,date)','EXECUTE') OR has_function_privilege('authenticated','public.gravon_lookup_lead(text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Public grant'; END IF;
 IF NOT has_function_privilege('service_role','public.gravon_lookup_lead(text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Service grant missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.gravon_count_leads(text,text,text,text,date,date)'::regprocedure,'public.gravon_lookup_lead(text,text,text,text,text)'::regprocedure) AND p.provolatile<>'s') THEN RAISE EXCEPTION 'Read functions must be STABLE'; END IF;
END $$;
UPDATE public.gravon_ai_test_settings SET enabled=true,authorized_phone='5511999998888',crm_read_enabled=true,crm_read_instance='fake',crm_read_phone='5511999998888',crm_read_revision='rev-1' WHERE id=1;
DO $$ DECLARE r jsonb; before_count bigint; BEGIN
 SELECT count(*) INTO before_count FROM public.leads;
 r:=public.gravon_count_leads('fake','5511999998888','rev-1');
 IF (r->>'total')::int<>3 THEN RAISE EXCEPTION 'Unfiltered default-null count failed'; END IF;
 r:=public.gravon_count_leads('fake','5511999998888','rev-1','tentando-contato','2026-10-01','2026-10-24');
 IF (r->>'total')::int<>2 THEN RAISE EXCEPTION 'Count period failed: %',r; END IF;
 r:=public.gravon_count_leads('fake','5511999998888','rev-1','fechado','2026-10-01','2026-10-24');
 IF (r->>'total')::int<>0 THEN RAISE EXCEPTION 'Zero failed'; END IF;
 r:=public.gravon_lookup_lead('fake','5511999998888','rev-1','name','Pessoa fictícia');
 IF r->>'ambiguous'<>'true' OR jsonb_array_length(r->'leads')<>2 OR (r->'leads'->0) ? 'nextAction' THEN RAISE EXCEPTION 'Ambiguity failed: %',r; END IF;
 r:=public.gravon_lookup_lead('fake','5511999998888','rev-1','phone','551199998888');
 IF r->>'ambiguous'<>'false' OR r->'leads'->0->>'company'<>'Empresa Exemplo' THEN RAISE EXCEPTION 'Phone variant failed: %',r; END IF;
 IF (r->'leads'->0) ?| ARRAY['whatsapp','email','notes','history','revenue','potential_value','owner'] THEN RAISE EXCEPTION 'Private projection'; END IF;
 IF (SELECT count(*) FROM public.leads)<>before_count THEN RAISE EXCEPTION 'Data changed'; END IF;
 BEGIN PERFORM public.gravon_count_leads('wrong','5511999998888','rev-1'); RAISE EXCEPTION 'Instance accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.gravon_count_leads('fake','5521999998888','rev-1'); RAISE EXCEPTION 'Phone accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.gravon_count_leads('fake','5511999998888','rev-2'); RAISE EXCEPTION 'Revision accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
INSERT INTO public.leads(id,name,company) SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Homônimo','Empresa fictícia '||i FROM generate_series(10,16) i;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.gravon_lookup_lead('fake','5511999998888','rev-1','name','Homônimo');
 IF jsonb_array_length(r->'leads')<>5 OR r->>'hasMore'<>'true' THEN RAISE EXCEPTION 'Five result bound failed'; END IF;
END $$;
UPDATE public.gravon_ai_test_settings SET crm_read_enabled=false WHERE id=1;
DO $$ BEGIN
 BEGIN PERFORM public.gravon_lookup_lead('fake','5511999998888','rev-1','name','Pessoa fictícia'); RAISE EXCEPTION 'Revocation failed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;