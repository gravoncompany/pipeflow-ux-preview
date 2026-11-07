-- Additive, original CRM only. Apply to an isolated preview database first.
-- No existing lead is updated, no queue/trigger/email sender is installed.
CREATE TABLE public.b2b_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL CHECK(provider IN ('google','deskdata','deskdata_balance')),
 outcome text NOT NULL DEFAULT 'reserved' CHECK(outcome IN ('reserved','success','failed')),
 credit_balance integer CHECK(credit_balance >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX b2b_requests_budget ON public.b2b_requests(provider,created_at);
CREATE TABLE public.b2b_companies (
 cnpj text PRIMARY KEY CHECK(cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
 lead_id uuid UNIQUE REFERENCES public.leads(id) ON DELETE SET NULL,
 place_id text NOT NULL DEFAULT '', profile jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX b2b_companies_place ON public.b2b_companies(place_id) WHERE place_id <> '';
CREATE TABLE public.b2b_email_suppressions (
 email text PRIMARY KEY CHECK(email=lower(btrim(email))), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.b2b_email_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
 recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
 state text NOT NULL CHECK(state IN ('draft','reviewed')), created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.b2b_email_drafts IS 'Preparation only. No provider dispatch; reviewed does not mean sent. A future sender must recheck suppression and explicit confirmation.';
COMMENT ON COLUMN public.b2b_requests.credit_balance IS 'Provider-reported balance at observation time. NULL is unknown, never zero cost. No per-query price is inferred.';
COMMENT ON TABLE public.b2b_companies IS 'Only independently sourced, reviewed and storage-authorized company data. No Google Places response payload; place_id is the only retained Google identifier.';
ALTER TABLE public.b2b_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_email_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_email_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.b2b_requests,public.b2b_companies,public.b2b_email_drafts,public.b2b_email_suppressions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.b2b_requests,public.b2b_companies,public.b2b_email_drafts,public.b2b_email_suppressions TO service_role;

CREATE FUNCTION public.reserve_b2b_request(p_provider text,p_daily_limit integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
 IF p_provider NOT IN ('google','deskdata','deskdata_balance') OR p_provider IS NULL OR p_daily_limit IS NULL OR p_daily_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_budget'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('b2b-budget:'||p_provider));
 IF EXISTS(SELECT 1 FROM b2b_requests WHERE provider=p_provider AND created_at>clock_timestamp()-interval '5 seconds') THEN RAISE EXCEPTION 'b2b_cooldown'; END IF;
 IF (SELECT count(*) FROM b2b_requests WHERE provider=p_provider AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=p_daily_limit THEN RAISE EXCEPTION 'b2b_daily_limit'; END IF;
 INSERT INTO b2b_requests(provider) VALUES(p_provider) RETURNING id INTO request_id;
 RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_b2b_request(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_b2b_request(text,integer) TO service_role;

CREATE FUNCTION public.import_b2b_companies(p_pipeline uuid,p_companies jsonb) RETURNS jsonb
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
     OR coalesce(company_record->>'cnpj','') !~ '^[A-Z0-9]{12}[0-9]{2}$'
     OR char_length(coalesce(company_record->>'legalName','')) NOT BETWEEN 2 AND 300
     OR char_length(coalesce(company_record->>'sourceReference','')) NOT BETWEEN 3 AND 500
     OR octet_length(company_record::text)>20000 THEN RAISE EXCEPTION 'unreviewed_company'; END IF;
   existing_id := NULL; found_cnpj := NULL;
   SELECT cnpj,lead_id INTO found_cnpj,existing_id FROM b2b_companies
     WHERE cnpj=company_record->>'cnpj' OR (place_id<>'' AND place_id=company_record->>'placeId') LIMIT 1;
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
     concat_ws(E'\n','CNPJ: '||(company_record->>'cnpj'),'Localização: '||coalesce(company_record->>'city','')||' / '||coalesce(company_record->>'state',''),
       'Endereço: '||coalesce(company_record->>'address',''),'Fonte autorizada: '||(company_record->>'sourceReference')),
     jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'date',now(),'text','Importado após revisão pela Prospecção B2B. Nenhum contato enviado.','source','b2b')))
   RETURNING id INTO new_id;
   INSERT INTO b2b_companies(cnpj,lead_id,place_id,profile) VALUES(company_record->>'cnpj',new_id,coalesce(company_record->>'placeId',''),company_record - 'identityConfirmed' - 'storageAuthorized');
   results:=results||jsonb_build_array(jsonb_build_object('cnpj',company_record->>'cnpj','status','created','leadId',new_id));
 END LOOP;
 RETURN results;
END $$;
REVOKE ALL ON FUNCTION public.import_b2b_companies(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_b2b_companies(uuid,jsonb) TO service_role;
