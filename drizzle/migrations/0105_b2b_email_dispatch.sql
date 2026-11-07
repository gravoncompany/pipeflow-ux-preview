-- Prospecção B2B: envio pela Brevo dos rascunhos individuais somente após revisão e confirmação explícita.
-- Nenhum rascunho existente muda de estado; nenhum envio ocorre por esta migração.
ALTER TABLE public.b2b_ai_email_items
 ADD COLUMN IF NOT EXISTS recipient text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS send_state text NOT NULL DEFAULT 'none',
 ADD COLUMN IF NOT EXISTS send_lead_id uuid,
 ADD COLUMN IF NOT EXISTS provider_message_id text,
 ADD COLUMN IF NOT EXISTS send_error text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS send_reserved_at timestamptz,
 ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE public.b2b_ai_email_items ADD CONSTRAINT b2b_ai_email_items_send_state CHECK (send_state IN ('none','reserved','accepted','failed','unknown'));
-- Um mesmo endereço nunca recebe dois primeiros e-mails (inclui resultados desconhecidos, que nunca são reenviados).
CREATE UNIQUE INDEX IF NOT EXISTS b2b_ai_email_items_one_send_per_recipient ON public.b2b_ai_email_items (lower(recipient)) WHERE send_state IN ('reserved','accepted','unknown');

CREATE OR REPLACE FUNCTION public.review_b2b_ai_email(p_id uuid,p_revision integer,p_subject text,p_body text,p_reviewed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF length(trim(p_subject)) NOT BETWEEN 1 AND 200 OR length(trim(p_body)) NOT BETWEEN 10 AND 6000 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 UPDATE b2b_ai_email_items SET subject=trim(p_subject),body=trim(p_body),state=CASE WHEN p_reviewed THEN 'reviewed' ELSE 'draft' END,revision=revision+1
 WHERE id=p_id AND revision=p_revision AND state IN ('draft','reviewed') AND send_state='none';
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.review_b2b_ai_email_item(p_id uuid,p_revision integer,p_subject text,p_body text,p_recipient text,p_reviewed boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text := lower(btrim(coalesce(p_recipient,''))); n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF length(trim(p_subject)) NOT BETWEEN 1 AND 200 OR length(trim(p_body)) NOT BETWEEN 10 AND 6000 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 IF r <> '' AND (char_length(r) > 254 OR r !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN RAISE EXCEPTION 'invalid_recipient'; END IF;
 UPDATE b2b_ai_email_items SET subject=trim(p_subject),body=trim(p_body),recipient=r,state=CASE WHEN p_reviewed THEN 'reviewed' ELSE 'draft' END,revision=revision+1
 WHERE id=p_id AND revision=p_revision AND state IN ('draft','reviewed') AND send_state='none' RETURNING revision INTO n;
 IF n IS NULL THEN RAISE EXCEPTION 'stale_draft'; END IF;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_b2b_ai_email_send(p_id uuid,p_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.b2b_ai_email_items; r text; lead uuid; used integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO i FROM b2b_ai_email_items WHERE id=p_id FOR UPDATE;
 IF i.id IS NULL OR i.revision<>p_revision OR i.state<>'reviewed' OR i.send_state<>'none' THEN RAISE EXCEPTION 'stale_draft'; END IF;
 r := lower(btrim(i.recipient));
 IF r='' THEN RAISE EXCEPTION 'missing_recipient'; END IF;
 IF r !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'invalid_recipient'; END IF;
 IF char_length(btrim(i.subject))=0 OR char_length(btrim(i.body))<10 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 IF coalesce((SELECT sender_email FROM crm_campaign_email_settings LIMIT 1),'')='' THEN RAISE EXCEPTION 'sender_not_configured'; END IF;
 IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=r)
    OR EXISTS (SELECT 1 FROM crm_campaign_permissions WHERE channel='email' AND contact=r AND withdrawn_at IS NOT NULL) THEN RAISE EXCEPTION 'suppressed_contact'; END IF;
 IF EXISTS (SELECT 1 FROM b2b_ai_email_items WHERE id<>i.id AND lower(recipient)=r AND send_state IN ('reserved','accepted','unknown')) THEN RAISE EXCEPTION 'already_sent'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('crm_email_daily_quota'));
 SELECT (SELECT count(*) FROM crm_email_flow_messages WHERE direction='out' AND state IN ('accepted','reserved') AND updated_at>=now()-interval '24 hours')
      + (SELECT count(*) FROM crm_campaign_deliveries WHERE state IN ('accepted','scheduled','reserved') AND updated_at>=now()-interval '24 hours')
      + (SELECT count(*) FROM b2b_ai_email_items WHERE send_state IN ('accepted','reserved') AND send_reserved_at>=now()-interval '24 hours') INTO used;
 IF used >= 250 THEN RAISE EXCEPTION 'daily_limit'; END IF;
 IF i.company_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND EXISTS (SELECT 1 FROM leads WHERE id=i.company_key::uuid) THEN lead := i.company_key::uuid;
 ELSE SELECT b.lead_id INTO lead FROM b2b_companies b WHERE b.place_id=i.company_key AND b.place_id<>'' AND b.lead_id IS NOT NULL LIMIT 1; END IF;
 UPDATE b2b_ai_email_items SET send_state='reserved', recipient=r, send_lead_id=lead, send_reserved_at=now(), send_error='', revision=revision+1 WHERE id=i.id;
 RETURN jsonb_build_object('recipient',r,'lead_id',lead,'subject',i.subject,'body',i.body,'name',i.company->>'name');
END $$;

CREATE OR REPLACE FUNCTION public.finish_b2b_ai_email_send(p_id uuid,p_state text,p_provider_id text,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.b2b_ai_email_items;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE b2b_ai_email_items SET send_state=p_state, provider_message_id=nullif(left(coalesce(p_provider_id,''),300),''),
  send_error=left(coalesce(p_error,''),120), sent_at=CASE WHEN p_state='accepted' THEN now() ELSE NULL END
 WHERE id=p_id AND send_state='reserved' RETURNING * INTO i;
 IF i.id IS NULL THEN RETURN false; END IF;
 IF p_state='accepted' AND i.send_lead_id IS NOT NULL THEN
  PERFORM crm_email_sent_effects(i.send_lead_id,'b2b-first-email:'||i.id,'Primeiro contato B2B · E-mail'||chr(10)||'Enviado pela Brevo — assunto "'||left(i.subject,200)||'" para '||i.recipient||'.');
 END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.settle_b2b_ai_email_sends()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE b2b_ai_email_items SET send_state='unknown', send_error='worker_outcome_unknown' WHERE send_state='reserved' AND send_reserved_at<now()-interval '10 minutes';
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.review_b2b_ai_email_item(uuid,integer,text,text,text,boolean),public.reserve_b2b_ai_email_send(uuid,integer),public.finish_b2b_ai_email_send(uuid,text,text,text),public.settle_b2b_ai_email_sends() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_b2b_ai_email_item(uuid,integer,text,text,text,boolean),public.reserve_b2b_ai_email_send(uuid,integer),public.finish_b2b_ai_email_send(uuid,text,text,text),public.settle_b2b_ai_email_sends() TO service_role;
COMMENT ON TABLE public.b2b_ai_email_items IS 'Private AI first-contact drafts (Maps companies included). Sent via Brevo only after per-item review and explicit batch confirmation; one send per address, unknown outcomes never resent.';