CREATE OR REPLACE FUNCTION public.update_crm_cs_management(p_client uuid, p_revision integer, p_event uuid, p_actor text, p_management jsonb, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE oldrow public.crm_customer_success;newrow public.crm_customer_success;prior public.crm_cs_history;c jsonb;k text;v jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden';END IF;
 IF length(btrim(coalesce(p_actor,''))) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 3000 OR jsonb_typeof(p_management) IS DISTINCT FROM 'object' OR octet_length(p_management::text)>250000 THEN RAISE EXCEPTION 'invalid_management';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_management) x WHERE x NOT IN ('accountStatus','commercialStatus','nextFollowup','contracts','criteria','strategic')) THEN RAISE EXCEPTION 'invalid_management';END IF;
 IF p_management ? 'strategic' AND p_management->'strategic'<>'null'::jsonb THEN
  IF jsonb_typeof(p_management->'strategic') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_management->'strategic') x WHERE x NOT IN ('relationship','demand','expansion','note','directCostCents','evaluatedAt')) THEN RAISE EXCEPTION 'invalid_strategic';END IF;
  IF p_management->'strategic'->>'relationship' IS NOT NULL AND p_management->'strategic'->>'relationship' NOT IN ('boa','regular','dificil') THEN RAISE EXCEPTION 'invalid_strategic';END IF;
  IF p_management->'strategic'->>'demand' IS NOT NULL AND p_management->'strategic'->>'demand' NOT IN ('baixo','medio','alto') THEN RAISE EXCEPTION 'invalid_strategic';END IF;
  IF p_management->'strategic'->>'expansion' IS NOT NULL AND p_management->'strategic'->>'expansion' NOT IN ('baixo','medio','alto') THEN RAISE EXCEPTION 'invalid_strategic';END IF;
  IF length(coalesce(p_management->'strategic'->>'note',''))>2000 THEN RAISE EXCEPTION 'invalid_strategic';END IF;
  IF p_management->'strategic'->>'directCostCents' IS NOT NULL AND (p_management->'strategic'->>'directCostCents')::bigint NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'invalid_strategic';END IF;
  IF p_management->'strategic'->>'evaluatedAt' IS NOT NULL AND (p_management->'strategic'->>'evaluatedAt')::timestamptz>now()+interval '1 minute' THEN RAISE EXCEPTION 'invalid_strategic';END IF;
 END IF;
 IF p_management->>'accountStatus' IS NOT NULL AND p_management->>'accountStatus' NOT IN ('novo','onboarding','implementacao','ativo','pausado','inadimplente','encerrado') THEN RAISE EXCEPTION 'invalid_status';END IF;
 IF p_management->>'commercialStatus' IS NOT NULL AND p_management->>'commercialStatus' NOT IN ('saudavel','crescimento','upsell','cross_sell','revisar','recorrencia_queda','inatividade','cancelamento') THEN RAISE EXCEPTION 'invalid_status';END IF;
 IF p_management->>'nextFollowup' IS NOT NULL THEN PERFORM (p_management->>'nextFollowup')::date;END IF;
 IF jsonb_typeof(p_management->'contracts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_management->'contracts')>100 OR jsonb_typeof(p_management->'criteria') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_management';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_management->'contracts') x GROUP BY x->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate_contract';END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_management->'contracts') LOOP
  PERFORM (c->>'id')::uuid;
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR length(coalesce(c->>'title','')) NOT BETWEEN 2 AND 200 OR (c->>'amountCents')::bigint NOT BETWEEN 0 AND 1000000000 OR c->>'billing' NOT IN ('semanal','quinzenal','bimensal','mensal','trimestral','semestral','anual','personalizada','unico') OR (c->>'billingMonths')::integer NOT BETWEEN 1 AND 120 OR c->>'status' NOT IN ('ativo','pausado','renovado','prorrogado','renegociado','cancelado','encerrado') THEN RAISE EXCEPTION 'invalid_contract';END IF;
  IF c->>'kind' IS NOT NULL AND c->>'kind' NOT IN ('contrato_formal','servico_sem_contrato','recorrente_indeterminado','pontual') THEN RAISE EXCEPTION 'invalid_contract';END IF;
  IF c->>'billingDays' IS NOT NULL AND (c->>'billingDays')::integer NOT BETWEEN 1 AND 3660 THEN RAISE EXCEPTION 'invalid_contract';END IF;
  IF c->>'indefinite' IS NOT NULL AND jsonb_typeof(c->'indefinite')<>'boolean' THEN RAISE EXCEPTION 'invalid_contract';END IF;
  IF c->>'nextCharge' IS NOT NULL THEN PERFORM (c->>'nextCharge')::date;END IF;
  IF c->>'start' IS NOT NULL THEN PERFORM (c->>'start')::date;END IF;
  IF c->>'renewal' IS NOT NULL THEN PERFORM (c->>'renewal')::date;END IF;
  IF c->>'start' IS NOT NULL AND c->>'renewal' IS NOT NULL AND (c->>'renewal')::date<(c->>'start')::date THEN RAISE EXCEPTION 'invalid_contract_dates';END IF;
 END LOOP;
 FOR k,v IN SELECT key,value FROM jsonb_each(p_management->'criteria') LOOP
  IF k NOT IN ('satisfaction','finance','engagement','results','contract') THEN RAISE EXCEPTION 'invalid_criterion';END IF;
  IF v<>'null'::jsonb THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR (v->>'value')::numeric NOT BETWEEN 0 AND 100 OR length(btrim(coalesce(v->>'reason','')))<3 OR length(btrim(coalesce(v->>'source','')))<3 THEN RAISE EXCEPTION 'invalid_criterion';END IF;
   IF (v->>'evaluatedAt')::timestamptz>now()+interval '1 minute' THEN RAISE EXCEPTION 'invalid_criterion_date';END IF;
  END IF;
 END LOOP;
 PERFORM 1 FROM public.crm_clients WHERE id=p_client FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'client_unavailable';END IF;
 SELECT * INTO prior FROM public.crm_cs_history WHERE event_id=p_event;
 IF FOUND THEN IF prior.client_id<>p_client OR prior.after_state->'management' IS DISTINCT FROM p_management OR prior.actor<>p_actor THEN RAISE EXCEPTION 'event_mismatch';END IF;RETURN prior.after_state;END IF;
 INSERT INTO public.crm_customer_success(client_id) VALUES(p_client) ON CONFLICT DO NOTHING;
 SELECT * INTO oldrow FROM public.crm_customer_success WHERE client_id=p_client FOR UPDATE;
 IF oldrow.revision<>p_revision THEN RAISE EXCEPTION 'cs_changed';END IF;
 UPDATE public.crm_customer_success SET management=p_management,revision=revision+1,updated_at=now() WHERE client_id=p_client RETURNING * INTO newrow;
 INSERT INTO public.crm_cs_history(client_id,event_id,kind,before_state,after_state,note,actor) VALUES(p_client,p_event,'manual',to_jsonb(oldrow),to_jsonb(newrow),p_note,p_actor);
 RETURN to_jsonb(newrow);
END $function$;