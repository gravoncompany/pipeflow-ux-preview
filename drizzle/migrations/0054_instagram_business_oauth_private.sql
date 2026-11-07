CREATE TABLE public.instagram_oauth_flows (
 state_hash text PRIMARY KEY, binding_hash text NOT NULL, author_id uuid NOT NULL, company_key text NOT NULL,
 expires_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','exchanging','ready','complete','failed')),
 instagram_id text, username text, encrypted_token text, token_expires_at timestamptz,
 account_id uuid REFERENCES public.instagram_accounts(id), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.instagram_oauth_flows TO service_role;
REVOKE ALL ON public.instagram_oauth_flows FROM PUBLIC,anon,authenticated;
ALTER TABLE public.instagram_oauth_flows ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.instagram_oauth_credentials (
 account_id uuid PRIMARY KEY REFERENCES public.instagram_accounts(id), company_key text NOT NULL,
 encrypted_token text NOT NULL, expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_key,account_id) REFERENCES public.instagram_accounts(company_key,id)
);
GRANT ALL ON public.instagram_oauth_credentials TO service_role;
REVOKE ALL ON public.instagram_oauth_credentials FROM PUBLIC,anon,authenticated;
ALTER TABLE public.instagram_oauth_credentials ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.complete_instagram_oauth(p_state text,p_binding text,p_author uuid,p_company text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.instagram_oauth_flows; a public.instagram_accounts; preserved boolean:=false;
BEGIN
 IF NOT public.commercial_knowledge_access(p_author,p_company) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.instagram_oauth_flows WHERE state_hash=p_state AND binding_hash=p_binding AND author_id=p_author AND company_key=p_company FOR UPDATE;
 IF NOT FOUND OR f.expires_at<=now() OR f.status NOT IN ('ready','complete') THEN RAISE EXCEPTION 'Invalid OAuth flow' USING ERRCODE='42501'; END IF;
 IF f.status='complete' THEN RETURN jsonb_build_object('accountId',f.account_id,'preserved',true); END IF;
 IF f.instagram_id IS NULL OR f.instagram_id !~ '^[0-9]{1,40}$' OR f.username IS NULL OR char_length(f.username) NOT BETWEEN 1 AND 100 OR f.encrypted_token IS NULL OR f.token_expires_at<=now() THEN RAISE EXCEPTION 'Invalid credentials' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('instagram:account:'||f.instagram_id,0));
 SELECT * INTO a FROM public.instagram_accounts WHERE instagram_id=f.instagram_id FOR UPDATE;
 IF FOUND THEN
  IF a.company_key<>p_company THEN RAISE EXCEPTION 'Account already bound' USING ERRCODE='42501'; END IF;
  preserved := a.token_secret_name NOT LIKE 'oauth:%';
 ELSE
  INSERT INTO public.instagram_accounts(company_key,instagram_id,username,token_secret_name,app_secret_name,updated_by,checked_at)
  VALUES(p_company,f.instagram_id,f.username,'oauth:'||f.instagram_id,'INSTAGRAM_APP_SECRET',p_author,now()) RETURNING * INTO a;
 END IF;
 IF NOT preserved THEN
  INSERT INTO public.instagram_oauth_credentials(account_id,company_key,encrypted_token,expires_at) VALUES(a.id,p_company,f.encrypted_token,f.token_expires_at)
  ON CONFLICT(account_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at,updated_at=now();
  UPDATE public.instagram_accounts SET username=f.username,checked_at=now(),updated_by=p_author,updated_at=now(),error_code=NULL WHERE id=a.id;
 END IF;
 UPDATE public.instagram_oauth_flows SET status='complete',account_id=a.id,encrypted_token=NULL WHERE state_hash=p_state;
 RETURN jsonb_build_object('accountId',a.id,'preserved',preserved);
END $$;
REVOKE ALL ON FUNCTION public.complete_instagram_oauth(text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_instagram_oauth(text,text,uuid,text) TO service_role;