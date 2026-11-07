CREATE OR REPLACE FUNCTION public.claim_analysis_message(p_id uuid,p_author uuid,p_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.analysis_message_drafts; BEGIN
 SELECT * INTO d FROM public.analysis_message_drafts WHERE id=p_id AND author_id=p_author;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(d.company_key||':'||d.instance||':'||d.phone_key,0));
 SELECT * INTO d FROM public.analysis_message_drafts WHERE id=p_id FOR UPDATE;
 IF NOT public.commercial_knowledge_access(p_author,d.company_key) OR NOT EXISTS(SELECT 1 FROM public.portal_admin_channels c WHERE c.user_id=p_author AND c.instance=d.instance AND c.company_key=d.company_key) OR d.company_key <> 'crm:1' THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF d.status <> 'pending' THEN
  IF d.approved_text IS NOT NULL AND d.approved_text IS DISTINCT FROM p_text THEN RAISE EXCEPTION 'Approved content differs'; END IF;
  RETURN jsonb_build_object('claimed',false,'status',d.status);
 END IF;
 IF char_length(btrim(p_text))=0 OR char_length(p_text)>4000 THEN RAISE EXCEPTION 'Invalid text'; END IF;
 IF EXISTS(SELECT 1 FROM public.analysis_message_drafts x WHERE x.id<>d.id AND x.company_key=d.company_key AND x.instance=d.instance AND x.phone_key=d.phone_key AND (x.status IN ('sending','unknown') OR (x.status='accepted' AND (x.synced_at IS NULL OR x.provider_snapshot=d.provider_snapshot)))) THEN RAISE EXCEPTION 'Unresolved or already accepted send'; END IF;
 IF d.db_snapshot IS DISTINCT FROM public.analysis_contact_snapshot(d.instance,d.phone_key) THEN
  UPDATE public.analysis_message_drafts SET status='stale',error='A conversa mudou. Atualize a sugestão e revise novamente.' WHERE id=d.id;
  RETURN jsonb_build_object('claimed',false,'status','stale');
 END IF;
 UPDATE public.analysis_message_drafts SET status='sending',approved_text=p_text,approved_by=p_author,approved_at=now() WHERE id=d.id;
 RETURN jsonb_build_object('claimed',true,'status','sending');
END $$;
REVOKE ALL ON FUNCTION public.claim_analysis_message(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_message(uuid,uuid,text) TO service_role;