ALTER TABLE public.gravon_ai_test_settings ADD COLUMN crm_finance_enabled boolean NOT NULL DEFAULT false, ADD COLUMN crm_finance_instance text NOT NULL DEFAULT '', ADD COLUMN crm_finance_phone text NOT NULL DEFAULT '', ADD COLUMN crm_finance_revision text NOT NULL DEFAULT '', ADD COLUMN crm_finance_read_revision text NOT NULL DEFAULT '', ADD COLUMN crm_finance_authorized_phone text NOT NULL DEFAULT '';
CREATE FUNCTION public.gravon_require_finance_grant(p_instance text,p_phone text,p_revision text,p_finance_revision text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.gravon_require_read_grant(p_instance,p_phone,p_revision);
 IF NOT EXISTS(SELECT 1 FROM public.gravon_ai_test_settings s WHERE s.id=1 AND s.crm_finance_enabled AND s.crm_finance_instance=p_instance AND s.crm_finance_phone=p_phone AND s.crm_finance_revision=p_finance_revision AND length(p_finance_revision)>0 AND s.crm_finance_read_revision=p_revision AND s.crm_finance_authorized_phone=s.authorized_phone) THEN RAISE EXCEPTION 'Financial authorization unavailable' USING ERRCODE='42501'; END IF; RETURN true; END; $$;
REVOKE ALL ON FUNCTION public.gravon_require_finance_grant(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_require_finance_grant(text,text,text,text) TO service_role;
CREATE FUNCTION public.gravon_sales_summary(p_instance text,p_phone text,p_revision text,p_finance_revision text,p_start date,p_end date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE r jsonb; BEGIN
 PERFORM public.gravon_require_finance_grant(p_instance,p_phone,p_revision,p_finance_revision);
 IF p_start IS NULL OR p_end IS NULL OR p_start>p_end THEN RAISE EXCEPTION 'Explicit period required'; END IF;
 SELECT jsonb_build_object('count',count(*),'potentialValue',coalesce(sum(l.potential_value),0),'missing',count(*) FILTER(WHERE l.potential_value IS NULL OR l.potential_value=0)) INTO r FROM public.leads l WHERE l.stage='fechado' AND l.entry_date BETWEEN p_start AND p_end; RETURN r; END; $$;
REVOKE ALL ON FUNCTION public.gravon_sales_summary(text,text,text,text,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_sales_summary(text,text,text,text,date,date) TO service_role;
CREATE FUNCTION public.gravon_closed_value(p_instance text,p_phone text,p_revision text,p_finance_revision text,p_field text,p_query text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE r jsonb; l public.leads; BEGIN
 PERFORM public.gravon_require_finance_grant(p_instance,p_phone,p_revision,p_finance_revision);
 r:=public.gravon_lookup_lead(p_instance,p_phone,p_revision,p_field,p_query);
 IF (r->>'ambiguous')::boolean OR jsonb_array_length(r->'leads')<>1 THEN RETURN r; END IF;
 SELECT * INTO l FROM public.leads WHERE id=(r->'leads'->0->>'id')::uuid;
 RETURN jsonb_build_object('ambiguous',false,'hasMore',false,'leads',jsonb_build_array(jsonb_build_object('id',l.id,'name',left(l.name,120),'company',left(l.company,120),'closed',l.stage='fechado','potentialValue',CASE WHEN l.stage='fechado' AND l.potential_value<>0 THEN l.potential_value ELSE NULL END)));
 END; $$;
REVOKE ALL ON FUNCTION public.gravon_closed_value(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_closed_value(text,text,text,text,text,text) TO service_role;