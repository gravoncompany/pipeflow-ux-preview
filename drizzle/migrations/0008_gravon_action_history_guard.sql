ALTER TABLE public.leads ADD COLUMN gravon_change_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.gravon_lead_stage_actions ADD COLUMN expected_change_revision bigint NOT NULL DEFAULT 0;

CREATE FUNCTION public.gravon_protect_action_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.history IS DISTINCT FROM OLD.history AND EXISTS (
  SELECT 1 FROM public.gravon_lead_stage_actions a WHERE a.lead_id=OLD.id AND a.status='moved'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(OLD.history)='array' THEN OLD.history ELSE '[]'::jsonb END) e WHERE e->>'id'=a.id::text)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.history)='array' THEN NEW.history ELSE '[]'::jsonb END) e WHERE e->>'id'=a.id::text)
 ) THEN RAISE EXCEPTION 'Lead changed through WhatsApp; reload before saving' USING ERRCODE='40001'; END IF;
 NEW.gravon_change_revision:=OLD.gravon_change_revision+1;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gravon_protect_action_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER gravon_preserve_action_history BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.gravon_protect_action_history();

CREATE FUNCTION public.gravon_capture_action_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 SELECT gravon_change_revision INTO NEW.expected_change_revision FROM public.leads WHERE id=NEW.lead_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead unavailable'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gravon_capture_action_revision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER gravon_capture_action_revision BEFORE INSERT ON public.gravon_lead_stage_actions FOR EACH ROW EXECUTE FUNCTION public.gravon_capture_action_revision();

CREATE FUNCTION public.gravon_check_action_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.stage IS DISTINCT FROM OLD.stage AND EXISTS(SELECT 1 FROM public.gravon_lead_stage_actions a WHERE a.lead_id=OLD.id AND a.status='pending' AND a.target_stage=NEW.stage AND NEW.history->0->>'id'=a.id::text AND a.expected_change_revision<>OLD.gravon_change_revision) THEN RAISE EXCEPTION 'Lead revision changed; propose again' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gravon_check_action_revision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER gravon_check_action_revision BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.gravon_check_action_revision();