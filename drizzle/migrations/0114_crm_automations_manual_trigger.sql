-- Automações com início manual (cards selecionados no CRM). Automações existentes continuam com o gatilho de entrada no funil.
ALTER TABLE public.crm_automations ADD COLUMN IF NOT EXISTS trigger_mode text NOT NULL DEFAULT 'entry';
ALTER TABLE public.crm_automations ADD CONSTRAINT crm_automations_trigger_mode_check CHECK (trigger_mode IN ('entry','manual'));
COMMENT ON COLUMN public.crm_automations.trigger_mode IS 'entry = card adicionado ao funil; manual = só cards selecionados por uma pessoa. Derivado do bloco de gatilho do desenho.';

CREATE FUNCTION public.crm_automation_set_trigger_mode() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 NEW.trigger_mode := CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.graph->'nodes')='array' THEN NEW.graph->'nodes' ELSE '[]'::jsonb END) n
   WHERE n->>'kind' = 'trigger' AND n->'data'->>'mode' = 'manual') THEN 'manual' ELSE 'entry' END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_automation_set_trigger_mode() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_automation_set_trigger_mode BEFORE INSERT OR UPDATE OF graph ON public.crm_automations
 FOR EACH ROW EXECUTE FUNCTION public.crm_automation_set_trigger_mode();

-- Fila do gatilho: só automações de entrada no funil.
CREATE OR REPLACE FUNCTION public.crm_automation_capture_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.pipeline_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.pipeline_id IS NOT DISTINCT FROM NEW.pipeline_id) THEN RETURN NULL; END IF;
 BEGIN
  IF EXISTS (SELECT 1 FROM crm_automations WHERE trigger_pipeline_id = NEW.pipeline_id AND state IN ('test','active') AND trigger_mode = 'entry') THEN
   INSERT INTO crm_automation_entries(lead_id, pipeline_id) VALUES (NEW.id, NEW.pipeline_id) ON CONFLICT DO NOTHING;
  END IF;
 EXCEPTION WHEN OTHERS THEN NULL; -- nunca impede a gravação do card
 END;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.process_crm_automation_entries(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x record; a public.crm_automations; res jsonb; n integer := 0; v_outcome text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 FOR x IN SELECT * FROM crm_automation_entries WHERE processed_at IS NULL ORDER BY entered_at LIMIT least(greatest(coalesce(p_limit,1),1),100) FOR UPDATE SKIP LOCKED LOOP
  v_outcome := 'Nenhuma automação ligada no momento da entrada';
  FOR a IN SELECT * FROM crm_automations WHERE trigger_pipeline_id = x.pipeline_id AND state IN ('test','active') AND trigger_mode = 'entry' ORDER BY created_at LOOP
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