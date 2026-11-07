ALTER TABLE public.crm_client_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by text, ADD COLUMN IF NOT EXISTS ai_reason text NOT NULL DEFAULT '';
UPDATE public.crm_client_tasks SET completed_at=updated_at WHERE status='concluida' AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS crm_client_tasks_active ON public.crm_client_tasks(client_id) WHERE deleted_at IS NULL;

CREATE TABLE public.crm_client_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  client_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('criada','alterada','concluida','reaberta','excluida')),
  actor text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  origin text NOT NULL DEFAULT '',
  responsible text NOT NULL DEFAULT '',
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.crm_client_task_events TO service_role;
ALTER TABLE public.crm_client_task_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_client_task_events FROM anon, authenticated;
CREATE INDEX crm_client_task_events_client ON public.crm_client_task_events(client_id, created_at DESC);

CREATE TABLE public.crm_task_orders (
  context text NOT NULL CHECK (length(context) BETWEEN 1 AND 80),
  task_id uuid NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (context, task_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_task_orders TO service_role;
ALTER TABLE public.crm_task_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_task_orders FROM anon, authenticated;

-- Completion timestamp + audit trail on every change (sort order lives elsewhere, so reordering never touches status or history).
CREATE OR REPLACE FUNCTION public.crm_client_task_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE diff jsonb := '{}'::jsonb; act text; k text; BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.crm_client_task_events(task_id,client_id,action,actor,title,origin,responsible,changes)
    VALUES(NEW.id,NEW.client_id,'criada',NEW.created_by,NEW.title,NEW.origin,NEW.responsible,jsonb_build_object('prioridade',NEW.priority,'prazo',NEW.due_date));
    RETURN NEW;
  END IF;
  FOREACH k IN ARRAY ARRAY['title','description','responsible','priority','due_date','status'] LOOP
    IF (to_jsonb(OLD)->k) IS DISTINCT FROM (to_jsonb(NEW)->k) THEN diff := diff || jsonb_build_object(k, jsonb_build_object('de', to_jsonb(OLD)->k, 'para', to_jsonb(NEW)->k)); END IF;
  END LOOP;
  act := CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'excluida'
              WHEN NEW.status='concluida' AND OLD.status<>'concluida' THEN 'concluida'
              WHEN OLD.status='concluida' AND NEW.status<>'concluida' THEN 'reaberta'
              WHEN diff<>'{}'::jsonb THEN 'alterada' END;
  IF act IS NOT NULL THEN
    INSERT INTO public.crm_client_task_events(task_id,client_id,action,actor,title,origin,responsible,changes)
    VALUES(NEW.id,NEW.client_id,act,coalesce(NEW.deleted_by,current_setting('pipeflow.actor',true),''),NEW.title,NEW.origin,NEW.responsible,diff);
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.crm_client_task_completed() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF NEW.status='concluida' AND (TG_OP='INSERT' OR OLD.status<>'concluida') THEN NEW.completed_at := now();
  ELSIF NEW.status<>'concluida' THEN NEW.completed_at := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_client_task_completed ON public.crm_client_tasks;
CREATE TRIGGER crm_client_task_completed BEFORE INSERT OR UPDATE OF status ON public.crm_client_tasks FOR EACH ROW EXECUTE FUNCTION public.crm_client_task_completed();
DROP TRIGGER IF EXISTS crm_client_task_audit ON public.crm_client_tasks;
CREATE TRIGGER crm_client_task_audit AFTER INSERT OR UPDATE ON public.crm_client_tasks FOR EACH ROW EXECUTE FUNCTION public.crm_client_task_audit();

-- Bulk actions: complete, soft-delete (kept for audit/dedupe, hidden from lists) or change priority.
CREATE OR REPLACE FUNCTION public.bulk_crm_client_tasks(p_actor text, p_ids uuid[], p_action text, p_priority text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_task'; END IF;
  PERFORM set_config('pipeflow.actor', left(p_actor,160), true);
  IF p_action='complete' THEN
    UPDATE public.crm_client_tasks SET status='concluida',revision=revision+1,updated_at=now() WHERE id=ANY(p_ids) AND deleted_at IS NULL AND status<>'concluida';
  ELSIF p_action='delete' THEN
    UPDATE public.crm_client_tasks SET deleted_at=now(),deleted_by=left(p_actor,160),revision=revision+1,updated_at=now() WHERE id=ANY(p_ids) AND deleted_at IS NULL;
    DELETE FROM public.crm_task_orders WHERE task_id=ANY(p_ids);
  ELSIF p_action='priority' AND p_priority IN ('baixa','media','alta','urgente') THEN
    UPDATE public.crm_client_tasks SET priority=p_priority,revision=revision+1,updated_at=now() WHERE id=ANY(p_ids) AND deleted_at IS NULL AND priority<>p_priority;
  ELSE RAISE EXCEPTION 'invalid_task'; END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.bulk_crm_client_tasks(text,uuid[],text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_crm_client_tasks(text,uuid[],text,text) TO service_role;

-- Manual order per list/context; never touches the task rows.
CREATE OR REPLACE FUNCTION public.reorder_crm_tasks(p_context text, p_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_context IS NULL OR length(p_context) NOT BETWEEN 1 AND 80 OR p_ids IS NULL OR cardinality(p_ids) > 3000 THEN RAISE EXCEPTION 'invalid_order'; END IF;
  DELETE FROM public.crm_task_orders WHERE context=p_context;
  INSERT INTO public.crm_task_orders(context,task_id,position)
  SELECT p_context, x.id, x.ord::integer FROM unnest(p_ids) WITH ORDINALITY AS x(id, ord)
  WHERE EXISTS(SELECT 1 FROM public.crm_client_tasks t WHERE t.id=x.id AND t.deleted_at IS NULL)
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.reorder_crm_tasks(text,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_crm_tasks(text,uuid[]) TO service_role;