CREATE OR REPLACE FUNCTION public.settle_crm_campaigns() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer := 0; d record; c record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 FOR d IN UPDATE crm_campaign_deliveries x SET state='unknown', error_code='worker_outcome_unknown', updated_at=now() FROM crm_campaigns k WHERE k.id=x.campaign_id AND k.channel='email' AND x.state='reserved' AND x.created_at < now() - interval '10 minutes' RETURNING x.id,x.campaign_id,x.lead_id LOOP
  INSERT INTO crm_campaign_events(campaign_id,lead_id,channel,kind,details) VALUES(d.campaign_id,d.lead_id,'email','unknown',jsonb_build_object('delivery',d.id,'reason','worker_outcome_unknown'));
  n := n + 1;
 END LOOP;
 FOR d IN UPDATE crm_campaign_deliveries SET state='accepted', updated_at=now() WHERE state='scheduled' AND scheduled_at < now() - interval '15 minutes' RETURNING id,campaign_id,lead_id,contact LOOP
  IF d.lead_id IS NOT NULL THEN
   SELECT name, subject INTO c FROM crm_campaigns WHERE id=d.campaign_id;
   PERFORM crm_email_sent_effects(d.lead_id,'email-campaign:'||d.id,'E-mail Marketing enviado (agendado) — campanha "'||c.name||'" · assunto "'||c.subject||'" para '||d.contact||'.');
  END IF;
 END LOOP;
 -- Only e-mail campaigns are settled here; WhatsApp campaigns complete in claim_crm_whatsapp_delivery once nothing is queued/reserved.
 FOR c IN SELECT id FROM crm_campaigns WHERE channel='email' AND state IN ('running','scheduled') AND NOT EXISTS (SELECT 1 FROM crm_campaign_deliveries x WHERE x.campaign_id=crm_campaigns.id AND x.state IN ('queued','reserved','scheduled')) AND EXISTS (SELECT 1 FROM crm_campaign_deliveries x WHERE x.campaign_id=crm_campaigns.id) LOOP
  UPDATE crm_campaigns SET state='completed', revision=revision+1, updated_at=now() WHERE id=c.id;
  INSERT INTO crm_campaign_events(campaign_id,channel,kind) VALUES(c.id,'email','dispatch_finished');
 END LOOP;
 RETURN n;
END $$;