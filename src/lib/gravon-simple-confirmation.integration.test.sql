-- Synthetic fixtures only; run on a disposable local PostgreSQL database.
BEGIN;
INSERT INTO public.gravon_ai_test_settings(id,enabled,authorized_phone,crm_read_enabled,crm_read_instance,crm_read_phone,crm_read_revision,crm_move_enabled,crm_move_instance,crm_move_phone,crm_move_revision,crm_move_authorized_phone)
VALUES(1,true,'5511999998888',true,'fake','5511999998888','r',true,'fake','5511999998888','m','5511999998888');
INSERT INTO public.leads(id,name,company,stage,history) VALUES('00000000-0000-0000-0000-000000000001','Pessoa fictícia','Empresa fictícia','lead-novo','[]');
DO $$ DECLARE result jsonb; scenario text; BEGIN
 IF has_table_privilege('anon','public.gravon_move_confirmations','SELECT') THEN RAISE EXCEPTION 'Public confirmation storage'; END IF;
 INSERT INTO public.gravon_ai_test_log(event,instance,inbound_id,body) VALUES('inbound','fake','empty','Confirmar');
 result:=public.gravon_resolve_stage_move('fake','5511999998888','r','m','empty','',false);
 IF result->>'status'<>'no_pending' THEN RAISE EXCEPTION 'Empty selected action'; END IF;
 INSERT INTO public.gravon_ai_test_log(event,instance,inbound_id,body) VALUES('inbound','fake','proposal','Mover Empresa fictícia');
 PERFORM public.gravon_propose_stage_move('fake','5511999998888','r','m','proposal','company','Empresa fictícia','qualificacao');
 result:=public.gravon_resolve_stage_move('fake','5511999998888','r','m','empty','',false);
 IF result->>'status'<>'no_pending' THEN RAISE EXCEPTION 'Replay selected new proposal'; END IF;
 INSERT INTO public.gravon_ai_test_log(event,instance,inbound_id,body) VALUES('inbound','fake','confirm','Confirmar');
 result:=public.gravon_resolve_stage_move('fake','5511999998888','r','m','confirm','',false);
 IF result->>'status'<>'moved' OR (SELECT stage FROM public.leads LIMIT 1)<>'qualificacao' THEN RAISE EXCEPTION 'Bare confirm failed'; END IF;
 PERFORM public.gravon_resolve_stage_move('fake','5511999998888','r','m','confirm','',false);
 IF (SELECT jsonb_array_length(history) FROM public.leads LIMIT 1)<>1 THEN RAISE EXCEPTION 'Repeated move'; END IF;
 FOREACH scenario IN ARRAY ARRAY['cancel','stale','expired','revoked'] LOOP
  INSERT INTO public.gravon_ai_test_log(event,instance,inbound_id,body) VALUES('inbound','fake','p-'||scenario,'Mover Empresa fictícia');
  PERFORM public.gravon_propose_stage_move('fake','5511999998888','r','m','p-'||scenario,'company','Empresa fictícia','fechado');
  IF scenario='stale' THEN UPDATE public.leads SET notes='Editado'; END IF;
  IF scenario='expired' THEN UPDATE public.gravon_lead_stage_actions SET expires_at=clock_timestamp()-interval '1 second' WHERE inbound_id='p-'||scenario; END IF;
  INSERT INTO public.gravon_ai_test_log(event,instance,inbound_id,body) VALUES('inbound','fake','c-'||scenario,CASE WHEN scenario='cancel' THEN 'Cancelar' ELSE 'Confirmar' END);
  IF scenario='revoked' THEN
   UPDATE public.gravon_ai_test_settings SET crm_move_enabled=false;
   BEGIN PERFORM public.gravon_resolve_stage_move('fake','5511999998888','r','m','c-'||scenario,'',false); RAISE EXCEPTION 'Revocation bypassed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   UPDATE public.gravon_ai_test_settings SET crm_move_enabled=true;
  ELSE
   result:=public.gravon_resolve_stage_move('fake','5511999998888','r','m','c-'||scenario,'',scenario='cancel');
   IF result->>'status'<>(CASE scenario WHEN 'cancel' THEN 'cancelled' WHEN 'expired' THEN 'no_pending' ELSE scenario END) THEN RAISE EXCEPTION 'Scenario % failed: %',scenario,result; END IF;
  END IF;
  IF (SELECT stage FROM public.leads LIMIT 1)<>'qualificacao' THEN RAISE EXCEPTION 'Blocked move applied'; END IF;
 END LOOP;
 -- Two valid proposals must never be silently selected by either command.
 INSERT INTO public.gravon_ai_test_log(event,instance,inbound_id,body) VALUES('inbound','fake','second','Mover Empresa fictícia');
 PERFORM public.gravon_propose_stage_move('fake','5511999998888','r','m','second','company','Empresa fictícia','mql');
 FOREACH scenario IN ARRAY ARRAY['Confirmar','Cancelar'] LOOP
  INSERT INTO public.gravon_ai_test_log(event,instance,inbound_id,body) VALUES('inbound','fake','amb-'||scenario,scenario);
  result:=public.gravon_resolve_stage_move('fake','5511999998888','r','m','amb-'||scenario,'',scenario='Cancelar');
  IF result->>'status'<>'ambiguous_pending' THEN RAISE EXCEPTION 'Ambiguity accepted'; END IF;
 END LOOP;
 IF (SELECT stage FROM public.leads LIMIT 1)<>'qualificacao' THEN RAISE EXCEPTION 'Ambiguous move applied'; END IF;
END $$;
ROLLBACK;