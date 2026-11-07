-- The content of this migration cannot be applied: the pending-CNPJ schema and function already exist in the database. Retained below for isolated regression tests.
/*
-- Additive, original CRM only. Allow B2B companies with pending CNPJ, identified by Google place_id.
-- No existing lead is updated; reviewed/authorized requirements and duplicate prevention are preserved.
ALTER TABLE public.b2b_companies DROP CONSTRAINT b2b_companies_pkey;
ALTER TABLE public.b2b_companies DROP CONSTRAINT b2b_companies_cnpj_check;
ALTER TABLE public.b2b_companies ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.b2b_companies ADD CONSTRAINT b2b_companies_pkey PRIMARY KEY (id);
ALTER TABLE public.b2b_companies ADD CONSTRAINT b2b_companies_cnpj_check CHECK(cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$' OR cnpj = '');
CREATE UNIQUE INDEX b2b_companies_cnpj ON public.b2b_companies(cnpj) WHERE cnpj <> '';
COMMENT ON COLUMN public.b2b_companies.cnpj IS 'Empty means CNPJ pendente; the company is then identified only by place_id.';

CREATE OR REPLACE FUNCTION public.import_b2b_companies(p_pipeline uuid,p_companies jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE company_record jsonb; destination text := 'lead-novo'; existing_id uuid; new_id uuid; found_cnpj text; results jsonb := '[]';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_companies) IS DISTINCT FROM 'array' OR jsonb_array_length(p_companies) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid_batch'; END IF;
 IF p_pipeline IS NOT NULL THEN
   SELECT stages->0->>'id' INTO destination FROM sales_pipelines WHERE id=p_pipeline AND NOT archived FOR SHARE;
   IF destination IS NULL OR destination='' THEN RAISE EXCEPTION 'invalid_pipeline'; END IF;
 END IF;
 -- Coordinates with concurrent legacy CRM inserts as well as other B2B batches.
 LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;
 FOR company_record IN SELECT value FROM jsonb_array_elements(p_companies) LOOP
   IF (company_record->>'identityConfirmed') IS DISTINCT FROM 'true' OR (company_record->>'storageAuthorized') IS DISTINCT FROM 'true'
     OR coalesce(company_record->>'source','') NOT IN ('manual','deskdata')
     OR NOT (coalesce(company_record->>'cnpj','') ~ '^[A-Z0-9]{12}[0-9]{2}$'
       OR (coalesce(company_record->>'cnpj','') = '' AND coalesce(company_record->>'placeId','') <> ''))
     OR char_length(coalesce(company_record->>'legalName','')) NOT BETWEEN 2 AND 300
     OR char_length(coalesce(company_record->>'sourceReference','')) NOT BETWEEN 3 AND 500
     OR octet_length(company_record::text)>20000 THEN RAISE EXCEPTION 'unreviewed_company'; END IF;
   existing_id := NULL; found_cnpj := NULL;
   SELECT cnpj,lead_id INTO found_cnpj,existing_id FROM b2b_companies
     WHERE (company_record->>'cnpj' <> '' AND cnpj=company_record->>'cnpj')
       OR (place_id<>'' AND place_id=company_record->>'placeId') LIMIT 1;
   IF found_cnpj IS NOT NULL THEN
     results:=results||jsonb_build_array(jsonb_build_object('cnpj',company_record->>'cnpj','status','duplicate','leadId',existing_id)); CONTINUE;
   END IF;
   SELECT l.id INTO existing_id FROM leads l WHERE
     (l.email<>'' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(company_record->'emails') e WHERE lower(btrim(l.email))=lower(btrim(e)))) OR
     (l.whatsapp<>'' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(company_record->'phones') p WHERE regexp_replace(l.whatsapp,'[^0-9]','','g')=regexp_replace(p,'[^0-9]','','g')))
     LIMIT 1;
   IF existing_id IS NOT NULL THEN
     results:=results||jsonb_build_array(jsonb_build_object('cnpj',company_record->>'cnpj','status','duplicate','leadId',existing_id)); CONTINUE;
   END IF;
   INSERT INTO leads(name,company,whatsapp,email,website,source,service,entry_date,status,stage,pipeline_id,next_action,notes,history)
   VALUES(coalesce(nullif(company_record->>'tradeName',''),company_record->>'legalName'),company_record->>'legalName',
     coalesce(company_record->'phones'->>0,''),coalesce(company_record->'emails'->>0,''),coalesce(company_record->>'website',''),
     'Prospecção B2B',coalesce(company_record->>'segment',''),current_date,'Aguardando primeiro contato',destination,p_pipeline,'Revisar abordagem por e-mail',
     concat_ws(E'\n','CNPJ: '||coalesce(nullif(company_record->>'cnpj',''),'Pendente'),'Localização: '||coalesce(company_record->>'city','')||' / '||coalesce(company_record->>'state',''),
       'Endereço: '||coalesce(company_record->>'address',''),'Fonte autorizada: '||(company_record->>'sourceReference')),
     jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'date',now(),'text','Importado após revisão pela Prospecção B2B. Nenhum contato enviado.','source','b2b')))
   RETURNING id INTO new_id;
   INSERT INTO b2b_companies(cnpj,lead_id,place_id,profile) VALUES(coalesce(company_record->>'cnpj',''),new_id,coalesce(company_record->>'placeId',''),company_record - 'identityConfirmed' - 'storageAuthorized');
   results:=results||jsonb_build_array(jsonb_build_object('cnpj',company_record->>'cnpj','status','created','leadId',new_id));
 END LOOP;
 RETURN results;
END $$;
REVOKE ALL ON FUNCTION public.import_b2b_companies(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_b2b_companies(uuid,jsonb) TO service_role;

*/
