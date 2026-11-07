ALTER TABLE public.analysis_qualification_actions ADD COLUMN internal_note text NOT NULL DEFAULT '';
CREATE FUNCTION public.resolve_analysis_qualification_with_notes(p_id uuid,p_cancel boolean,p_notes text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.analysis_qualification_actions%ROWTYPE; result jsonb; note text;
BEGIN
 SELECT * INTO a FROM public.analysis_qualification_actions WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','missing'); END IF;
 IF a.status<>'pending' THEN RETURN jsonb_build_object('status',a.status); END IF;
 note:=btrim(coalesce(p_notes,''));
 IF length(note)>8000 THEN RAISE EXCEPTION 'Note too long'; END IF;
 result:=public.resolve_analysis_qualification(p_id,p_cancel);
 IF NOT p_cancel AND result->>'status'='confirmed' AND length(note)>0 THEN
 UPDATE public.leads SET notes=CASE WHEN length(btrim(coalesce(notes,'')))=0 THEN 'Análise da conversa — principais pontos:'||E'\n'||note ELSE notes||E'\n\n'||'Análise da conversa — principais pontos:'||E'\n'||note END WHERE id=a.lead_id;
 UPDATE public.analysis_qualification_actions SET internal_note=note WHERE id=a.id;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.resolve_analysis_qualification_with_notes(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_analysis_qualification_with_notes(uuid,boolean,text) TO service_role;