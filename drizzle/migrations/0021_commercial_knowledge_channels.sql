ALTER TABLE public.portal_admin_channels ADD COLUMN company_key text NOT NULL DEFAULT 'crm:1';
ALTER TABLE public.ai_knowledge ADD COLUMN company_key text NOT NULL DEFAULT 'crm:1', ADD COLUMN entry_type text NOT NULL DEFAULT 'generated', ADD COLUMN title text NOT NULL DEFAULT '', ADD COLUMN author_id uuid, ADD COLUMN origin text NOT NULL DEFAULT 'learning', ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN revision bigint NOT NULL DEFAULT 0;
CREATE INDEX ai_knowledge_company_entries ON public.ai_knowledge(company_key,entry_type,updated_at DESC);
CREATE TABLE public.ai_knowledge_operations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_key text NOT NULL, author_id uuid NOT NULL, origin text NOT NULL, event_key text NOT NULL, operation text NOT NULL, payload jsonb NOT NULL, knowledge_id uuid NOT NULL REFERENCES public.ai_knowledge(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_key,origin,event_key));
GRANT ALL ON public.ai_knowledge_operations TO service_role;
ALTER TABLE public.ai_knowledge_operations ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.commercial_knowledge_access(p_author uuid,p_company text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles r JOIN auth.users u ON u.id=r.user_id JOIN public.portal_admin_channels c ON c.user_id=r.user_id WHERE r.user_id=p_author AND r.role='admin' AND u.email_confirmed_at IS NOT NULL AND c.company_key=p_company) $$;
REVOKE ALL ON FUNCTION public.commercial_knowledge_access(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_knowledge_access(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.write_commercial_knowledge(p_author uuid,p_company text,p_origin text,p_event text,p_operation text,p_id uuid,p_revision bigint,p_title text,p_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.ai_knowledge; v_old public.ai_knowledge_operations; v_payload jsonb;
BEGIN
 IF NOT public.commercial_knowledge_access(p_author,p_company) THEN RAISE EXCEPTION 'knowledge_forbidden' USING ERRCODE='42501'; END IF;
 IF p_origin NOT IN ('whatsapp','internal_chat','menu') OR length(p_event) NOT BETWEEN 1 AND 240 OR length(btrim(p_text)) NOT BETWEEN 1 AND 8000 OR length(p_title)>160 OR p_operation NOT IN ('create','append','replace') THEN RAISE EXCEPTION 'knowledge_invalid_input'; END IF;
 v_payload:=jsonb_build_object('operation',p_operation,'id',p_id,'revision',p_revision,'title',p_title,'text',p_text);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company||p_origin||p_event,0));
 SELECT * INTO v_old FROM public.ai_knowledge_operations WHERE company_key=p_company AND origin=p_origin AND event_key=p_event;
 IF FOUND THEN
  IF v_old.author_id IS DISTINCT FROM p_author OR v_old.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'knowledge_event_conflict'; END IF;
  SELECT * INTO v_row FROM public.ai_knowledge WHERE id=v_old.knowledge_id AND company_key=p_company;
  RETURN jsonb_build_object('ok',true,'replayed',true,'record',to_jsonb(v_row));
 END IF;
 IF p_operation='create' THEN
  IF length(btrim(p_title))<1 THEN RAISE EXCEPTION 'knowledge_title_required'; END IF;
  INSERT INTO public.ai_knowledge(generation,kind,text,title,company_key,entry_type,author_id,origin) VALUES(0,'winning_practice',btrim(p_text),btrim(p_title),p_company,'manual',p_author,p_origin) RETURNING * INTO v_row;
 ELSE
  SELECT * INTO v_row FROM public.ai_knowledge WHERE id=p_id AND company_key=p_company AND entry_type='manual' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_not_found'; END IF;
  IF v_row.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'knowledge_revision_conflict'; END IF;
  IF p_operation='append' AND length(v_row.text||E'\n'||p_text)>8000 THEN RAISE EXCEPTION 'knowledge_too_large'; END IF;
  UPDATE public.ai_knowledge SET text=CASE WHEN p_operation='append' THEN text||E'\nAtualização: '||btrim(p_text) ELSE btrim(p_text) END,title=CASE WHEN p_operation='replace' AND length(btrim(p_title))>0 THEN btrim(p_title) ELSE title END,updated_at=clock_timestamp(),revision=revision+1 WHERE id=v_row.id RETURNING * INTO v_row;
 END IF;
 INSERT INTO public.ai_knowledge_operations(company_key,author_id,origin,event_key,operation,payload,knowledge_id) VALUES(p_company,p_author,p_origin,p_event,p_operation,v_payload,v_row.id);
 RETURN jsonb_build_object('ok',true,'replayed',false,'record',to_jsonb(v_row));
END $$;
REVOKE ALL ON FUNCTION public.write_commercial_knowledge(uuid,text,text,text,text,uuid,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.write_commercial_knowledge(uuid,text,text,text,text,uuid,bigint,text,text) TO service_role;