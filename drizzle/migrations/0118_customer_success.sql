CREATE TABLE public.crm_customer_success (
 client_id uuid PRIMARY KEY REFERENCES public.crm_clients(id), stage text NOT NULL DEFAULT 'novo' CHECK(stage IN ('novo','onboarding','implementacao','acompanhamento','renovacao','encerrado')), health text CHECK(health IN ('saudavel','atencao','em_risco')), last_followup_at timestamptz, revision integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.crm_customer_success TO service_role;
ALTER TABLE public.crm_customer_success ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.crm_cs_evaluations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.crm_clients(id), event_id uuid NOT NULL UNIQUE, status text NOT NULL DEFAULT 'analyzing' CHECK(status IN ('analyzing','completed','failed')), diagnosis jsonb, message_count integer NOT NULL DEFAULT 0, period_start timestamptz, period_end timestamptz, limitation text NOT NULL DEFAULT '', source_revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
GRANT ALL ON public.crm_cs_evaluations TO service_role;
ALTER TABLE public.crm_cs_evaluations ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX crm_cs_one_analysis ON public.crm_cs_evaluations(client_id) WHERE status='analyzing';
CREATE INDEX crm_cs_evaluations_client ON public.crm_cs_evaluations(client_id,created_at DESC);
CREATE TABLE public.crm_cs_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.crm_clients(id), event_id uuid NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('manual','stage','followup','reviewed_ai')), before_state jsonb NOT NULL, after_state jsonb NOT NULL, note text NOT NULL DEFAULT '', evaluation_id uuid REFERENCES public.crm_cs_evaluations(id), actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON public.crm_cs_history TO service_role;
ALTER TABLE public.crm_cs_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX crm_cs_history_client ON public.crm_cs_history(client_id,created_at DESC);
CREATE FUNCTION public.update_crm_customer_success(p_client uuid,p_revision integer,p_event uuid,p_actor text,p_stage text DEFAULT NULL,p_health text DEFAULT NULL,p_note text DEFAULT '',p_followup timestamptz DEFAULT NULL,p_evaluation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE oldrow public.crm_customer_success; newrow public.crm_customer_success; ev public.crm_cs_evaluations; prior public.crm_cs_history;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM 1 FROM public.crm_clients WHERE id=p_client FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'client_unavailable'; END IF;
 SELECT * INTO prior FROM public.crm_cs_history WHERE event_id=p_event;
 IF FOUND THEN IF prior.client_id<>p_client THEN RAISE EXCEPTION 'event_mismatch'; END IF; RETURN prior.after_state; END IF;
 INSERT INTO public.crm_customer_success(client_id) VALUES(p_client) ON CONFLICT DO NOTHING;
 SELECT * INTO oldrow FROM public.crm_customer_success WHERE client_id=p_client FOR UPDATE;
 IF oldrow.revision<>p_revision THEN RAISE EXCEPTION 'cs_changed'; END IF;
 IF p_stage IS NULL AND p_health IS NULL AND p_followup IS NULL THEN RAISE EXCEPTION 'invalid_change'; END IF;
 IF p_followup IS NOT NULL AND p_followup>now()+interval '1 minute' THEN RAISE EXCEPTION 'invalid_followup'; END IF;
 IF p_health IS NOT NULL AND length(trim(p_note))<3 AND p_evaluation IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
 IF p_evaluation IS NOT NULL THEN
 SELECT * INTO ev FROM public.crm_cs_evaluations WHERE id=p_evaluation AND client_id=p_client AND status='completed';
 IF NOT FOUND OR ev.source_revision<>oldrow.revision OR ev.diagnosis->>'health' IS DISTINCT FROM p_health THEN RAISE EXCEPTION 'evaluation_changed'; END IF;
 END IF;
 UPDATE public.crm_customer_success SET stage=coalesce(p_stage,stage),health=coalesce(p_health,health),last_followup_at=coalesce(p_followup,last_followup_at),revision=revision+1,updated_at=now() WHERE client_id=p_client RETURNING * INTO newrow;
 INSERT INTO public.crm_cs_history(client_id,event_id,kind,before_state,after_state,note,evaluation_id,actor) VALUES(p_client,p_event,CASE WHEN p_evaluation IS NOT NULL THEN 'reviewed_ai' WHEN p_health IS NOT NULL THEN 'manual' WHEN p_stage IS NOT NULL THEN 'stage' ELSE 'followup' END,to_jsonb(oldrow),to_jsonb(newrow),left(p_note,3000),p_evaluation,left(p_actor,200));
 RETURN to_jsonb(newrow);
END $$;
REVOKE ALL ON FUNCTION public.update_crm_customer_success(uuid,integer,uuid,text,text,text,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_crm_customer_success(uuid,integer,uuid,text,text,text,text,timestamptz,uuid) TO service_role;
CREATE FUNCTION public.claim_crm_cs_analysis(p_client uuid,p_event uuid) RETURNS public.crm_cs_evaluations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.crm_cs_evaluations; v integer;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM 1 FROM public.crm_clients WHERE id=p_client FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'client_unavailable'; END IF;
 SELECT * INTO r FROM public.crm_cs_evaluations WHERE event_id=p_event;
 IF FOUND THEN RAISE EXCEPTION 'analysis_already_requested'; END IF;
 UPDATE public.crm_cs_evaluations SET status='failed',limitation='Análise interrompida; resultado não confirmado.',completed_at=now() WHERE client_id=p_client AND status='analyzing' AND created_at<now()-interval '10 minutes';
 IF EXISTS(SELECT 1 FROM public.crm_cs_evaluations WHERE client_id=p_client AND status='analyzing') THEN RAISE EXCEPTION 'analysis_in_progress'; END IF;
 SELECT revision INTO v FROM public.crm_customer_success WHERE client_id=p_client;
 INSERT INTO public.crm_cs_evaluations(client_id,event_id,source_revision) VALUES(p_client,p_event,coalesce(v,0)) RETURNING * INTO r;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.claim_crm_cs_analysis(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crm_cs_analysis(uuid,uuid) TO service_role;