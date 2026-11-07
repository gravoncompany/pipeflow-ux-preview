CREATE OR REPLACE FUNCTION public.create_crm_client_message_task(p_actor text,p_client uuid,p_title text,p_description text,p_responsible text,p_due date,p_source_message text,p_quote text,p_dedupe text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing uuid; new_id uuid;
BEGIN
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION 'invalid_task'; END IF;
  IF p_source_message IS NULL OR length(p_source_message) NOT BETWEEN 1 AND 200 OR p_dedupe IS NULL OR length(p_dedupe) NOT BETWEEN 4 AND 400 THEN RAISE EXCEPTION 'invalid_task'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_clients WHERE id=p_client) THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:client-ai-tasks:'||p_client::text,0));
  SELECT id INTO existing FROM public.crm_client_tasks WHERE client_id=p_client AND (dedupe_key=p_dedupe OR (source_message_id=p_source_message AND lower(btrim(title))=lower(btrim(p_title)))) LIMIT 1;
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('id',existing,'created',false); END IF;
  INSERT INTO public.crm_client_tasks(client_id,title,description,responsible,priority,due_date,status,origin,created_by,source_message_id,source_quote,dedupe_key)
  VALUES(p_client,left(btrim(p_title),300),left(coalesce(p_description,''),5000),left(coalesce(p_responsible,''),160),'media',p_due,'pendente','manual',left(p_actor,160),p_source_message,left(coalesce(p_quote,''),1000),p_dedupe) RETURNING id INTO new_id;
  RETURN jsonb_build_object('id',new_id,'created',true);
END $$;
REVOKE ALL ON FUNCTION public.create_crm_client_message_task(text,uuid,text,text,text,date,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_crm_client_message_task(text,uuid,text,text,text,date,text,text,text) TO service_role;