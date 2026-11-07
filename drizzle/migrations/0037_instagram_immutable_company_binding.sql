CREATE FUNCTION public.bind_instagram_account(p_author uuid,p_company text,p_instagram text,p_username text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE a public.instagram_accounts; BEGIN
IF NOT public.commercial_knowledge_access(p_author,p_company) OR p_instagram !~ '^[0-9]{1,40}$' OR char_length(p_username) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
PERFORM pg_advisory_xact_lock(hashtextextended('instagram:INSTAGRAM_ACCESS_TOKEN',0));
SELECT * INTO a FROM public.instagram_accounts WHERE instagram_id=p_instagram OR token_secret_name='INSTAGRAM_ACCESS_TOKEN' FOR UPDATE;
IF FOUND THEN
IF a.company_key<>p_company OR a.instagram_id<>p_instagram OR a.token_secret_name<>'INSTAGRAM_ACCESS_TOKEN' THEN RAISE EXCEPTION 'Account already bound' USING ERRCODE='42501'; END IF;
UPDATE public.instagram_accounts SET username=p_username,checked_at=now(),error_code=NULL,updated_by=p_author,updated_at=now() WHERE id=a.id; RETURN a.id;
END IF;
INSERT INTO public.instagram_accounts(company_key,instagram_id,username,token_secret_name,app_secret_name,updated_by,checked_at) VALUES(p_company,p_instagram,p_username,'INSTAGRAM_ACCESS_TOKEN','INSTAGRAM_APP_SECRET',p_author,now()) RETURNING id INTO a.id; RETURN a.id; END $$;
REVOKE ALL ON FUNCTION public.bind_instagram_account(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_instagram_account(uuid,text,text,text) TO service_role;