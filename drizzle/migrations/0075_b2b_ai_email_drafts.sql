CREATE TABLE public.b2b_ai_email_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','complete','failed','paused','stopped')),
 template text NOT NULL CHECK(template IN ('auto','odontologia','estetica')),
 sender text NOT NULL,
 request_key text NOT NULL UNIQUE,
 lease_token uuid,
 lease_until timestamptz,
 error_message text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.b2b_ai_email_batches TO service_role;
REVOKE ALL ON public.b2b_ai_email_batches FROM anon, authenticated;
ALTER TABLE public.b2b_ai_email_batches ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.b2b_ai_email_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES public.b2b_ai_email_batches(id),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 29),
 company_key text NOT NULL,
 company jsonb NOT NULL,
 operation_key text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','generating','draft','reviewed','failed')),
 subject text NOT NULL DEFAULT '',
 body text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1,
 error_message text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,company_key), UNIQUE(batch_id,position)
);
GRANT ALL ON public.b2b_ai_email_items TO service_role;
REVOKE ALL ON public.b2b_ai_email_items FROM anon, authenticated;
ALTER TABLE public.b2b_ai_email_items ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.b2b_ai_email_control (
 id integer PRIMARY KEY CHECK(id=1),
 provider_denied boolean NOT NULL DEFAULT false,
 message text NOT NULL DEFAULT ''
);
GRANT ALL ON public.b2b_ai_email_control TO service_role;
REVOKE ALL ON public.b2b_ai_email_control FROM anon, authenticated;
ALTER TABLE public.b2b_ai_email_control ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.create_b2b_ai_email_batch(p_key text,p_template text,p_sender text,p_companies jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid; c jsonb; n integer=0;
BEGIN
 IF jsonb_typeof(p_companies)<>'array' OR jsonb_array_length(p_companies) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'invalid_batch'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('b2b_email_create'));
 SELECT id INTO b FROM b2b_ai_email_batches WHERE request_key=p_key;
 IF b IS NOT NULL THEN RETURN b; END IF;
 IF EXISTS(SELECT 1 FROM b2b_ai_email_control WHERE provider_denied) THEN RAISE EXCEPTION 'provider_denied'; END IF;
 INSERT INTO b2b_ai_email_batches(request_key,template,sender) VALUES(p_key,p_template,p_sender) RETURNING id INTO b;
 FOR c IN SELECT value FROM jsonb_array_elements(p_companies) LOOP
  INSERT INTO b2b_ai_email_items(batch_id,position,company_key,company,operation_key) VALUES(b,n,c->>'key',c,p_key||':'||(c->>'key'));
  n=n+1;
 END LOOP;
 RETURN b;
END $$;
CREATE FUNCTION public.claim_b2b_ai_email_batch(p_id uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM b2b_ai_email_control WHERE provider_denied) THEN RETURN false; END IF;
 -- An expired in-flight generation has an unknown outcome; never re-bill automatically.
 IF EXISTS(SELECT 1 FROM b2b_ai_email_items WHERE batch_id=p_id AND state='generating') THEN
  UPDATE b2b_ai_email_batches SET state='paused',error_message='Geração anterior interrompida; os rascunhos concluídos foram preservados.' WHERE id=p_id AND lease_until<now();
  RETURN false;
 END IF;
 UPDATE b2b_ai_email_batches SET state='running',lease_token=p_token,lease_until=now()+interval '15 minutes'
 WHERE id=p_id AND state IN ('pending','running') AND (lease_until IS NULL OR lease_until<now())
 AND EXISTS(SELECT 1 FROM b2b_ai_email_items WHERE batch_id=p_id AND state='pending');
 RETURN FOUND;
END $$;
CREATE FUNCTION public.finish_b2b_ai_email_item(p_batch uuid,p_token uuid,p_item uuid,p_subject text,p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM b2b_ai_email_batches WHERE id=p_batch AND state='running' AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE b2b_ai_email_items SET subject=p_subject,body=p_body,state='draft',revision=revision+1 WHERE id=p_item AND batch_id=p_batch AND state='generating';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.review_b2b_ai_email(p_id uuid,p_revision integer,p_subject text,p_body text,p_reviewed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF length(trim(p_subject)) NOT BETWEEN 1 AND 200 OR length(trim(p_body)) NOT BETWEEN 10 AND 6000 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 UPDATE b2b_ai_email_items SET subject=trim(p_subject),body=trim(p_body),state=CASE WHEN p_reviewed THEN 'reviewed' ELSE 'draft' END,revision=revision+1
 WHERE id=p_id AND revision=p_revision AND state IN ('draft','reviewed');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.create_b2b_ai_email_batch(text,text,text,jsonb),public.claim_b2b_ai_email_batch(uuid,uuid),public.finish_b2b_ai_email_item(uuid,uuid,uuid,text,text),public.review_b2b_ai_email(uuid,integer,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_b2b_ai_email_batch(text,text,text,jsonb),public.claim_b2b_ai_email_batch(uuid,uuid),public.finish_b2b_ai_email_item(uuid,uuid,uuid,text,text),public.review_b2b_ai_email(uuid,integer,text,text,boolean) TO service_role;
COMMENT ON TABLE public.b2b_ai_email_items IS 'Private review-only AI drafts, including unimported Maps companies; no send executor or lead writes.';