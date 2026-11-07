CREATE TABLE public.analysis_message_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_key text NOT NULL, author_id uuid NOT NULL,
 instance text NOT NULL, phone text NOT NULL, phone_key text NOT NULL, recipient_name text NOT NULL,
 anchor_id text NOT NULL, anchor_from_me boolean NOT NULL, remote_jid text NOT NULL,
 scope_start text NOT NULL DEFAULT '', scope_end text NOT NULL DEFAULT '',
 analysis_result jsonb NOT NULL, analyzed_at timestamptz NOT NULL,
 db_snapshot jsonb NOT NULL, provider_snapshot text NOT NULL, lead_snapshot jsonb NOT NULL,
 suggestion text NOT NULL CHECK (char_length(suggestion) BETWEEN 1 AND 4000),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','unknown','failed','stale')),
 approved_text text, approved_by uuid, approved_at timestamptz, provider_id text, accepted_at timestamptz,
 synced_at timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.analysis_message_drafts TO service_role;
ALTER TABLE public.analysis_message_drafts ENABLE ROW LEVEL SECURITY;
CREATE INDEX analysis_message_drafts_contact ON public.analysis_message_drafts(company_key,instance,phone_key,created_at);
ALTER TABLE public.whatsapp_messages ADD COLUMN approved_by uuid, ADD COLUMN approved_at timestamptz, ADD COLUMN analysis_draft_id uuid, ADD COLUMN read_at timestamptz;
CREATE FUNCTION public.analysis_contact_snapshot(p_instance text,p_key text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',message_id,'body',body,'fromMe',from_me,'sentAt',sent_at,'phone',phone,'media',media_type) ORDER BY sent_at,message_id),'[]'::jsonb) FROM public.whatsapp_messages WHERE instance=p_instance AND phone_key=p_key;
$$;
REVOKE ALL ON FUNCTION public.analysis_contact_snapshot(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.analysis_contact_snapshot(text,text) TO service_role;
CREATE FUNCTION public.claim_analysis_message(p_id uuid,p_author uuid,p_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
 IF EXISTS(SELECT 1 FROM public.analysis_message_drafts x WHERE x.id<>d.id AND x.company_key=d.company_key AND x.instance=d.instance AND x.phone_key=d.phone_key AND x.status IN ('sending','unknown')) THEN RAISE EXCEPTION 'Unresolved send'; END IF;
 IF d.db_snapshot IS DISTINCT FROM public.analysis_contact_snapshot(d.instance,d.phone_key) THEN
  UPDATE public.analysis_message_drafts SET status='stale',error='A conversa mudou. Atualize a sugestão e revise novamente.' WHERE id=d.id;
  RETURN jsonb_build_object('claimed',false,'status','stale');
 END IF;
 UPDATE public.analysis_message_drafts SET status='sending',approved_text=p_text,approved_by=p_author,approved_at=now() WHERE id=d.id;
 RETURN jsonb_build_object('claimed',true,'status','sending');
END $$;
REVOKE ALL ON FUNCTION public.claim_analysis_message(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_message(uuid,uuid,text) TO service_role;
COMMENT ON TABLE public.analysis_message_drafts IS 'Private individual reviewed sends; unknown/sending outcomes never permit blind retries. Actor, recipient and snapshots are server resolved.';