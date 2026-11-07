CREATE OR REPLACE FUNCTION public.convert_lead_to_client(p_actor text, p_lead uuid, p_status text, p_internal_responsible text, p_services text[], p_notes text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE l public.leads%ROWTYPE; new_id uuid; b record; doc text; resp text; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_status NOT IN ('implantacao','ativo','pausado','encerrado') THEN RAISE EXCEPTION 'invalid_client'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:clients',0));
  SELECT * INTO l FROM public.leads WHERE id=p_lead FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_clients WHERE lead_id=p_lead) THEN RAISE EXCEPTION 'already_client'; END IF;
  SELECT cnpj, profile INTO b FROM public.b2b_companies WHERE lead_id=p_lead LIMIT 1;
  doc := CASE WHEN b.cnpj ~ '^\d{14}$' AND NOT EXISTS (SELECT 1 FROM public.crm_clients WHERE cnpj=b.cnpj) THEN b.cnpj ELSE '' END;
  resp := nullif(btrim(coalesce(p_internal_responsible,'')),'');
  IF resp IS NULL THEN SELECT nullif(btrim(display_name),'') INTO resp FROM public.crm_profile WHERE company_key='crm:1'; END IF;
  INSERT INTO public.crm_clients(lead_id,trade_name,legal_name,cnpj,contact_name,phone,whatsapp,email,address,website,relationship_start,services,status,internal_responsible,notes,created_by)
  VALUES(p_lead,left(coalesce(nullif(l.company,''),nullif(b.profile->>'tradeName',''),nullif(b.profile->>'legalName',''),l.name),200),
    left(coalesce(b.profile->>'legalName',''),200), doc, left(coalesce(l.name,''),200), left(coalesce(b.profile->'phones'->>0,''),40),
    left(coalesce(l.whatsapp,''),40),left(coalesce(nullif(l.email,''),b.profile->'emails'->>0,''),200),left(coalesce(b.profile->>'address',''),500),
    left(coalesce(nullif(l.website,''),b.profile->>'website',''),500),current_date,coalesce(p_services,'{}'),p_status,left(coalesce(resp,''),160),left(coalesce(p_notes,''),5000),left(p_actor,160))
  RETURNING id INTO new_id;
  UPDATE public.leads SET history=coalesce(history,'[]'::jsonb)||jsonb_build_object('id','client:'||new_id||':converted','date',now(),'text','Contato convertido em cliente da Gravon Company.','kind','client_converted','source','clients','client',new_id,'responsible',left(p_actor,160)) WHERE id=p_lead;
  RETURN new_id;
END $function$;