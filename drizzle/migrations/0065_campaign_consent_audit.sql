CREATE FUNCTION public.record_crm_campaign_consent(p_lead uuid,p_channel text,p_contact text,p_evidence text,p_granted_at timestamptz,p_withdraw boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing public.crm_campaign_permissions; actual_contact text; event_kind text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_channel NOT IN ('email','whatsapp') OR p_contact IS NULL OR p_contact='' THEN RAISE EXCEPTION 'invalid_contact'; END IF;
 SELECT CASE WHEN p_channel='email' THEN lower(btrim(email)) ELSE regexp_replace(whatsapp,'[^0-9]','','g') END INTO actual_contact FROM leads WHERE id=p_lead FOR UPDATE;
 IF actual_contact IS NULL OR actual_contact IS DISTINCT FROM p_contact THEN RAISE EXCEPTION 'contact_changed'; END IF;
 SELECT * INTO existing FROM crm_campaign_permissions WHERE lead_id=p_lead AND channel=p_channel AND contact=p_contact FOR UPDATE;
 IF p_withdraw THEN
  IF existing.id IS NULL THEN RETURN false; END IF;
  IF existing.withdrawn_at IS NOT NULL THEN RETURN true; END IF;
  UPDATE crm_campaign_permissions SET withdrawn_at=now() WHERE id=existing.id;
  event_kind:='consent_withdrawn';
 ELSE
  IF p_granted_at IS NULL OR p_granted_at>now() OR char_length(p_evidence) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'invalid_evidence'; END IF;
  IF existing.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'withdrawn_contact'; END IF;
  IF existing.id IS NOT NULL THEN RETURN true; END IF;
  INSERT INTO crm_campaign_permissions(lead_id,channel,contact,evidence,granted_at) VALUES(p_lead,p_channel,p_contact,p_evidence,p_granted_at);
  event_kind:='consent_recorded';
 END IF;
 INSERT INTO crm_campaign_events(lead_id,channel,kind) VALUES(p_lead,p_channel,event_kind);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_crm_campaign_consent(uuid,text,text,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_crm_campaign_consent(uuid,text,text,text,timestamptz,boolean) TO service_role;