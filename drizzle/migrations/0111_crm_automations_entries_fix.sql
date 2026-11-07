-- Corrige ambiguidade de nome ("outcome") ao processar entradas do gatilho.
CREATE OR REPLACE FUNCTION public.process_crm_automation_entries(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x record; a public.crm_automations; res jsonb; n integer := 0; v_outcome text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 FOR x IN SELECT * FROM crm_automation_entries WHERE processed_at IS NULL ORDER BY entered_at LIMIT least(greatest(coalesce(p_limit,1),1),100) FOR UPDATE SKIP LOCKED LOOP
  v_outcome := 'Nenhuma automação ligada no momento da entrada';
  FOR a IN SELECT * FROM crm_automations WHERE trigger_pipeline_id = x.pipeline_id AND state IN ('test','active') ORDER BY created_at LOOP
   IF a.activated_at IS NOT NULL AND x.entered_at < a.activated_at THEN v_outcome := 'Entrou antes de a automação ser ligada'; CONTINUE; END IF;
   res := start_crm_automation_run(a.id, x.lead_id, 'trigger');
   v_outcome := CASE WHEN (res->>'ok')::boolean THEN 'Iniciada' ELSE coalesce(res->>'reason', 'Não iniciada') END;
   EXIT WHEN (res->>'ok')::boolean;
  END LOOP;
  UPDATE crm_automation_entries SET processed_at = now(), outcome = left(v_outcome, 200) WHERE lead_id = x.lead_id AND pipeline_id = x.pipeline_id;
  n := n + 1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.process_crm_automation_entries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_crm_automation_entries(integer) TO service_role;
