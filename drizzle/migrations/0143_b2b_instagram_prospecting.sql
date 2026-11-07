-- Prospecção B2B pelo Instagram via Apify. Aditiva: nenhum lead, empresa ou integração existente é alterado.
-- Pesquisas e perfis ficam em tabelas privadas service-only; nenhum envio de mensagem é criado aqui.

CREATE TABLE public.b2b_instagram_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hashtags text[] NOT NULL,
  results_limit integer NOT NULL CHECK (results_limit BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','canceled')),
  runs jsonb NOT NULL DEFAULT '[]',
  posts_found integer NOT NULL DEFAULT 0 CHECK (posts_found >= 0),
  profiles_found integer NOT NULL DEFAULT 0 CHECK (profiles_found >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
COMMENT ON TABLE public.b2b_instagram_searches IS 'Histórico privado das pesquisas de hashtags via Apify. runs guarda somente identificadores de execução/status, nunca conteúdo de posts.';
COMMENT ON COLUMN public.b2b_instagram_searches.runs IS 'Lista de {hashtag, runId, datasetId, status}; identificadores técnicos da Apify, sem dados de perfis.';

CREATE TABLE public.b2b_instagram_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES public.b2b_instagram_searches(id) ON DELETE CASCADE,
  username text NOT NULL,
  ig_user_id text NOT NULL DEFAULT '',
  full_name text NOT NULL DEFAULT '',
  biography text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  external_url text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  hashtag text NOT NULL DEFAULT '',
  post_url text NOT NULL DEFAULT '',
  followers integer CHECK (followers IS NULL OR followers >= 0),
  is_business boolean,
  ai_segment text NOT NULL DEFAULT '',
  ai_location text NOT NULL DEFAULT '',
  ai_relevance text NOT NULL DEFAULT '',
  ai_commercial boolean,
  ai_summary text NOT NULL DEFAULT '',
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (search_id, username)
);
COMMENT ON TABLE public.b2b_instagram_profiles IS 'Perfis públicos únicos por pesquisa, com contatos públicos extraídos da biografia e análise IA revisável. Nada aqui autoriza envio de mensagens.';
CREATE INDEX b2b_instagram_profiles_username ON public.b2b_instagram_profiles(username);

ALTER TABLE public.b2b_instagram_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_instagram_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.b2b_instagram_searches, public.b2b_instagram_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.b2b_instagram_searches, public.b2b_instagram_profiles TO service_role;

-- Controle de consumo passa a aceitar o provedor Apify (mesma reserva diária e intervalo mínimo).
ALTER TABLE public.b2b_requests DROP CONSTRAINT b2b_requests_provider_check;
ALTER TABLE public.b2b_requests ADD CONSTRAINT b2b_requests_provider_check CHECK (provider IN ('google','deskdata','deskdata_balance','apify'));

CREATE OR REPLACE FUNCTION public.reserve_b2b_request(p_provider text, p_daily_limit integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
 IF p_provider NOT IN ('google','deskdata','deskdata_balance','apify') OR p_provider IS NULL OR p_daily_limit IS NULL OR p_daily_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_budget'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('b2b-budget:'||p_provider));
 IF EXISTS(SELECT 1 FROM b2b_requests WHERE provider=p_provider AND created_at>clock_timestamp()-interval '5 seconds') THEN RAISE EXCEPTION 'b2b_cooldown'; END IF;
 IF (SELECT count(*) FROM b2b_requests WHERE provider=p_provider AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=p_daily_limit THEN RAISE EXCEPTION 'b2b_daily_limit'; END IF;
 INSERT INTO b2b_requests(provider) VALUES(p_provider) RETURNING id INTO request_id;
 RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_b2b_request(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_b2b_request(text,integer) TO service_role;

-- Importação revisada passa a aceitar a origem "instagram": empresa sem CNPJ e sem place_id,
-- identificada pelo endereço público do perfil. Dedupe pelo perfil já cadastrado ou lead com o mesmo Instagram.
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
   -- Instagram prospecting: no CNPJ/place; requires the public profile URL.
   is_instagram := coalesce(company_record->>'source','') = 'instagram' AND coalesce(company_record->>'cnpj','') = '' AND NOT has_place
     AND coalesce(company_record->>'instagram','') ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9_.]{1,30}/?$';
   IF (company_record->>'identityConfirmed') IS DISTINCT FROM 'true' OR (company_record->>'storageAuthorized') IS DISTINCT FROM 'true'
     OR coalesce(company_record->>'source','') NOT IN ('manual','deskdata','lista','instagram')
     OR NOT (coalesce(company_record->>'cnpj','') ~ '^[A-Z0-9]{12}[0-9]{2}$'
       OR (coalesce(company_record->>'cnpj','') = '' AND (has_place OR is_list OR is_instagram)))
     OR NOT (char_length(btrim(coalesce(company_record->>'legalName',''))) BETWEEN 2 AND 300
       OR (coalesce(company_record->>'cnpj','') = '' AND (has_place OR is_list OR is_instagram)
         AND coalesce(company_record->>'legalName','') = ''
         AND char_length(btrim(coalesce(company_record->>'tradeName',''))) BETWEEN 2 AND 300))
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