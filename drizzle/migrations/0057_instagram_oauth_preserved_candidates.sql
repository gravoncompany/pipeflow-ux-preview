ALTER TABLE public.instagram_oauth_flows ADD COLUMN verified_scopes text[];
CREATE TABLE public.instagram_oauth_candidates (
 account_id uuid PRIMARY KEY REFERENCES public.instagram_accounts(id), company_key text NOT NULL,
 app_id text NOT NULL, instagram_id text NOT NULL, encrypted_token text NOT NULL,
 expires_at timestamptz NOT NULL, verified_scopes text[] NOT NULL, author_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_key,account_id) REFERENCES public.instagram_accounts(company_key,id)
);
GRANT ALL ON public.instagram_oauth_candidates TO service_role;
REVOKE ALL ON public.instagram_oauth_candidates FROM PUBLIC,anon,authenticated;
ALTER TABLE public.instagram_oauth_candidates ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.retain_preserved_instagram_oauth() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.status='ready' AND NEW.status='complete' AND OLD.encrypted_token IS NOT NULL AND NEW.account_id IS NOT NULL
 AND OLD.app_id ~ '^[0-9]{1,40}$' AND OLD.token_expires_at>now()
 AND OLD.verified_scopes @> ARRAY['instagram_business_basic','instagram_business_manage_messages']::text[]
 AND public.commercial_knowledge_access(OLD.author_id,OLD.company_key)
 AND EXISTS(SELECT 1 FROM public.instagram_accounts a WHERE a.id=NEW.account_id AND a.company_key=OLD.company_key AND a.instagram_id=OLD.instagram_id AND a.token_secret_name NOT LIKE 'oauth:%') THEN
 INSERT INTO public.instagram_oauth_candidates(account_id,company_key,app_id,instagram_id,encrypted_token,expires_at,verified_scopes,author_id)
 VALUES(NEW.account_id,OLD.company_key,OLD.app_id,OLD.instagram_id,OLD.encrypted_token,OLD.token_expires_at,OLD.verified_scopes,OLD.author_id)
 ON CONFLICT(account_id) DO UPDATE SET app_id=excluded.app_id,instagram_id=excluded.instagram_id,encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at,verified_scopes=excluded.verified_scopes,author_id=excluded.author_id,created_at=now();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.retain_preserved_instagram_oauth() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retain_preserved_instagram_oauth() TO service_role;
CREATE TRIGGER retain_preserved_instagram_oauth BEFORE UPDATE ON public.instagram_oauth_flows FOR EACH ROW EXECUTE FUNCTION public.retain_preserved_instagram_oauth();