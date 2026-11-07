-- E-mail: o consentimento registrado deixa de ser condição obrigatória para reservar destinatários.
-- Continuam bloqueando: contato divergente do card, descadastro registrado (withdrawn_at) em qualquer card,
-- lista de bloqueio/descadastro (b2b_email_suppressions) e endereço repetido na mesma campanha.
-- Nenhum registro de consentimento é criado nem alterado. WhatsApp não é afetado.
CREATE OR REPLACE FUNCTION public.claim_crm_campaign_email(p_id uuid, p_revision integer, p_recipients jsonb, p_scheduled_at timestamptz, p_batch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns; item jsonb; lead_contact text; out jsonb := '[]'::jsonb; d public.crm_campaign_deliveries;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.state <> 'draft' OR c.revision <> p_revision OR c.channel <> 'email' THEN RAISE EXCEPTION 'stale_or_locked'; END IF;
 IF c.scheduled_at IS DISTINCT FROM p_scheduled_at THEN RAISE EXCEPTION 'schedule_changed'; END IF;
 IF p_scheduled_at IS NOT NULL AND p_scheduled_at <= now() THEN RAISE EXCEPTION 'schedule_past'; END IF;
 IF jsonb_typeof(p_recipients) IS DISTINCT FROM 'array' OR jsonb_array_length(p_recipients) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid_recipients'; END IF;
 IF char_length(btrim(c.subject))=0 OR char_length(btrim(c.body))=0 THEN RAISE EXCEPTION 'invalid_content'; END IF;
 IF (SELECT sender_email FROM crm_campaign_email_settings WHERE id)='' THEN RAISE EXCEPTION 'sender_not_configured'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_recipients) LOOP
  IF NOT (c.lead_ids ? (item->>'lead_id')) THEN RAISE EXCEPTION 'recipient_not_selected'; END IF;
  SELECT lower(btrim(email)) INTO lead_contact FROM leads WHERE id=(item->>'lead_id')::uuid FOR SHARE;
  IF lead_contact IS NULL OR lead_contact = '' OR lead_contact IS DISTINCT FROM item->>'contact' THEN RAISE EXCEPTION 'contact_changed'; END IF;
  IF lead_contact !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'recipient_not_eligible'; END IF;
  IF EXISTS (SELECT 1 FROM crm_campaign_permissions WHERE channel='email' AND contact=lead_contact AND withdrawn_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=lead_contact) THEN RAISE EXCEPTION 'recipient_not_eligible'; END IF;
  IF EXISTS (SELECT 1 FROM crm_campaign_deliveries WHERE campaign_id=c.id AND contact=lead_contact) THEN RAISE EXCEPTION 'duplicate_recipient'; END IF;
  INSERT INTO crm_campaign_deliveries(campaign_id,lead_id,contact,batch_id,scheduled_at) VALUES(c.id,(item->>'lead_id')::uuid,lead_contact,p_batch,p_scheduled_at) RETURNING * INTO d;
  out := out || jsonb_build_array(jsonb_build_object('id',d.id,'lead_id',d.lead_id,'contact',d.contact));
 END LOOP;
 UPDATE crm_campaigns SET state=CASE WHEN p_scheduled_at IS NULL THEN 'running' ELSE 'scheduled' END, revision=revision+1, updated_at=now() WHERE id=c.id;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(c.id,'email',CASE WHEN p_scheduled_at IS NULL THEN 'sending' ELSE 'scheduled' END,jsonb_build_object('recipients',jsonb_array_length(out),'batch',p_batch,'scheduled_at',p_scheduled_at));
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.claim_crm_campaign_email(uuid,integer,jsonb,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crm_campaign_email(uuid,integer,jsonb,timestamptz,uuid) TO service_role;