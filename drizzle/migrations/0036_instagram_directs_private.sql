CREATE TABLE public.instagram_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_key text NOT NULL, instagram_id text NOT NULL UNIQUE, username text NOT NULL, token_secret_name text NOT NULL UNIQUE, app_secret_name text NOT NULL, greeting_enabled boolean NOT NULL DEFAULT false, greeting text NOT NULL DEFAULT '' CHECK(char_length(greeting)<=1000), enabled boolean NOT NULL DEFAULT true, subscribed_at timestamptz, checked_at timestamptz, last_event_at timestamptz, error_code text, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_key,id));
GRANT ALL ON public.instagram_accounts TO service_role;
REVOKE ALL ON public.instagram_accounts FROM anon,authenticated;
ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.instagram_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_key text NOT NULL, account_id uuid NOT NULL, sender_id text NOT NULL, origin text NOT NULL DEFAULT 'instagram' CHECK(origin='instagram'), created_at timestamptz NOT NULL DEFAULT now(), last_inbound_at timestamptz NOT NULL, greeting_state text NOT NULL DEFAULT 'skipped' CHECK(greeting_state IN ('skipped','sending','accepted','unknown','failed')), greeting_text text, greeting_provider_id text, greeting_at timestamptz, UNIQUE(account_id,sender_id), UNIQUE(company_key,account_id,id), FOREIGN KEY(company_key,account_id) REFERENCES public.instagram_accounts(company_key,id));
GRANT ALL ON public.instagram_contacts TO service_role;
REVOKE ALL ON public.instagram_contacts FROM anon,authenticated;
ALTER TABLE public.instagram_contacts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.instagram_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_key text NOT NULL, account_id uuid NOT NULL, contact_id uuid NOT NULL, message_id text NOT NULL, from_me boolean NOT NULL, body text, kind text NOT NULL CHECK(kind IN ('text','attachment','deleted','unsupported')), sent_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), send_state text, UNIQUE(account_id,message_id), FOREIGN KEY(company_key,account_id,contact_id) REFERENCES public.instagram_contacts(company_key,account_id,id));
GRANT ALL ON public.instagram_messages TO service_role;
REVOKE ALL ON public.instagram_messages FROM anon,authenticated;
ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX instagram_messages_conversation ON public.instagram_messages(company_key,account_id,contact_id,sent_at);
CREATE FUNCTION public.ingest_instagram_message(p_account uuid,p_sender text,p_mid text,p_body text,p_kind text,p_sent timestamptz,p_inbound boolean,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.instagram_accounts; c public.instagram_contacts; fresh boolean:=false; n integer; BEGIN
IF p_sender !~ '^[0-9]{1,40}$' OR char_length(p_mid) NOT BETWEEN 1 AND 512 OR char_length(coalesce(p_body,''))>20000 OR p_kind NOT IN ('text','attachment','deleted','unsupported') OR p_sent>p_now+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid event'; END IF;
SELECT * INTO a FROM public.instagram_accounts WHERE id=p_account AND enabled FOR UPDATE;
IF NOT FOUND OR p_sender=a.instagram_id THEN RETURN jsonb_build_object('ignored',true); END IF;
SELECT * INTO c FROM public.instagram_contacts WHERE account_id=a.id AND sender_id=p_sender FOR UPDATE;
IF NOT FOUND THEN
IF NOT p_inbound OR p_kind='deleted' THEN RETURN jsonb_build_object('ignored',true); END IF;
INSERT INTO public.instagram_contacts(company_key,account_id,sender_id,last_inbound_at,greeting_state,greeting_text) VALUES(a.company_key,a.id,p_sender,p_sent,CASE WHEN a.greeting_enabled AND char_length(btrim(a.greeting))>0 AND p_kind IN ('text','attachment') AND p_sent>=p_now-interval '24 hours' THEN 'sending' ELSE 'skipped' END,a.greeting) RETURNING * INTO c; fresh:=true;
END IF;
INSERT INTO public.instagram_messages(company_key,account_id,contact_id,message_id,from_me,body,kind,sent_at) VALUES(a.company_key,a.id,c.id,p_mid,NOT p_inbound,p_body,p_kind,p_sent) ON CONFLICT(account_id,message_id) DO NOTHING;
GET DIAGNOSTICS n=ROW_COUNT;
IF n=0 THEN RETURN jsonb_build_object('duplicate',true); END IF;
IF p_inbound THEN UPDATE public.instagram_contacts SET last_inbound_at=greatest(last_inbound_at,p_sent) WHERE id=c.id; END IF;
UPDATE public.instagram_accounts SET last_event_at=p_now WHERE id=a.id;
RETURN jsonb_build_object('contact_id',c.id,'greet',fresh AND c.greeting_state='sending','text',c.greeting_text,'sender',c.sender_id); END $$;
REVOKE ALL ON FUNCTION public.ingest_instagram_message(uuid,text,text,text,text,timestamptz,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_instagram_message(uuid,text,text,text,text,timestamptz,boolean,timestamptz) TO service_role;
CREATE FUNCTION public.finish_instagram_greeting(p_account uuid,p_contact uuid,p_state text,p_mid text,p_now timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE c public.instagram_contacts; BEGIN
IF p_state NOT IN ('accepted','unknown','failed') OR (p_state='accepted' AND (p_mid IS NULL OR char_length(p_mid) NOT BETWEEN 1 AND 512)) THEN RAISE EXCEPTION 'Invalid result'; END IF;
SELECT * INTO c FROM public.instagram_contacts WHERE id=p_contact AND account_id=p_account FOR UPDATE;
IF NOT FOUND OR c.greeting_state NOT IN ('sending','accepted') THEN RETURN; END IF;
IF c.greeting_state='accepted' AND (p_state<>'accepted' OR c.greeting_provider_id IS DISTINCT FROM p_mid) THEN RETURN; END IF;
UPDATE public.instagram_contacts SET greeting_state=p_state,greeting_provider_id=p_mid,greeting_at=p_now WHERE id=c.id;
IF p_state='accepted' THEN INSERT INTO public.instagram_messages(company_key,account_id,contact_id,message_id,from_me,body,kind,sent_at,send_state) VALUES(c.company_key,c.account_id,c.id,p_mid,true,c.greeting_text,'text',p_now,'accepted') ON CONFLICT(account_id,message_id) DO NOTHING; END IF; END $$;
REVOKE ALL ON FUNCTION public.finish_instagram_greeting(uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_instagram_greeting(uuid,uuid,text,text,timestamptz) TO service_role;
COMMENT ON TABLE public.instagram_contacts IS 'Instagram-scoped contacts; no guessed phone/email or automatic legacy lead merging. Sending/unknown greetings never retry automatically.';