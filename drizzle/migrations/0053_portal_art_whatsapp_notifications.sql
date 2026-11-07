CREATE TABLE public.portal_whatsapp_notifications (
 notification_id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 art_version_id uuid NOT NULL,
 recipient text NOT NULL CHECK (recipient ~ '^[1-9][0-9]{9,14}$'),
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 request_id uuid NOT NULL UNIQUE,
 consent_at timestamptz NOT NULL,
 consent_evidence_id text NOT NULL,
 consent_policy_version text NOT NULL,
 state text NOT NULL DEFAULT 'sending' CHECK (state IN ('sending','accepted','delivered','failed','unknown')),
 instance text,
 provider_id text,
 remote_jid text,
 created_at timestamptz NOT NULL DEFAULT now(),
 accepted_at timestamptz,
 delivered_at timestamptz,
 completed_at timestamptz,
 UNIQUE (project_id, art_version_id),
 UNIQUE (instance, provider_id)
);
GRANT ALL ON public.portal_whatsapp_notifications TO service_role;
REVOKE ALL ON public.portal_whatsapp_notifications FROM PUBLIC, anon, authenticated;
ALTER TABLE public.portal_whatsapp_notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX portal_whatsapp_notifications_created_idx ON public.portal_whatsapp_notifications(created_at);

CREATE FUNCTION public.claim_portal_whatsapp_notification(p_notification uuid,p_project uuid,p_version uuid,p_phone text,p_fingerprint text,p_request uuid,p_consent_at timestamptz,p_evidence text,p_policy text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.portal_whatsapp_notifications; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_consent_at IS NULL OR p_consent_at>now() OR length(p_evidence) NOT BETWEEN 1 AND 160 OR length(p_policy) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid_consent'; END IF;
 PERFORM pg_advisory_xact_lock(738245610);
 SELECT * INTO r FROM portal_whatsapp_notifications WHERE notification_id=p_notification OR (project_id=p_project AND art_version_id=p_version) LIMIT 1;
 IF FOUND THEN
  IF r.notification_id<>p_notification OR r.fingerprint<>p_fingerprint THEN RETURN jsonb_build_object('code','conflict'); END IF;
  RETURN jsonb_build_object('code','duplicate','state',r.state);
 END IF;
 IF EXISTS(SELECT 1 FROM portal_whatsapp_notifications WHERE request_id=p_request) THEN RETURN jsonb_build_object('code','replay'); END IF;
 IF (SELECT count(*) FROM portal_whatsapp_notifications WHERE created_at>now()-interval '1 minute')>=30 OR (SELECT count(*) FROM portal_whatsapp_notifications WHERE recipient=p_phone AND created_at>now()-interval '1 hour')>=5 THEN RETURN jsonb_build_object('code','rate_limited'); END IF;
 INSERT INTO portal_whatsapp_notifications(notification_id,project_id,art_version_id,recipient,fingerprint,request_id,consent_at,consent_evidence_id,consent_policy_version) VALUES(p_notification,p_project,p_version,p_phone,p_fingerprint,p_request,p_consent_at,p_evidence,p_policy);
 RETURN jsonb_build_object('code','claimed','state','sending');
END $$;
REVOKE ALL ON FUNCTION public.claim_portal_whatsapp_notification(uuid,uuid,uuid,text,text,uuid,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_portal_whatsapp_notification(uuid,uuid,uuid,text,text,uuid,timestamptz,text,text) TO service_role;

CREATE FUNCTION public.bind_portal_whatsapp_notification(p_notification uuid,p_request uuid,p_instance text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF length(p_instance) NOT BETWEEN 1 AND 160 THEN RETURN false; END IF;
 UPDATE portal_whatsapp_notifications SET instance=p_instance WHERE notification_id=p_notification AND request_id=p_request AND state='sending' AND instance IS NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.bind_portal_whatsapp_notification(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_portal_whatsapp_notification(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.finish_portal_whatsapp_notification(p_notification uuid,p_request uuid,p_state text,p_provider text,p_jid text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.portal_whatsapp_notifications; delivered timestamptz; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM portal_whatsapp_notifications WHERE notification_id=p_notification AND request_id=p_request FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF r.state<>'sending' THEN RETURN true; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RETURN false; END IF;
 IF p_state='accepted' AND (r.instance IS NULL OR length(p_provider) NOT BETWEEN 1 AND 200 OR p_jid IS NULL OR p_jid<>r.recipient||'@s.whatsapp.net') THEN RETURN false; END IF;
 IF p_state='accepted' THEN
  SELECT min(received_at) INTO delivered FROM analysis_delivery_receipts WHERE instance=r.instance AND message_id=p_provider AND remote_jid=p_jid AND state IN ('DELIVERY_ACK','READ','PLAYED');
 END IF;
 UPDATE portal_whatsapp_notifications SET state=CASE WHEN delivered IS NOT NULL THEN 'delivered' ELSE p_state END,provider_id=NULLIF(p_provider,''),remote_jid=NULLIF(p_jid,''),accepted_at=CASE WHEN p_state='accepted' THEN now() END,delivered_at=delivered,completed_at=now() WHERE notification_id=p_notification;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_portal_whatsapp_notification(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_portal_whatsapp_notification(uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.portal_whatsapp_delivery_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NEW.state IN ('DELIVERY_ACK','READ','PLAYED') THEN
  UPDATE portal_whatsapp_notifications SET state='delivered',delivered_at=COALESCE(delivered_at,NEW.received_at) WHERE instance=NEW.instance AND provider_id=NEW.message_id AND remote_jid=NEW.remote_jid AND state IN ('accepted','delivered');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.portal_whatsapp_delivery_receipt() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER portal_whatsapp_delivery_receipt AFTER INSERT ON public.analysis_delivery_receipts FOR EACH ROW EXECUTE FUNCTION public.portal_whatsapp_delivery_receipt();
COMMENT ON TABLE public.portal_whatsapp_notifications IS 'Private Portal art notification audit. No approval URLs, message bodies or shared credentials. Sending/unknown never automatically retry.';