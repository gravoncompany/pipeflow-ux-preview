CREATE TABLE public.analysis_qualification_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), analysis_id uuid NOT NULL REFERENCES public.whatsapp_analyses(id), fingerprint text NOT NULL, analyzed_at timestamptz NOT NULL, lead_id uuid NOT NULL REFERENCES public.leads(id), expected_revision bigint NOT NULL, pipeline_id uuid, target_stage text NOT NULL, target_title text NOT NULL, tag_id text NOT NULL, tag_label text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled','stale')), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 UNIQUE(analysis_id,fingerprint,analyzed_at,lead_id,expected_revision,target_stage,tag_id)
);
GRANT ALL ON public.analysis_qualification_actions TO service_role;
ALTER TABLE public.analysis_qualification_actions ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.resolve_analysis_qualification(p_id uuid,p_cancel boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.analysis_qualification_actions%ROWTYPE; r public.whatsapp_analyses%ROWTYPE; l public.leads%ROWTYPE; valid_evidence boolean; changed boolean;
BEGIN
 SELECT * INTO a FROM public.analysis_qualification_actions WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','missing'); END IF;
 IF a.status<>'pending' THEN RETURN jsonb_build_object('status',a.status); END IF;
 IF p_cancel THEN UPDATE public.analysis_qualification_actions SET status='cancelled',resolved_at=now() WHERE id=a.id; RETURN jsonb_build_object('status','cancelled'); END IF;
 SELECT * INTO r FROM public.whatsapp_analyses WHERE id=a.analysis_id FOR SHARE;
 SELECT * INTO l FROM public.leads WHERE id=a.lead_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','missing'); END IF;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.result->'interestEvidence')='array' THEN r.result->'interestEvidence' ELSE '[]'::jsonb END) e JOIN public.whatsapp_messages m ON m.message_id=e->>'messageId' AND m.phone_key=r.phone_key WHERE NOT m.from_me AND length(btrim(e->>'quote'))>0 AND strpos(m.body,e->>'quote')>0 AND (r.scope_start='' OR m.sent_at >= (r.scope_start||'T00:00:00-03:00')::timestamptz) AND (r.scope_end='' OR m.sent_at <= (r.scope_end||'T23:59:59.999999-03:00')::timestamptz)) INTO valid_evidence;
 IF r.fingerprint IS DISTINCT FROM a.fingerprint OR r.analyzed_at IS DISTINCT FROM a.analyzed_at OR r.result->>'qualification'<>'qualified' OR NOT valid_evidence OR l.gravon_change_revision<>a.expected_revision OR l.pipeline_id IS DISTINCT FROM a.pipeline_id THEN
 UPDATE public.analysis_qualification_actions SET status='stale',resolved_at=now() WHERE id=a.id; RETURN jsonb_build_object('status','stale'); END IF;
 IF a.pipeline_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_pipelines p, jsonb_array_elements(p.stages) s WHERE p.id=a.pipeline_id AND NOT p.archived AND s->>'id'=a.target_stage AND s->>'title'=a.target_title) THEN RETURN jsonb_build_object('status','stale'); END IF;
 IF jsonb_typeof(l.tags)<>'array' OR jsonb_typeof(l.history)<>'array' THEN RAISE EXCEPTION 'Invalid lead data'; END IF;
 changed:=l.stage<>a.target_stage OR NOT l.tags @> jsonb_build_array(a.tag_id);
 IF changed THEN UPDATE public.leads SET stage=a.target_stage,tags=CASE WHEN l.tags @> jsonb_build_array(a.tag_id) THEN l.tags ELSE l.tags||jsonb_build_array(a.tag_id) END,history=jsonb_build_array(jsonb_build_object('id',a.id::text,'date',to_char(now(),'YYYY-MM-DD'),'text','Qualificação confirmada após análise de conversa: '||a.target_title||' · etiqueta '||a.tag_label))||l.history WHERE id=l.id; END IF;
 UPDATE public.analysis_qualification_actions SET status='confirmed',resolved_at=now() WHERE id=a.id;
 RETURN jsonb_build_object('status','confirmed');
END $$;
REVOKE ALL ON FUNCTION public.resolve_analysis_qualification(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_analysis_qualification(uuid,boolean) TO service_role;
CREATE FUNCTION public.protect_analysis_qualification_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.history IS DISTINCT FROM OLD.history AND EXISTS(SELECT 1 FROM public.analysis_qualification_actions a WHERE a.lead_id=OLD.id AND a.status='confirmed' AND OLD.history @> jsonb_build_array(jsonb_build_object('id',a.id::text)) AND NOT NEW.history @> jsonb_build_array(jsonb_build_object('id',a.id::text))) THEN RAISE EXCEPTION 'Lead changed; reload before saving' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_analysis_qualification_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER preserve_analysis_qualification_history BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.protect_analysis_qualification_history();