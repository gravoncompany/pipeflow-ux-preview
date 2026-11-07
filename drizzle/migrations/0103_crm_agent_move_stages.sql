-- Commercial Agent: separate permission for which stages the AI may move a card to (independent of the
-- stages where it may reply). NULL keeps the previous behaviour (configured stage mapping) until the funnel
-- is saved with an explicit list; an empty list means the AI never moves cards in that funnel.
ALTER TABLE public.crm_agent_settings ADD COLUMN IF NOT EXISTS move_stages text[] CHECK (move_stages IS NULL OR cardinality(move_stages)<=100);
COMMENT ON COLUMN public.crm_agent_settings.move_stages IS 'Stages the agent may move cards to; NULL = legacy stage mapping, empty = never move. Independent of allowed_stages (reply).';

CREATE OR REPLACE FUNCTION public.save_crm_agent_settings(p_actor uuid, p_pipeline uuid, p_revision bigint, p_config jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.crm_agent_settings%ROWTYPE; stages jsonb; ids text[]; v_enabled boolean; v_audience text; v_recipients text[]; v_allowed text[]; v_map jsonb; v_sender text; v_move text[]; v_has_move boolean; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_config)<>'object' THEN RAISE EXCEPTION 'invalid_settings' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-settings:'||coalesce(p_pipeline::text,'main'),0));
 IF p_pipeline IS NOT NULL THEN
  SELECT p.stages INTO stages FROM public.sales_pipelines p WHERE p.id=p_pipeline AND NOT p.archived FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_pipeline' USING ERRCODE='22023'; END IF;
  SELECT array_agg(x->>'id') INTO ids FROM jsonb_array_elements(stages) x;
 END IF;
 v_enabled:=coalesce((p_config->>'enabled')::boolean,false);
 v_audience:=coalesce(p_config->>'audience','test');
 v_sender:=public.crm_phone_digits(coalesce(p_config->>'senderPhone',''));
 v_recipients:=ARRAY(SELECT public.crm_phone_digits(x) FROM unnest(public.crm_agent_text_array(p_config->'recipients',20,40)) x);
 v_allowed:=public.crm_agent_text_array(p_config->'allowedStages',100,80);
 v_map:=coalesce(p_config->'stageMap','{}'::jsonb);
 v_has_move:=p_config ? 'moveStages' AND jsonb_typeof(p_config->'moveStages')='array';
 IF v_has_move THEN v_move:=public.crm_agent_text_array(p_config->'moveStages',100,80); END IF;
 IF jsonb_typeof(v_map)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(v_map) e WHERE e.key NOT IN ('novo','atendimento','qualificado') OR jsonb_typeof(e.value)<>'string') THEN RAISE EXCEPTION 'invalid_settings' USING ERRCODE='22023'; END IF;
 v_map:=(SELECT coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) FROM jsonb_each_text(v_map) e WHERE e.value<>'');
 IF EXISTS(SELECT 1 FROM unnest(v_recipients) x WHERE x !~ '^[1-9][0-9]{9,14}$') OR (v_sender<>'' AND v_sender !~ '^[1-9][0-9]{9,14}$') THEN RAISE EXCEPTION 'invalid_number' USING ERRCODE='22023'; END IF;
 IF ids IS NOT NULL AND (EXISTS(SELECT 1 FROM unnest(v_allowed) x WHERE NOT x=ANY(ids)) OR EXISTS(SELECT 1 FROM jsonb_each_text(v_map) e WHERE NOT e.value=ANY(ids)) OR EXISTS(SELECT 1 FROM unnest(coalesce(v_move,'{}'::text[])) x WHERE NOT x=ANY(ids))) THEN RAISE EXCEPTION 'unknown_stage' USING ERRCODE='22023'; END IF;
 IF v_audience NOT IN ('test','all') THEN RAISE EXCEPTION 'invalid_settings' USING ERRCODE='22023'; END IF;
 IF v_enabled THEN
  IF coalesce(p_config->>'instance','')='' OR v_sender='' OR cardinality(v_allowed)=0 THEN RAISE EXCEPTION 'incomplete_settings' USING ERRCODE='22023'; END IF;
  IF v_audience='test' AND (cardinality(v_recipients)=0 OR EXISTS(SELECT 1 FROM unnest(v_recipients) x WHERE public.crm_same_whatsapp(x,v_sender))) THEN RAISE EXCEPTION 'test_numbers_required' USING ERRCODE='22023'; END IF;
  IF v_audience='all' AND coalesce((p_config->>'confirmAllAudience')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'audience_confirmation_required' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT * INTO s FROM public.crm_agent_settings WHERE pipeline_id IS NOT DISTINCT FROM p_pipeline FOR UPDATE;
 IF NOT FOUND THEN
  IF p_revision<>0 THEN RAISE EXCEPTION 'settings_changed' USING ERRCODE='40001'; END IF;
  INSERT INTO public.crm_agent_settings(pipeline_id) VALUES(p_pipeline) RETURNING * INTO s;
 ELSIF s.revision<>p_revision THEN RAISE EXCEPTION 'settings_changed' USING ERRCODE='40001'; END IF;
 UPDATE public.crm_agent_settings SET enabled=v_enabled, audience=v_audience, instance=coalesce(p_config->>'instance',''), sender_phone=v_sender,
  recipients=v_recipients, allowed_stages=v_allowed, instructions=coalesce(p_config->>'instructions',''),
  served_regions=public.crm_agent_text_array(p_config->'servedRegions',50,120), excluded_regions=public.crm_agent_text_array(p_config->'excludedRegions',50,120),
  services=public.crm_agent_text_array(p_config->'services',50,160), qualification_requirements=coalesce(p_config->>'requirements',''),
  stage_map=v_map, move_stages=CASE WHEN v_has_move THEN v_move ELSE s.move_stages END, auto_move=coalesce((p_config->>'autoMove')::boolean,true), handoff_keywords=public.crm_agent_text_array(p_config->'handoffKeywords',50,80),
  pause_on_human_reply=coalesce((p_config->>'pauseOnHumanReply')::boolean,true), human_pause_hours=coalesce((p_config->>'humanPauseHours')::integer,24),
  business_days=coalesce(ARRAY(SELECT (x)::integer FROM jsonb_array_elements_text(p_config->'businessDays') x),'{1,2,3,4,5}'),
  day_start=coalesce((p_config->>'dayStart')::time,'08:00'), day_end=coalesce((p_config->>'dayEnd')::time,'18:00'),
  max_replies_per_contact_day=coalesce((p_config->>'maxRepliesPerContactDay')::integer,10), max_replies_per_day=coalesce((p_config->>'maxRepliesPerDay')::integer,100),
  max_reply_chars=coalesce((p_config->>'maxReplyChars')::integer,600), max_message_age_minutes=coalesce((p_config->>'maxMessageAgeMinutes')::integer,10),
  blocked_reason=NULL, revision=s.revision+1, updated_by=p_actor, updated_at=now()
 WHERE id=s.id RETURNING * INTO s;
 INSERT INTO public.crm_agent_audit(settings_id,event,actor_id,detail) VALUES(s.id,'configuration',p_actor,
  jsonb_build_object('enabled',s.enabled,'audience',s.audience,'recipients',cardinality(s.recipients),'allowedStages',s.allowed_stages,'moveStages',s.move_stages,'revision',s.revision));
 RETURN to_jsonb(s);
END $$;

CREATE OR REPLACE FUNCTION public.apply_crm_agent_decision(p_run uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_agent_runs%ROWTYPE; s public.crm_agent_settings%ROWTYPE; l public.leads%ROWTYPE; d jsonb; target text; ev text; side text; title text; result text; allowed text[]; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR r.status<>'completed' OR r.decision_result IS NOT NULL THEN RETURN 'skipped'; END IF;
 SELECT * INTO s FROM public.crm_agent_settings WHERE id=r.settings_id;
 d:=coalesce(r.analysis->'decision','{}'::jsonb); target:=d->>'target'; ev:=btrim(coalesce(d->>'evidence','')); side:=d->>'side';
 SELECT coalesce(array_agg(v),'{}') INTO allowed FROM jsonb_each_text(s.stage_map) e(k,v);
 IF r.pipeline_id IS NOT NULL THEN
  SELECT x->>'title' INTO title FROM public.sales_pipelines p CROSS JOIN jsonb_array_elements(p.stages) x WHERE p.id=r.pipeline_id AND NOT p.archived AND x->>'id'=target;
 END IF;
 IF coalesce(d->>'kind','none')<>'move' OR target IS NULL THEN result:='no_change';
 ELSIF NOT s.auto_move THEN result:='suggested';
 ELSIF s.move_stages IS NOT NULL AND NOT (target=ANY(s.move_stages)) THEN result:='not_permitted';
 ELSIF NOT (target=ANY(allowed)) AND (r.pipeline_id IS NULL OR title IS NULL) THEN result:='invalid_target';
 ELSIF r.pipeline_id IS NOT NULL AND title IS NULL THEN result:='invalid_target';
 ELSIF lower(coalesce(title,'')||' '||target) ~ '(fechad|perdid|vendid|ganho|agendad|reuniao|reunião)' THEN result:='suggested';
 ELSIF char_length(ev)<3 OR side NOT IN ('cliente','empresa') OR NOT EXISTS(SELECT 1 FROM public.whatsapp_messages w WHERE w.instance=r.instance AND w.phone_key=r.contact_key
   AND w.from_me=(side='empresa') AND position(lower(ev) IN lower(w.body))>0 AND w.sent_at<=r.accepted_at) THEN result:='invalid_evidence';
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-contact:'||r.contact_key,0));
  SELECT * INTO l FROM public.leads WHERE id=r.lead_id FOR UPDATE;
  IF NOT FOUND OR NOT s.enabled OR s.revision<>r.settings_revision OR l.stage IS DISTINCT FROM r.from_stage OR l.pipeline_id IS DISTINCT FROM r.pipeline_id OR l.gravon_change_revision IS DISTINCT FROM r.lead_revision THEN result:='stale';
  ELSE
   BEGIN
    UPDATE public.leads SET stage=target, history=CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid()::text,'date',now()::text,'kind','ai_move','source','gravon_ai',
      'text','Gravon IA — Agente Comercial moveu o card de '||r.from_stage||' para '||target||'. Motivo: '||left(coalesce(d->>'reason',''),400)||' Evidência: "'||left(ev,300)||'"'))
    WHERE id=l.id;
    result:='moved';
   EXCEPTION WHEN OTHERS THEN result:='blocked';
   END;
  END IF;
 END IF;
 UPDATE public.crm_agent_runs SET decision_result=result, updated_at=now() WHERE id=r.id;
 INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,'stage_decision',
  jsonb_build_object('result',result,'from',r.from_stage,'to',target,'reason',d->>'reason','qualification',r.analysis->'qualification'));
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.save_crm_agent_settings(uuid,uuid,bigint,jsonb), public.apply_crm_agent_decision(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_agent_settings(uuid,uuid,bigint,jsonb), public.apply_crm_agent_decision(uuid) TO service_role;