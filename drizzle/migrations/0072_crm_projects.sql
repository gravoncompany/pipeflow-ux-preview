CREATE TABLE public.crm_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_key text NOT NULL DEFAULT 'crm:1' CHECK(company_key='crm:1'), seed_key text UNIQUE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 160), objective text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'melhoria',
 priority text NOT NULL DEFAULT 'media' CHECK(priority IN ('alta','media','baixa')), status text NOT NULL DEFAULT 'planejado' CHECK(status IN ('planejado','em_desenvolvimento','em_teste','concluido','bloqueado')),
 responsible text NOT NULL DEFAULT '', tasks jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(tasks)='array'), technical_pending text NOT NULL DEFAULT '', test_results text NOT NULL DEFAULT '', next_action text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.crm_projects TO service_role;
ALTER TABLE public.crm_projects ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.crm_project_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.crm_projects(id), company_key text NOT NULL DEFAULT 'crm:1' CHECK(company_key='crm:1'),
 event_id uuid NOT NULL UNIQUE, actor text NOT NULL, kind text NOT NULL CHECK(kind IN ('cadastro','atualizacao','decisao','prompt','problema','solucao','teste')), content text NOT NULL,
 snapshot jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.crm_project_history TO service_role;
ALTER TABLE public.crm_project_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX crm_project_history_order ON public.crm_project_history(project_id,created_at DESC,id);
CREATE OR REPLACE FUNCTION public.save_crm_project(p_author uuid,p_event uuid,p_id uuid,p_revision integer,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.crm_projects; old_event public.crm_project_history; BEGIN
 IF NOT public.commercial_knowledge_access(p_author,'crm:1') THEN RAISE EXCEPTION 'project_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 SELECT * INTO old_event FROM public.crm_project_history WHERE event_id=p_event;
 IF FOUND THEN
  IF old_event.actor<>p_author::text OR old_event.snapshot IS DISTINCT FROM p_data OR (p_id IS NOT NULL AND old_event.project_id<>p_id) THEN RAISE EXCEPTION 'project_event_conflict'; END IF;
  RETURN jsonb_build_object('id',old_event.project_id,'replayed',true);
 END IF;
 IF p_data->>'status'='concluido' AND length(btrim(coalesce(p_data->>'testResults','')))=0 THEN RAISE EXCEPTION 'project_evidence_required'; END IF;
 IF jsonb_typeof(p_data->'tasks')<>'array' OR jsonb_array_length(p_data->'tasks')>100 THEN RAISE EXCEPTION 'project_tasks_invalid'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.crm_projects(name,objective,description,category,priority,status,responsible,tasks,technical_pending,test_results,next_action)
  VALUES(p_data->>'name',p_data->>'objective',p_data->>'description',p_data->>'category',p_data->>'priority',p_data->>'status',p_data->>'responsible',p_data->'tasks',p_data->>'technicalPending',p_data->>'testResults',p_data->>'nextAction') RETURNING * INTO v;
 ELSE
  SELECT * INTO v FROM public.crm_projects WHERE id=p_id AND company_key='crm:1' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project_unavailable'; END IF;
  IF v.revision<>p_revision THEN RAISE EXCEPTION 'project_changed'; END IF;
  UPDATE public.crm_projects SET name=p_data->>'name',objective=p_data->>'objective',description=p_data->>'description',category=p_data->>'category',priority=p_data->>'priority',status=p_data->>'status',responsible=p_data->>'responsible',tasks=p_data->'tasks',technical_pending=p_data->>'technicalPending',test_results=p_data->>'testResults',next_action=p_data->>'nextAction',revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO v;
 END IF;
 INSERT INTO public.crm_project_history(project_id,event_id,actor,kind,content,snapshot) VALUES(v.id,p_event,p_author::text,CASE WHEN p_id IS NULL THEN 'cadastro' ELSE 'atualizacao' END,CASE WHEN p_id IS NULL THEN 'Projeto cadastrado.' ELSE 'Cadastro atualizado.' END,p_data);
 RETURN jsonb_build_object('id',v.id,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.save_crm_project(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_project(uuid,uuid,uuid,integer,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.add_crm_project_history(p_author uuid,p_event uuid,p_project uuid,p_kind text,p_content text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.crm_project_history; BEGIN
 IF NOT public.commercial_knowledge_access(p_author,'crm:1') THEN RAISE EXCEPTION 'project_forbidden' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN ('decisao','prompt','problema','solucao','teste') OR length(btrim(p_content)) NOT BETWEEN 1 AND 16000 THEN RAISE EXCEPTION 'project_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 SELECT * INTO e FROM public.crm_project_history WHERE event_id=p_event;
 IF FOUND THEN
  IF e.actor<>p_author::text OR e.project_id<>p_project OR e.kind<>p_kind OR e.content<>p_content THEN RAISE EXCEPTION 'project_event_conflict'; END IF;
  RETURN;
 END IF;
 PERFORM 1 FROM public.crm_projects WHERE id=p_project AND company_key='crm:1' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'project_unavailable'; END IF;
 INSERT INTO public.crm_project_history(project_id,event_id,actor,kind,content) VALUES(p_project,p_event,p_author::text,p_kind,p_content);
 UPDATE public.crm_projects SET updated_at=now() WHERE id=p_project;
END $$;
REVOKE ALL ON FUNCTION public.add_crm_project_history(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_crm_project_history(uuid,uuid,uuid,text,text) TO service_role;