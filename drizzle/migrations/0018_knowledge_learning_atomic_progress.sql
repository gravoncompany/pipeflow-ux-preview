CREATE OR REPLACE FUNCTION public.start_ai_learning() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_own text;
BEGIN
 PERFORM pg_advisory_xact_lock(7351932);
 SELECT id INTO v_id FROM ai_learning_runs WHERE status='running' LIMIT 1;
 IF v_id IS NOT NULL THEN RETURN v_id; END IF;
 SELECT split_part(regexp_replace(authorized_phone, '\D', '', 'g'),'@',1) INTO v_own FROM gravon_ai_test_settings WHERE id=1;
 IF length(v_own)>=12 AND left(v_own,2)='55' THEN v_own:=substring(v_own FROM 3); END IF;
 v_own:=CASE WHEN length(v_own)>=10 THEN left(v_own,2)||right(v_own,8) ELSE right(v_own,8) END;
 INSERT INTO ai_learning_runs DEFAULT VALUES RETURNING id INTO v_id;
 INSERT INTO ai_learning_items(run_id,conversation_key,chunk,messages)
 SELECT v_id,phone_key,chunk,jsonb_agg(jsonb_build_object('message_id',piece_id,'body',piece_body,'from_me',from_me,'sent_at',sent_at,'media_type',media_type) ORDER BY sent_at,message_id,part)
 FROM (SELECT *,((row_number() OVER(PARTITION BY phone_key ORDER BY sent_at,message_id,part)-1)/50)::integer chunk
 FROM (SELECT m.*,p.part,CASE WHEN length(body)>1600 THEN message_id||':part:'||p.part ELSE message_id END piece_id,substring(body FROM (p.part-1)*1600+1 FOR 1600) piece_body
 FROM whatsapp_messages m CROSS JOIN LATERAL generate_series(1,greatest(1,ceil(length(body)/1600.0)::integer)) p(part)
 WHERE phone_key IS DISTINCT FROM v_own AND phone NOT LIKE '%@g.us%' AND body NOT LIKE '🤖%' AND body NOT LIKE 'GRAVON AI%') pieces) batches
 GROUP BY phone_key,chunk;
 UPDATE ai_learning_runs SET conversation_count=(SELECT count(DISTINCT conversation_key) FROM ai_learning_items WHERE run_id=v_id),message_count=(SELECT count(*) FROM whatsapp_messages WHERE phone_key IS DISTINCT FROM v_own AND phone NOT LIKE '%@g.us%' AND body NOT LIKE '🤖%' AND body NOT LIKE 'GRAVON AI%') WHERE id=v_id;
 RETURN v_id;
END $$;
CREATE FUNCTION public.commit_ai_learning(p_run uuid,p_token uuid,p_item bigint DEFAULT NULL,p_result jsonb DEFAULT NULL,p_insights jsonb DEFAULT NULL,p_offset integer DEFAULT NULL,p_publish boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_run ai_learning_runs; v_generation integer;
BEGIN
 SELECT * INTO v_run FROM ai_learning_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR v_run.status<>'running' OR v_run.lease_token IS DISTINCT FROM p_token OR v_run.lease_until<=now() THEN RETURN false; END IF;
 IF p_item IS NOT NULL THEN UPDATE ai_learning_items SET result=p_result WHERE id=p_item AND run_id=p_run AND result IS NULL; END IF;
 IF p_insights IS NOT NULL THEN UPDATE ai_learning_runs SET insights=p_insights,insight_offset=p_offset,phase='synthesis' WHERE id=p_run; END IF;
 IF p_publish THEN
  IF EXISTS(SELECT 1 FROM ai_learning_items WHERE run_id=p_run AND result IS NULL) THEN RAISE EXCEPTION 'unfinished'; END IF;
  IF coalesce(jsonb_array_length(v_run.insights),0)=0 THEN RAISE EXCEPTION 'empty knowledge'; END IF;
  SELECT coalesce(max(generation),0)+1 INTO v_generation FROM ai_knowledge;
  INSERT INTO ai_knowledge(generation,kind,text,sources) SELECT v_generation,i->>'kind',i->>'text',v_run.conversation_count FROM jsonb_array_elements(v_run.insights) i;
  UPDATE ai_learning_runs SET status='completed' WHERE id=p_run;
 END IF;
 UPDATE ai_learning_runs SET lease_token=NULL,lease_until=NULL WHERE id=p_run;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.commit_ai_learning(uuid,uuid,bigint,jsonb,jsonb,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ai_learning(uuid,uuid,bigint,jsonb,jsonb,integer,boolean) TO service_role;