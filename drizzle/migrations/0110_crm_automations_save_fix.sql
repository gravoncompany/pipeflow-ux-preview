-- Corrige ambiguidade de nome ("steps") ao salvar uma automação.
CREATE OR REPLACE FUNCTION public.save_crm_automation(p_id uuid, p_revision integer, p_name text, p_graph jsonb, p_compiled jsonb, p_compile_ok boolean,
 p_pipeline uuid, p_landing text, p_tests text[], p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.crm_automations; f public.crm_email_flows; v_steps jsonb; v_ai boolean; v_name text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_pipeline IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales_pipelines WHERE id = p_pipeline) THEN RAISE EXCEPTION 'invalid_pipeline'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO a FROM crm_automations WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR a.revision <> p_revision OR a.state = 'archived' THEN RAISE EXCEPTION 'stale_automation'; END IF;
  IF a.state IN ('test','active') THEN RAISE EXCEPTION 'pause_first'; END IF;
 END IF;
 IF p_compile_ok THEN
  v_steps := coalesce(p_compiled->'steps', '[]'::jsonb);
  v_ai := coalesce((p_compiled->>'usesAi')::boolean, false);
  v_name := 'Automação · ' || left(btrim(p_name), 130);
  -- Salvar sempre exige nova aprovação da IA (feita ao ligar a automação).
  IF a.flow_id IS NULL THEN
   f := jsonb_populate_record(NULL::public.crm_email_flows, save_crm_email_flow(NULL, 0, v_name, v_steps, v_ai, false));
  ELSE
   SELECT * INTO f FROM crm_email_flows WHERE id = a.flow_id;
   f := jsonb_populate_record(NULL::public.crm_email_flows, save_crm_email_flow(f.id, f.revision, v_name, v_steps, v_ai, false));
  END IF;
  UPDATE crm_email_flows SET max_messages = least(greatest(jsonb_array_length(v_steps), 1), 10) WHERE id = f.id;
 END IF;
 IF p_id IS NULL THEN
  INSERT INTO crm_automations(name, graph, compiled, compile_ok, trigger_pipeline_id, flow_id, landing_url, test_contacts, slug)
   VALUES (btrim(p_name), p_graph, CASE WHEN p_compile_ok THEN p_compiled ELSE '{}'::jsonb END, p_compile_ok, p_pipeline, f.id, coalesce(p_landing,''), coalesce(p_tests,'{}'), left(coalesce(p_slug,''),80))
   RETURNING * INTO a;
 ELSE
  UPDATE crm_automations SET name = btrim(p_name), graph = p_graph, compiled = CASE WHEN p_compile_ok THEN p_compiled ELSE compiled END,
   compile_ok = p_compile_ok, trigger_pipeline_id = p_pipeline, flow_id = coalesce(f.id, flow_id), landing_url = coalesce(p_landing,''),
   test_contacts = coalesce(p_tests,'{}'), slug = left(coalesce(p_slug,''),80), revision = revision + 1, updated_at = now()
  WHERE id = p_id RETURNING * INTO a;
 END IF;
 IF f.id IS NOT NULL THEN UPDATE crm_email_flows SET automation_id = a.id WHERE id = f.id; END IF;
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.save_crm_automation(uuid,integer,text,jsonb,jsonb,boolean,uuid,text,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_automation(uuid,integer,text,jsonb,jsonb,boolean,uuid,text,text[],text) TO service_role;
