ALTER TABLE public.gravon_ai_test_settings ADD COLUMN crm_read_enabled boolean NOT NULL DEFAULT false, ADD COLUMN crm_read_instance text NOT NULL DEFAULT '', ADD COLUMN crm_read_phone text NOT NULL DEFAULT '', ADD COLUMN crm_read_revision text NOT NULL DEFAULT '';

CREATE FUNCTION public.gravon_require_read_grant(p_instance text, p_phone text, p_revision text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.gravon_ai_test_settings s WHERE s.id=1 AND s.enabled AND s.crm_read_enabled AND s.crm_read_instance=p_instance AND s.crm_read_phone=p_phone AND s.crm_read_revision=p_revision AND length(p_revision)>0) THEN RAISE EXCEPTION 'CRM read authorization unavailable' USING ERRCODE='42501'; END IF;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.gravon_require_read_grant(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_require_read_grant(text,text,text) TO service_role;

CREATE FUNCTION public.gravon_count_leads(p_instance text, p_phone text, p_revision text, p_stage text DEFAULT NULL, p_start date DEFAULT NULL, p_end date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.gravon_require_read_grant(p_instance,p_phone,p_revision);
 IF p_stage IS NOT NULL AND p_stage <> ALL(ARRAY['lead-novo','tentando-contato','contato-realizado','retornar-mais-tarde','primeira-ligacao','segunda-ligacao','terceira-ligacao','qualificacao','mql','sql','reuniao-agendada','aguardando-decisao','fechado','perda']) THEN RAISE EXCEPTION 'Unknown stage'; END IF;
 IF p_start IS NOT NULL AND p_end IS NOT NULL AND p_start>p_end THEN RAISE EXCEPTION 'Invalid period'; END IF;
 SELECT jsonb_build_object('total',coalesce(sum(t.quantity),0),'stages',coalesce(jsonb_agg(jsonb_build_object('stage',t.stage,'count',t.quantity) ORDER BY t.stage),'[]'::jsonb)) INTO result FROM (SELECT l.stage,count(*) quantity FROM public.leads l WHERE (p_stage IS NULL OR l.stage=p_stage) AND (p_start IS NULL OR l.entry_date>=p_start) AND (p_end IS NULL OR l.entry_date<=p_end) GROUP BY l.stage) t;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.gravon_count_leads(text,text,text,text,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_count_leads(text,text,text,text,date,date) TO service_role;

CREATE FUNCTION public.gravon_lookup_lead(p_instance text, p_phone text, p_revision text, p_field text, p_query text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; needle text;
BEGIN
 PERFORM public.gravon_require_read_grant(p_instance,p_phone,p_revision);
 IF p_field NOT IN ('name','company','phone','id') OR p_field IS NULL OR length(btrim(coalesce(p_query,'')))<2 OR length(p_query)>160 THEN RAISE EXCEPTION 'Invalid lookup'; END IF;
 needle:=btrim(p_query);
 IF p_field='phone' THEN
  needle:=regexp_replace(split_part(needle,'@',1),'[^0-9]','','g');
  IF length(needle) IN (10,11) THEN needle:='55'||needle; END IF;
  IF needle !~ '^[0-9]{10,15}$' THEN RAISE EXCEPTION 'Invalid phone'; END IF;
 END IF;
 WITH candidates AS (
  SELECT l.id,l.name,l.company,l.stage,l.service,l.source,l.next_action,l.next_action_date FROM public.leads l
  WHERE (p_field='name' AND lower(btrim(l.name))=lower(needle)) OR (p_field='company' AND lower(btrim(l.company))=lower(needle)) OR (p_field='id' AND l.id::text=needle) OR (p_field='phone' AND (
   CASE WHEN length(regexp_replace(l.whatsapp,'[^0-9]','','g')) IN (10,11) THEN '55'||regexp_replace(l.whatsapp,'[^0-9]','','g') ELSE regexp_replace(l.whatsapp,'[^0-9]','','g') END = needle
   OR (needle ~ '^55[1-9][0-9]9[6-9][0-9]{7}$' AND regexp_replace(l.whatsapp,'[^0-9]','','g') IN (substring(needle from 1 for 4)||substring(needle from 6),substring(needle from 3 for 2)||substring(needle from 6)))
   OR (needle ~ '^55[1-9][0-9][6-9][0-9]{7}$' AND regexp_replace(l.whatsapp,'[^0-9]','','g') IN (substring(needle from 1 for 4)||'9'||substring(needle from 5),substring(needle from 3 for 2)||'9'||substring(needle from 5)))
  )) ORDER BY l.id LIMIT 6
 ), numbered AS (SELECT c.*,count(*) OVER() matches FROM candidates c)
 SELECT jsonb_build_object('ambiguous',coalesce(max(n.matches),0)>1,'hasMore',coalesce(max(n.matches),0)>5,'leads',coalesce(jsonb_agg(CASE WHEN n.matches>1 THEN jsonb_build_object('id',n.id,'name',left(n.name,120),'company',left(n.company,120)) ELSE jsonb_build_object('id',n.id,'name',left(n.name,120),'company',left(n.company,120),'stage',n.stage,'service',left(n.service,160),'source',left(n.source,120),'nextAction',left(n.next_action,200),'nextActionDate',n.next_action_date) END),'[]'::jsonb)) INTO result FROM (SELECT * FROM numbered LIMIT 5) n;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.gravon_lookup_lead(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_lookup_lead(text,text,text,text,text) TO service_role;