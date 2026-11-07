-- Enriquecimento automático da prospecção Instagram: investigação do perfil, do site e análise IA por etapas.
-- Aditiva: nenhum dado existente é alterado; tabelas continuam privadas service-only.

ALTER TABLE public.b2b_instagram_profiles
  ADD COLUMN whatsapp text NOT NULL DEFAULT '',
  ADD COLUMN address text NOT NULL DEFAULT '',
  ADD COLUMN country text NOT NULL DEFAULT '',
  ADD COLUMN cnpj text NOT NULL DEFAULT '',
  ADD COLUMN enrichment text NOT NULL DEFAULT 'pendente'
    CHECK (enrichment IN ('pendente','perfil','site','concluido','falhou'));
COMMENT ON COLUMN public.b2b_instagram_profiles.whatsapp IS 'WhatsApp comercial público (wa.me na biografia ou no site da própria empresa). Nunca inferido.';
COMMENT ON COLUMN public.b2b_instagram_profiles.cnpj IS 'CNPJ publicado no site da própria empresa, validado por dígitos verificadores. Vazio quando não identificado.';
COMMENT ON COLUMN public.b2b_instagram_profiles.enrichment IS 'Etapa do enriquecimento: pendente, perfil (detalhes Apify), site (leitura pública gratuita), concluido ou falhou.';

ALTER TABLE public.b2b_instagram_searches
  ADD COLUMN stage text NOT NULL DEFAULT 'publicacoes'
    CHECK (stage IN ('publicacoes','perfis','sites','ia','concluido'));
COMMENT ON COLUMN public.b2b_instagram_searches.stage IS 'Etapa atual da pesquisa: publicacoes, perfis, sites, ia ou concluido. Somente andamento, sem conteúdo.';

