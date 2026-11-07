CREATE TABLE public.crm_diagnosis_automation_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 instance text NOT NULL DEFAULT '', sender_phone text NOT NULL DEFAULT '', authorized_by uuid,
 revision integer NOT NULL DEFAULT 0, activated_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_diagnosis_automation_settings TO service_role;
REVOKE ALL ON public.crm_diagnosis_automation_settings FROM PUBLIC,anon,authenticated;
ALTER TABLE public.crm_diagnosis_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_diagnosis_submissions ADD COLUMN whatsapp_consent jsonb;
CREATE TABLE public.crm_diagnosis_whatsapp (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL UNIQUE REFERENCES public.crm_diagnosis_submissions(id),
 lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id), phone text NOT NULL, body text NOT NULL,
 instance text NOT NULL, sender_phone text NOT NULL, settings_revision integer NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','failed','unknown','cancelled')),
 lease uuid, lease_until timestamptz, provider_id text, remote_jid text, accepted_at timestamptz, persisted_at timestamptz,
 error_code text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,UPDATE ON public.crm_diagnosis_whatsapp TO service_role;
REVOKE ALL ON public.crm_diagnosis_whatsapp FROM PUBLIC,anon,authenticated;
ALTER TABLE public.crm_diagnosis_whatsapp ENABLE ROW LEVEL SECURITY;
CREATE INDEX crm_diagnosis_whatsapp_pending ON public.crm_diagnosis_whatsapp(state,created_at);
CREATE FUNCTION public.diagnosis_channel_allowed(p_actor uuid,p_instance text,p_sender text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.role()='service_role' AND coalesce(public.commercial_knowledge_access(p_actor,'crm:1'),false)
 AND p_instance<>'' AND p_sender ~ '^[1-9][0-9]{9,14}$'
 AND EXISTS(SELECT 1 FROM portal_admin_channels WHERE user_id=p_actor AND company_key='crm:1' AND instance=p_instance AND first_contact_number(canonical_phone)=first_contact_number(p_sender))
 AND NOT EXISTS(SELECT 1 FROM portal_admin_channels WHERE (instance=p_instance OR first_contact_number(canonical_phone)=first_contact_number(p_sender)) AND (company_key<>'crm:1' OR first_contact_number(canonical_phone)<>first_contact_number(p_sender) OR instance<>p_instance))
$$;
REVOKE ALL ON FUNCTION public.diagnosis_channel_allowed(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.diagnosis_channel_allowed(uuid,text,text) TO service_role;
CREATE FUNCTION public.save_diagnosis_automation(p_actor uuid,p_enabled boolean,p_instance text,p_sender text,p_revision integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s crm_diagnosis_automation_settings;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT coalesce(commercial_knowledge_access(p_actor,'crm:1'),false) THEN RAISE EXCEPTION 'access_denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('diagnosis-settings',0));
 INSERT INTO crm_diagnosis_automation_settings(id) VALUES(true) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM crm_diagnosis_automation_settings WHERE id FOR UPDATE;
 IF s.revision<>p_revision THEN RAISE EXCEPTION 'stale_settings'; END IF;
 IF p_enabled AND NOT diagnosis_channel_allowed(p_actor,p_instance,p_sender) THEN RAISE EXCEPTION 'channel_denied'; END IF;
 UPDATE crm_diagnosis_automation_settings SET enabled=p_enabled,instance=left(p_instance,160),sender_phone=left(p_sender,15),authorized_by=p_actor,revision=revision+1,activated_at=CASE WHEN p_enabled THEN now() ELSE NULL END,updated_at=now() WHERE id;
 UPDATE crm_diagnosis_whatsapp SET state='cancelled',error_code='settings_changed' WHERE state='pending';
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.save_diagnosis_automation(uuid,boolean,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_diagnosis_automation(uuid,boolean,text,text,integer) TO service_role;
CREATE FUNCTION public.receive_crm_diagnosis_v2(p_key_hash text,p_event_id text,p_name text,p_company text,p_email text,p_whatsapp text,p_objective text,p_utm_content text,p_consent jsonb,p_phone text,p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; sub crm_diagnosis_submissions; s crm_diagnosis_automation_settings; l leads; consent_ok boolean:=false;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 -- Lock order matches settings/claim; the original intake stays the matching and cadence authority.
 PERFORM pg_advisory_xact_lock(hashtextextended('diagnosis-settings',0));
 r:=receive_crm_diagnosis(p_key_hash,p_event_id,p_name,p_company,p_email,p_whatsapp,p_objective,p_utm_content);
 IF r ? 'error' OR coalesce((r->>'duplicate')::boolean,false) THEN RETURN r; END IF;
 SELECT * INTO sub FROM crm_diagnosis_submissions WHERE event_id=btrim(p_event_id) FOR UPDATE;
 IF sub.outcome<>'matched' THEN RETURN r; END IF;
 SELECT * INTO l FROM leads WHERE id=sub.lead_id FOR UPDATE;
 UPDATE leads SET name=CASE WHEN btrim(name)='' THEN left(p_name,160) ELSE name END,
 company=CASE WHEN btrim(company)='' THEN left(p_company,160) ELSE company END,
 email=CASE WHEN btrim(email)='' THEN lower(left(p_email,254)) ELSE email END,
 whatsapp=CASE WHEN btrim(whatsapp)='' THEN left(p_whatsapp,60) ELSE whatsapp END,
 tags=CASE WHEN jsonb_typeof(tags)='array' AND tags ? 'Diagnóstico solicitado' THEN tags ELSE (CASE WHEN jsonb_typeof(tags)='array' THEN tags ELSE '[]'::jsonb END)||'["Diagnóstico solicitado"]'::jsonb END
 WHERE id=l.id;
 UPDATE crm_diagnosis_submissions SET whatsapp_consent=p_consent WHERE id=sub.id;
 IF jsonb_typeof(p_consent)='object' AND p_consent->'granted'='true'::jsonb AND length(coalesce(p_consent->>'version','')) BETWEEN 1 AND 160 THEN
 BEGIN consent_ok:=(p_consent->>'at')::timestamptz<=now(); EXCEPTION WHEN OTHERS THEN consent_ok:=false; END;
 END IF;
 SELECT * INTO s FROM crm_diagnosis_automation_settings WHERE id FOR UPDATE;
 IF consent_ok AND s.enabled AND sub.received_at>=s.activated_at AND diagnosis_channel_allowed(s.authorized_by,s.instance,s.sender_phone)
 AND p_phone ~ '^[1-9][0-9]{9,14}$' AND length(p_body) BETWEEN 1 AND 1000
 AND first_contact_number(p_phone)<>first_contact_number(s.sender_phone)
 AND first_contact_number(p_phone)=first_contact_number(CASE WHEN length(regexp_replace(p_whatsapp,'[^0-9]','','g')) IN (10,11) THEN '55'||regexp_replace(p_whatsapp,'[^0-9]','','g') ELSE regexp_replace(p_whatsapp,'[^0-9]','','g') END)
 THEN
 INSERT INTO crm_diagnosis_whatsapp(submission_id,lead_id,phone,body,instance,sender_phone,settings_revision)
 VALUES(sub.id,l.id,p_phone,p_body,s.instance,s.sender_phone,s.revision) ON CONFLICT DO NOTHING;
 END IF;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.receive_crm_diagnosis_v2(text,text,text,text,text,text,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_crm_diagnosis_v2(text,text,text,text,text,text,text,text,jsonb,text,text) TO service_role;
CREATE FUNCTION public.claim_diagnosis_whatsapp(p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q crm_diagnosis_whatsapp; s crm_diagnosis_automation_settings;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('diagnosis-settings',0));
 SELECT * INTO s FROM crm_diagnosis_automation_settings WHERE id FOR UPDATE;
 SELECT * INTO q FROM crm_diagnosis_whatsapp WHERE id=p_id FOR UPDATE;
 IF q.id IS NULL OR q.state<>'pending' THEN RETURN NULL; END IF;
 IF NOT coalesce(s.enabled AND s.revision=q.settings_revision AND s.instance=q.instance AND s.sender_phone=q.sender_phone AND diagnosis_channel_allowed(s.authorized_by,q.instance,q.sender_phone),false)
 OR EXISTS(SELECT 1 FROM whatsapp_messages WHERE instance=q.instance AND NOT from_me AND first_contact_number(phone)=first_contact_number(q.phone) AND sent_at>=q.created_at)
 THEN UPDATE crm_diagnosis_whatsapp SET state='cancelled',error_code='authorization_or_reply_changed' WHERE id=q.id; RETURN NULL; END IF;
 UPDATE crm_diagnosis_whatsapp SET state='sending',lease=p_lease,lease_until=now()+interval '45 seconds' WHERE id=q.id;
 INSERT INTO gravon_outbound_reservations(inbound_id,instance,remote_jid,body) VALUES('diagnosis:'||q.id,q.instance,q.phone||'@s.whatsapp.net',q.body) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('id',q.id,'step',1,'phone',q.phone,'body',q.body,'instance',q.instance,'senderPhone',q.sender_phone);
END $$;
CREATE FUNCTION public.revalidate_diagnosis_whatsapp(p_id uuid,p_lease uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.role()='service_role' AND EXISTS(SELECT 1 FROM crm_diagnosis_whatsapp q JOIN crm_diagnosis_automation_settings s ON s.id
 WHERE q.id=p_id AND q.lease=p_lease AND q.state='sending' AND q.lease_until>now() AND s.enabled AND s.revision=q.settings_revision AND s.instance=q.instance AND s.sender_phone=q.sender_phone
 AND diagnosis_channel_allowed(s.authorized_by,q.instance,q.sender_phone)
 AND NOT EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.instance=q.instance AND NOT m.from_me AND first_contact_number(m.phone)=first_contact_number(q.phone) AND m.sent_at>=q.created_at))
$$;
CREATE FUNCTION public.finish_diagnosis_whatsapp(p_id uuid,p_lease uuid,p_state text,p_provider text,p_jid text,p_at timestamptz,p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q crm_diagnosis_whatsapp;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO q FROM crm_diagnosis_whatsapp WHERE id=p_id FOR UPDATE;
 IF q.id IS NULL OR q.lease IS DISTINCT FROM p_lease THEN RETURN false; END IF;
 IF q.persisted_at IS NOT NULL THEN RETURN true; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 IF p_state='accepted' THEN
 IF length(coalesce(p_provider,'')) NOT BETWEEN 1 AND 200 OR p_at IS NULL OR p_jid !~ '^[0-9]{10,15}@s.whatsapp.net$' OR first_contact_number(split_part(p_jid,'@',1))<>first_contact_number(q.phone) THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
 INSERT INTO whatsapp_messages(message_id,instance,phone,remote_jid,phone_key,from_me,body,sent_at,send_state,accepted_at)
 VALUES(p_provider,q.instance,split_part(p_jid,'@',1),p_jid,crm_phone_key(q.phone),true,q.body,p_at,'accepted',p_at) ON CONFLICT(message_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE message_id=p_provider AND instance=q.instance AND from_me AND body=q.body AND first_contact_number(phone)=first_contact_number(q.phone)) THEN RAISE EXCEPTION 'receipt_collision'; END IF;
 UPDATE leads SET history=coalesce(history,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id','diagnosis-whatsapp:'||q.id,'date',p_at,'kind','whatsapp','source','Diagnóstico Gravon','text','Mensagem de atendimento do diagnóstico aceita pela Evolution; entrega não confirmada.')) WHERE id=q.lead_id;
 END IF;
 UPDATE crm_diagnosis_whatsapp SET state=p_state,provider_id=nullif(p_provider,''),remote_jid=nullif(p_jid,''),accepted_at=CASE WHEN p_state='accepted' THEN p_at ELSE accepted_at END,persisted_at=now(),error_code=left(coalesce(p_error,''),160) WHERE id=q.id;
 UPDATE gravon_outbound_reservations SET state=p_state,provider_id=nullif(p_provider,'') WHERE inbound_id='diagnosis:'||q.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_diagnosis_whatsapp(uuid,uuid),public.revalidate_diagnosis_whatsapp(uuid,uuid),public.finish_diagnosis_whatsapp(uuid,uuid,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_diagnosis_whatsapp(uuid,uuid),public.revalidate_diagnosis_whatsapp(uuid,uuid),public.finish_diagnosis_whatsapp(uuid,uuid,text,text,text,timestamptz,text) TO service_role;