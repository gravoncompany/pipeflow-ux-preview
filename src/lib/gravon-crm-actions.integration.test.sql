-- Synthetic fixtures only: execute in a disposable PostgreSQL database.
BEGIN;
INSERT INTO public.gravon_ai_test_settings(id,enabled,authorized_phone,crm_read_enabled,crm_read_instance,crm_read_phone,crm_read_revision,crm_move_enabled,crm_move_instance,crm_move_phone,crm_move_revision,crm_move_authorized_phone)
 VALUES(1,true,'5511999998888',true,'fake','5511999998888','r',false,'fake','5511999998888','m','5511999998888');
INSERT INTO public.leads(id,name,company,stage,notes,history) VALUES
 ('00000000-0000-0000-0000-000000000001','Pessoa fictícia','Empresa fictícia','lead-novo','Preservar', '[{"id":"old","date":"2026-10-24","text":"Anterior"}]'),
 ('00000000-0000-0000-0000-000000000002','Homônimo','Empresa A','lead-novo','', '[]'),
 ('00000000-0000-0000-0000-000000000003','Homônimo','Empresa B','lead-novo','', '[]');
INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','request-1','Mover Empresa fictícia para Contato realizado');
DO $$ BEGIN
 IF has_function_privilege('anon','public.gravon_resolve_stage_move(text,text,text,text,text,text,boolean)','EXECUTE') OR has_function_privilege('authenticated','public.gravon_propose_stage_move(text,text,text,text,text,text,text,text)','EXECUTE') OR has_table_privilege('anon','public.gravon_lead_stage_actions','SELECT') THEN RAISE EXCEPTION 'Public access'; END IF;
 BEGIN PERFORM public.gravon_propose_stage_move('fake','5511999998888','r','m','request-1','company','Empresa fictícia','contato-realizado'); RAISE EXCEPTION 'Default off failed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE public.gravon_ai_test_settings SET crm_move_enabled=true WHERE id=1;
DO $$ DECLARE a jsonb; b jsonb; c text; h jsonb; BEGIN
 a:=public.gravon_propose_stage_move('fake','5511999998888','r','m','request-1','company','Empresa fictícia','contato-realizado');
 c:=a->>'code';
 IF a->>'status'<>'pending' OR (SELECT stage FROM public.leads WHERE id='00000000-0000-0000-0000-000000000001')<>'lead-novo' THEN RAISE EXCEPTION 'Proposal changed lead'; END IF;
 b:=public.gravon_propose_stage_move('fake','5511999998888','r','m','request-1','company','Empresa fictícia','contato-realizado');
 IF b->>'code'<>c THEN RAISE EXCEPTION 'Proposal replay failed'; END IF;
 BEGIN PERFORM public.gravon_resolve_stage_move('fake','5511999998888','r','m','request-1',c,false); RAISE EXCEPTION 'No explicit confirm accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='No explicit confirm accepted' THEN RAISE; END IF; END;
 INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','confirm-1','CONFIRMAR '||c);
 b:=public.gravon_resolve_stage_move('fake','5511999998888','r','m','confirm-1',c,false);
 IF b->>'status'<>'moved' THEN RAISE EXCEPTION 'Move failed'; END IF;
 SELECT history INTO h FROM public.leads WHERE id='00000000-0000-0000-0000-000000000001';
 IF jsonb_array_length(h)<>2 OR h->1->>'id'<>'old' OR (SELECT notes FROM public.leads WHERE id='00000000-0000-0000-0000-000000000001')<>'Preservar' THEN RAISE EXCEPTION 'History/fields lost'; END IF;
 b:=public.gravon_resolve_stage_move('fake','5511999998888','r','m','confirm-1',c,false);
 IF b->>'status'<>'moved' OR (SELECT jsonb_array_length(history) FROM public.leads WHERE id='00000000-0000-0000-0000-000000000001')<>2 THEN RAISE EXCEPTION 'Replay duplicated'; END IF;
 BEGIN
  UPDATE public.leads SET stage='lead-novo',history='[{"id":"old","date":"2026-10-24","text":"Anterior"}]'::jsonb WHERE id='00000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'Stale editor overwrote move';
 EXCEPTION WHEN serialization_failure THEN NULL;
 END;
 INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','homonym','Mover Homônimo');
 b:=public.gravon_propose_stage_move('fake','5511999998888','r','m','homonym','name','Homônimo','fechado');
 IF b->>'status'<>'identify' THEN RAISE EXCEPTION 'Ambiguity accepted'; END IF;
END $$;
DO $$ DECLARE r jsonb; c text; scenario text; BEGIN
 FOREACH scenario IN ARRAY ARRAY['expired','cancelled','stale','revoked','wrong-code'] LOOP
  INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','req-'||scenario,'Mover Empresa fictícia');
  r:=public.gravon_propose_stage_move('fake','5511999998888','r','m','req-'||scenario,'company','Empresa fictícia','fechado'); c:=r->>'code';
  INSERT INTO public.gravon_ai_test_log(event,status,instance,inbound_id,body) VALUES('inbound','received','fake','confirm-'||scenario,CASE WHEN scenario='cancelled' THEN 'CANCELAR ' ELSE 'CONFIRMAR ' END||CASE WHEN scenario='wrong-code' THEN repeat('F',32) ELSE c END);
  IF scenario='expired' THEN UPDATE public.gravon_lead_stage_actions SET expires_at=clock_timestamp()-interval '1 minute' WHERE code=c; END IF;
  IF scenario='stale' THEN UPDATE public.leads SET notes='Alteração concorrente fictícia' WHERE id='00000000-0000-0000-0000-000000000001'; END IF;
  IF scenario='revoked' THEN
   UPDATE public.gravon_ai_test_settings SET crm_move_enabled=false WHERE id=1;
   BEGIN PERFORM public.gravon_resolve_stage_move('fake','5511999998888','r','m','confirm-'||scenario,c,false); RAISE EXCEPTION 'Revocation failed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   UPDATE public.gravon_ai_test_settings SET crm_move_enabled=true WHERE id=1;
  ELSE
   r:=public.gravon_resolve_stage_move('fake','5511999998888','r','m','confirm-'||scenario,CASE WHEN scenario='wrong-code' THEN repeat('F',32) ELSE c END,scenario='cancelled');
   IF r->>'status'<>(CASE WHEN scenario='wrong-code' THEN 'invalid' ELSE scenario END) THEN RAISE EXCEPTION 'Scenario % failed: %',scenario,r; END IF;
  END IF;
  IF (SELECT stage FROM public.leads WHERE id='00000000-0000-0000-0000-000000000001')<>'contato-realizado' THEN RAISE EXCEPTION 'Blocked action changed stage'; END IF;
 END LOOP;
END $$;
ROLLBACK;