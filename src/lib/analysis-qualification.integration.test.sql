-- Synthetic fixtures; disposable local PostgreSQL only.
BEGIN;
INSERT INTO public.leads(id,name,stage,tags,history,notes) VALUES('00000000-0000-0000-0000-000000000001','Fictício','lead-novo','["quente"]','[]','Nota anterior');
INSERT INTO public.whatsapp_messages(message_id,phone_key,body,from_me,sent_at) VALUES('evidence','1199998888','Quero contratar tráfego pago',false,now());
INSERT INTO public.whatsapp_analyses(id,phone_key,scope_start,scope_end,fingerprint,result,analyzed_at) VALUES('00000000-0000-0000-0000-000000000002','1199998888','','','fake','{"qualification":"qualified","interestEvidence":[{"messageId":"evidence","quote":"Quero contratar tráfego pago"}]}',now());
DO $$ DECLARE a uuid; r jsonb; scenario text; BEGIN
 IF has_function_privilege('anon','public.resolve_analysis_qualification(uuid,boolean)','EXECUTE') OR has_table_privilege('anon','public.analysis_qualification_actions','SELECT') THEN RAISE EXCEPTION 'Anonymous access'; END IF;
 FOREACH scenario IN ARRAY ARRAY['cancel','stale','evidence','confirm'] LOOP
  INSERT INTO public.analysis_qualification_actions(analysis_id,fingerprint,analyzed_at,lead_id,expected_revision,target_stage,target_title,tag_id,tag_label)
  SELECT '00000000-0000-0000-0000-000000000002','fake',now(),id,gravon_change_revision,'qualificacao','Qualificação','qualificado-'||scenario,'Qualificado' FROM public.leads RETURNING id INTO a;
  IF (SELECT stage FROM public.leads)<>'lead-novo' THEN RAISE EXCEPTION 'Automatic movement'; END IF;
  IF scenario='stale' THEN UPDATE public.leads SET gravon_change_revision=gravon_change_revision+1; END IF;
  IF scenario='evidence' THEN UPDATE public.whatsapp_messages SET from_me=true; END IF;
  r:=public.resolve_analysis_qualification_with_notes(a,scenario='cancel','Interesse em tráfego pago');
  IF r->>'status'<>(CASE WHEN scenario='cancel' THEN 'cancelled' WHEN scenario IN ('stale','evidence') THEN 'stale' ELSE 'confirmed' END) THEN RAISE EXCEPTION 'Scenario failed %: %',scenario,r; END IF;
  IF scenario='evidence' THEN UPDATE public.whatsapp_messages SET from_me=false; END IF;
  IF scenario<>'confirm' AND ((SELECT stage FROM public.leads)<>'lead-novo' OR (SELECT tags FROM public.leads)<>'["quente"]'::jsonb) THEN RAISE EXCEPTION 'Blocked action changed lead'; END IF;
  IF scenario<>'confirm' AND (SELECT notes FROM public.leads)<>'Nota anterior' THEN RAISE EXCEPTION 'Unconfirmed notes saved'; END IF;
 END LOOP;
 PERFORM public.resolve_analysis_qualification_with_notes(a,false,'Texto repetido não deve entrar');
 IF (SELECT notes FROM public.leads)<>E'Nota anterior\n\nAnálise da conversa — principais pontos:\nInteresse em tráfego pago' THEN RAISE EXCEPTION 'Notes erased or replay appended twice'; END IF;
 IF (SELECT stage FROM public.leads)<>'qualificacao' OR (SELECT tags FROM public.leads)<>'["quente","qualificado-confirm"]'::jsonb OR (SELECT jsonb_array_length(history) FROM public.leads)<>2 THEN RAISE EXCEPTION 'Confirmation/replay not atomic'; END IF;
 BEGIN UPDATE public.leads SET history='[]'; RAISE EXCEPTION 'Audit erased'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
ROLLBACK;