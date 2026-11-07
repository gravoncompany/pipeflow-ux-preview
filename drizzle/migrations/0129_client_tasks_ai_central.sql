ALTER TABLE public.crm_client_tasks DROP CONSTRAINT IF EXISTS crm_client_tasks_priority_check;
ALTER TABLE public.crm_client_tasks ADD CONSTRAINT crm_client_tasks_priority_check CHECK (priority IN ('baixa','media','alta','urgente'));
ALTER TABLE public.crm_client_tasks ADD COLUMN IF NOT EXISTS source_message_id text, ADD COLUMN IF NOT EXISTS source_quote text NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS crm_client_tasks_dedupe ON public.crm_client_tasks(client_id,dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_crm_client_task(p_actor text,p_id uuid,p_client uuid,p_title text,p_description text,p_responsible text,p_priority text,p_due date,p_status text,p_origin text,p_revision bigint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.crm_client_tasks%ROWTYPE; new_id uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_title IS NULL OR length(p_title) NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'invalid_task'; END IF;
  IF p_priority NOT IN ('baixa','media','alta','urgente') OR p_status NOT IN ('pendente','em_andamento','concluida') OR p_origin NOT IN ('manual','ia','lembrete') THEN RAISE EXCEPTION 'invalid_task'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p_client) THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.crm_client_tasks(client_id,title,description,responsible,priority,due_date,status,origin,created_by) VALUES(p_client,left(p_title,300),left(coalesce(p_description,''),5000),left(coalesce(p_responsible,''),160),p_priority,p_due,p_status,p_origin,left(p_actor,160)) RETURNING id INTO new_id;
    RETURN new_id;
  END IF;
  SELECT * INTO t FROM public.crm_client_tasks WHERE id=p_id AND client_id=p_client FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_unavailable'; END IF;
  IF t.revision<>p_revision THEN RAISE EXCEPTION 'task_changed'; END IF;
  UPDATE public.crm_client_tasks SET title=left(p_title,300),description=left(coalesce(p_description,''),5000),responsible=left(coalesce(p_responsible,''),160),priority=p_priority,due_date=p_due,status=p_status,revision=revision+1,updated_at=now() WHERE id=p_id;
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_crm_client_ai_task(p_actor text,p_client uuid,p_title text,p_description text,p_priority text,p_due date,p_status text,p_source_message text,p_quote text,p_dedupe text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_id uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 OR p_title IS NULL OR length(p_title) NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'invalid_task'; END IF;
  IF p_priority NOT IN ('baixa','media','alta','urgente') OR p_status NOT IN ('pendente','em_andamento') OR p_dedupe IS NULL OR length(p_dedupe) NOT BETWEEN 4 AND 400 THEN RAISE EXCEPTION 'invalid_task'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p_client) THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:client-ai-tasks:'||p_client::text,0));
  IF EXISTS(SELECT 1 FROM public.crm_client_tasks WHERE client_id=p_client AND (dedupe_key=p_dedupe OR (p_source_message IS NOT NULL AND source_message_id=p_source_message AND lower(title)=lower(p_title)))) THEN RETURN NULL; END IF;
  INSERT INTO public.crm_client_tasks(client_id,title,description,priority,due_date,status,origin,created_by,source_message_id,source_quote,dedupe_key)
  VALUES(p_client,left(p_title,300),left(coalesce(p_description,''),5000),p_priority,p_due,p_status,'ia',left(p_actor,160),left(p_source_message,200),left(coalesce(p_quote,''),1000),p_dedupe) RETURNING id INTO new_id;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.create_crm_client_ai_task(text,uuid,text,text,text,date,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_crm_client_ai_task(text,uuid,text,text,text,date,text,text,text,text) TO service_role;