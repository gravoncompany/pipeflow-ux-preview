CREATE FUNCTION public.preserve_outbound_click_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(OLD.history,'[]'::jsonb)) h WHERE h->>'id' LIKE 'outbound-click:%' AND NOT coalesce(NEW.history,'[]'::jsonb) @> jsonb_build_array(h)) THEN RAISE EXCEPTION 'stale_outbound_click_history'; END IF;
 IF coalesce(OLD.tags,'[]'::jsonb) ? 'clicou-no-link' AND NOT coalesce(NEW.tags,'[]'::jsonb) ? 'clicou-no-link' THEN NEW.tags:=coalesce(NEW.tags,'[]'::jsonb)||'"clicou-no-link"'::jsonb; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.preserve_outbound_click_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER preserve_outbound_click_history BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.preserve_outbound_click_history();