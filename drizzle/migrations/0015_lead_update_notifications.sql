CREATE FUNCTION public.record_lead_update_notification() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE changes text[] := ARRAY[]::text[]; event_kind text := 'update'; details text; head_changed boolean;
BEGIN
 IF NEW.notes IS DISTINCT FROM OLD.notes THEN changes:=array_append(changes,'Anotações internas atualizadas'); event_kind:='note'; END IF;
 IF NEW.stage IS DISTINCT FROM OLD.stage THEN changes:=array_append(changes,'Etapa alterada: '||OLD.stage||' → '||NEW.stage); END IF;
 IF NEW.tags IS DISTINCT FROM OLD.tags THEN changes:=array_append(changes,'Etiquetas atualizadas'); END IF;
 IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN changes:=array_append(changes,'Funil alterado'); END IF;
 IF NEW.name IS DISTINCT FROM OLD.name OR NEW.company IS DISTINCT FROM OLD.company OR NEW.whatsapp IS DISTINCT FROM OLD.whatsapp OR NEW.email IS DISTINCT FROM OLD.email OR NEW.potential_value IS DISTINCT FROM OLD.potential_value OR NEW.next_action IS DISTINCT FROM OLD.next_action THEN changes:=array_append(changes,'Dados do lead atualizados'); END IF;
 IF cardinality(changes)=0 THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.history)<>'array' THEN RETURN NEW; END IF;
 head_changed:=NEW.history->0 IS DISTINCT FROM OLD.history->0;
 IF head_changed AND NEW.notes IS NOT DISTINCT FROM OLD.notes THEN RETURN NEW; END IF;
 details:=array_to_string(changes,' · ');
 NEW.history:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'date',clock_timestamp()::text,'text',details,'kind',event_kind))||NEW.history;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_lead_update_notification() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_record_lead_update_notification BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.record_lead_update_notification();