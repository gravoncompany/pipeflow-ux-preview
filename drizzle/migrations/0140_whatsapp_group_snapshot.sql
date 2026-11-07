CREATE TABLE public.crm_whatsapp_group_snapshots (
 company_key text NOT NULL, instance text NOT NULL, binding_phone text NOT NULL,
 groups jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(groups)='array'),
 synced_at timestamptz, lease_token uuid, lease_until timestamptz, error_code text,
 PRIMARY KEY(company_key,instance,binding_phone)
);
GRANT ALL ON public.crm_whatsapp_group_snapshots TO service_role;
ALTER TABLE public.crm_whatsapp_group_snapshots ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.claim_whatsapp_group_sync(p_company text,p_instance text,p_phone text,p_token uuid,p_force boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_company IS DISTINCT FROM 'crm:1' OR p_token IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE company_key=p_company AND instance=p_instance AND canonical_phone=p_phone)
 OR EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE instance=p_instance AND (company_key<>p_company OR canonical_phone<>p_phone)) THEN RAISE EXCEPTION 'binding_changed'; END IF;
 INSERT INTO public.crm_whatsapp_group_snapshots(company_key,instance,binding_phone) VALUES(p_company,p_instance,p_phone) ON CONFLICT DO NOTHING;
 UPDATE public.crm_whatsapp_group_snapshots SET lease_token=p_token,lease_until=now()+interval '3 minutes',error_code=NULL
 WHERE company_key=p_company AND instance=p_instance AND binding_phone=p_phone AND (lease_until IS NULL OR lease_until<now()) AND (p_force OR synced_at IS NULL OR synced_at<now()-interval '5 minutes');
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.finish_whatsapp_group_sync(p_company text,p_instance text,p_phone text,p_token uuid,p_groups jsonb,p_error text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_error IS NULL AND (p_groups IS NULL OR jsonb_typeof(p_groups)<>'array' OR jsonb_array_length(p_groups)>10000 OR octet_length(p_groups::text)>8000000) THEN RAISE EXCEPTION 'invalid_groups'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE company_key=p_company AND instance=p_instance AND canonical_phone=p_phone)
 OR EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE instance=p_instance AND (company_key<>p_company OR canonical_phone<>p_phone)) THEN RAISE EXCEPTION 'binding_changed'; END IF;
 UPDATE public.crm_whatsapp_group_snapshots SET groups=CASE WHEN p_error IS NULL THEN p_groups ELSE groups END,synced_at=CASE WHEN p_error IS NULL THEN now() ELSE synced_at END,lease_token=NULL,lease_until=NULL,error_code=left(p_error,80)
 WHERE company_key=p_company AND instance=p_instance AND binding_phone=p_phone AND lease_token=p_token AND lease_until>now();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_whatsapp_group_sync(text,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_whatsapp_group_sync(text,text,text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_group_sync(text,text,text,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_whatsapp_group_sync(text,text,text,uuid,jsonb,text) TO service_role;