-- Importação revisada: a origem Instagram pode trazer um CNPJ válido encontrado no site da própria empresa
-- (dedupe por CNPJ passa a valer também para essa origem). Razão social oficial continua nunca inventada:
-- para Instagram, o nome de exibição do perfil permanece em tradeName mesmo com CNPJ.
CREATE OR REPLACE FUNCTION public.import_b2b_companies(p_pipeline uuid, p_companies jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE company_record jsonb; destination text := 'lead-novo'; existing_id uuid; new_id uuid; found_cnpj text; results jsonb := '[]';
  is_list boolean; has_place boolean; is_instagram boolean; nm text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_companies) IS DISTINCT FROM 'array' OR jsonb_array_length(p_companies) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid_batch'; END IF;
 IF p_pipeline IS NOT NULL THEN
   SELECT stages->0->>'id' INTO destination FROM sales_pipelines WHERE id=p_pipeline AND NOT archived FOR SHARE;
   IF destination IS NULL OR destination='' THEN RAISE EXCEPTION 'invalid_pipeline'; END IF;
 END IF;
 LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;
 FOR company_record IN SELECT value FROM jsonb_array_elements(p_companies) LOOP
   has_place := coalesce(company_record->>'placeId','') <> '';
   -- Imported e-mail list: no CNPJ/place; requires company name + at least one e-mail.
   is_list := coalesce(company_record->>'source','') = 'lista' AND coalesce(company_record->>'cnpj','') = '' AND NOT has_place
     AND jsonb_typeof(company_record->'emails') = 'array' AND jsonb_array_length(company_record->'emails') > 0;
   -- Instagram prospecting: no place; requires the public profile URL. CNPJ is optional (found on the company's own site).
   is_instagram := coalesce(company_record->>'source','') = 'instagram' AND NOT has_place
     AND coalesce(company_record->>'instagram','') ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9_.]{1,30}/?$';
   IF (company_record->>'identityConfirmed') IS DISTINCT FROM 'true' OR (company_record->>'storageAuthorized') IS DISTINCT FROM 'true'
     OR coalesce(company_record->>'source','') NOT IN ('manual','deskdata','lista','instagram')
     OR NOT (coalesce(company_record->>'cnpj','') ~ '^[A-Z0-9]{12}[0-9]{2}$'
       OR (coalesce(company_record->>'cnpj','') = '' AND (has_place OR is_list OR is_instagram)))
     OR NOT (char_length(btrim(coalesce(company_record->>'legalName',''))) BETWEEN 2 AND 300
       OR (coalesce(company_record->>'legalName','') = ''
         AND char_length(btrim(coalesce(company_record->>'tradeName',''))) BETWEEN 2 AND 300
         AND (is_instagram OR (coalesce(company_record->>'cnpj','') = '' AND (has_place OR is_list)))))
     OR char_length(coalesce(company_record->>'sourceReference','')) NOT BETWEEN 3 AND 500
     OR octet_length(company_record::text)>20000 THEN RAISE EXCEPTION 'unreviewed_company'; END IF;
   existing_id := NULL; found_cnpj := NULL;
   SELECT cnpj,lead_id INTO found_cnpj,existing_id FROM b2b_companies
     WHERE (company_record->>'cnpj' <> '' AND cnpj=company_record->>'cnpj')
       OR (place_id<>'' AND place_id=company_record->>'placeId')
       OR (is_instagram AND lower(coalesce(profile->>'instagram',''))=lower(company_record->>'instagram')) LIMIT 1;
   IF found_cnpj IS NOT NULL THEN
     results:=results||jsonb_build_array(jsonb_build_object('cnpj',company_record->>'cnpj','status','duplicate','leadId',existing_id)); CONTINUE;
   END IF;
   nm := lower(btrim(coalesce(nullif(company_record->>'tradeName',''),company_record->>'legalName','')));
   SELECT l.id INTO existing_id FROM leads l WHERE
     (l.email<>'' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(company_record->'emails') e WHERE lower(btrim(l.email))=lower(btrim(e)))) OR
     (l.whatsapp<>'' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(company_record->'phones') p WHERE regexp_replace(l.whatsapp,'[^0-9]','','g')=regexp_replace(p,'[^0-9]','','g'))) OR
     (is_list AND nm <> '' AND (lower(btrim(l.name))=nm OR lower(btrim(l.company))=nm)) OR
     (is_instagram AND l.instagram<>'' AND lower(btrim(l.instagram))=lower(btrim(company_record->>'instagram')))
     LIMIT 1;
   IF existing_id IS NOT NULL THEN
     results:=results||jsonb_build_array(jsonb_build_object('cnpj',company_record->>'cnpj','status','duplicate','leadId',existing_id)); CONTINUE;
   END IF;
   INSERT INTO leads(name,company,whatsapp,email,website,instagram,source,service,entry_date,status,stage,pipeline_id,next_action,notes,history)
   VALUES(coalesce(nullif(company_record->>'tradeName',''),company_record->>'legalName'),coalesce(company_record->>'legalName',''),
     coalesce(company_record->'phones'->>0,''),coalesce(company_record->'emails'->>0,''),coalesce(company_record->>'website',''),coalesce(company_record->>'instagram',''),
     CASE WHEN is_instagram THEN 'Instagram - Apify' ELSE 'Prospecção B2B' END,coalesce(company_record->>'segment',''),current_date,'Aguardando primeiro contato',destination,p_pipeline,'Revisar abordagem por e-mail',
     concat_ws(E'\n','CNPJ: '||coalesce(nullif(company_record->>'cnpj',''),'Pendente'),'Localização: '||coalesce(company_record->>'city','')||' / '||coalesce(company_record->>'state',''),
       'Endereço: '||coalesce(company_record->>'address',''),
       CASE WHEN jsonb_array_length(coalesce(company_record->'emails','[]'))>1 THEN 'E-mails: '||(SELECT string_agg(e,', ') FROM jsonb_array_elements_text(company_record->'emails') e) END,
       'Responsável: '||nullif(btrim(concat_ws(' · ',nullif(company_record->>'contactName',''),nullif(company_record->>'contactRole',''))),''),
       'Observações: '||nullif(company_record->>'notes',''),
       'Fonte autorizada: '||(company_record->>'sourceReference')),
     jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'date',now(),'text',CASE WHEN is_instagram THEN 'Importado da prospecção Instagram (Apify) após revisão pela Prospecção B2B. Nenhum contato enviado.' WHEN is_list THEN 'Importado de lista de e-mails após revisão pela Prospecção B2B. Nenhum contato enviado.' ELSE 'Importado após revisão pela Prospecção B2B. Nenhum contato enviado.' END,'source','b2b')))
   RETURNING id INTO new_id;
   INSERT INTO b2b_companies(cnpj,lead_id,place_id,profile) VALUES(coalesce(company_record->>'cnpj',''),new_id,coalesce(company_record->>'placeId',''),company_record - 'identityConfirmed' - 'storageAuthorized');
   results:=results||jsonb_build_array(jsonb_build_object('cnpj',company_record->>'cnpj','status','created','leadId',new_id));
 END LOOP;
 RETURN results;
END $function$;
REVOKE ALL ON FUNCTION public.import_b2b_companies(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_b2b_companies(uuid,jsonb) TO service_role;