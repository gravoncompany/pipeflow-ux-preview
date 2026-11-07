CREATE TABLE public.crm_campaigns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 150), channel text NOT NULL CHECK(channel IN ('email','whatsapp')), subject text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', sender_reference text NOT NULL DEFAULT '', instance_reference text NOT NULL DEFAULT '', lead_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(lead_ids)='array' AND jsonb_array_length(lead_ids)<=1000), state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','scheduled','running','completed','cancelled')), scheduled_at timestamptz, revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.crm_campaigns TO service_role;
REVOKE ALL ON public.crm_campaigns FROM PUBLIC,anon,authenticated;
ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.crm_campaign_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(char_length(name) BETWEEN 2 AND 150), channel text NOT NULL CHECK(channel IN ('email','whatsapp')), subject text NOT NULL DEFAULT '', body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 10000), created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.crm_campaign_templates TO service_role;
REVOKE ALL ON public.crm_campaign_templates FROM PUBLIC,anon,authenticated;
ALTER TABLE public.crm_campaign_templates ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.crm_campaign_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE, channel text NOT NULL CHECK(channel IN ('email','whatsapp')), contact text NOT NULL CHECK(char_length(contact) BETWEEN 8 AND 254), purpose text NOT NULL DEFAULT 'marketing' CHECK(purpose='marketing'), evidence text NOT NULL CHECK(char_length(evidence) BETWEEN 10 AND 2000), granted_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), withdrawn_at timestamptz, UNIQUE(lead_id,channel,contact));
GRANT ALL ON public.crm_campaign_permissions TO service_role;
REVOKE ALL ON public.crm_campaign_permissions FROM PUBLIC,anon,authenticated;
ALTER TABLE public.crm_campaign_permissions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.crm_campaign_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid REFERENCES public.crm_campaigns(id), lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL, channel text NOT NULL CHECK(channel IN ('email','whatsapp')), kind text NOT NULL CHECK(kind IN ('draft_created','draft_updated','cancelled','consent_recorded','consent_withdrawn','scheduled','sending','accepted','delivered','read','failed','replied','unknown')), created_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL DEFAULT '{}');
GRANT SELECT,INSERT ON public.crm_campaign_events TO service_role;
REVOKE ALL ON public.crm_campaign_events FROM PUBLIC,anon,authenticated;
ALTER TABLE public.crm_campaign_events ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_campaign_permissions IS 'Purpose/channel/exact-contact marketing consent; Maps, DeskData and first-contact evidence never automatically authorize campaigns. Full signed CRM admin required.';
COMMENT ON TABLE public.crm_campaigns IS 'Private campaign preparation. No sends or scheduling until separately verified provider/channel permissions; drafts never move leads.';
CREATE FUNCTION public.save_crm_campaign_draft(p_id uuid,p_revision integer,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE saved public.crm_campaigns; event_kind text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_payload->>'channel' NOT IN ('email','whatsapp') OR char_length(p_payload->>'name') NOT BETWEEN 2 AND 150 OR char_length(coalesce(p_payload->>'body',''))>10000 OR char_length(coalesce(p_payload->>'subject',''))>300 OR jsonb_typeof(p_payload->'leadIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'leadIds')>1000 THEN RAISE EXCEPTION 'invalid_draft'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO crm_campaigns(name,channel,subject,body,sender_reference,instance_reference,lead_ids,scheduled_at) VALUES(p_payload->>'name',p_payload->>'channel',coalesce(p_payload->>'subject',''),coalesce(p_payload->>'body',''),coalesce(p_payload->>'senderReference',''),coalesce(p_payload->>'instanceReference',''),p_payload->'leadIds',nullif(p_payload->>'scheduledAt','')::timestamptz) RETURNING * INTO saved;
  event_kind:='draft_created';
 ELSE
  UPDATE crm_campaigns SET name=p_payload->>'name',channel=p_payload->>'channel',subject=coalesce(p_payload->>'subject',''),body=coalesce(p_payload->>'body',''),sender_reference=coalesce(p_payload->>'senderReference',''),instance_reference=coalesce(p_payload->>'instanceReference',''),lead_ids=p_payload->'leadIds',scheduled_at=nullif(p_payload->>'scheduledAt','')::timestamptz,revision=revision+1,updated_at=now() WHERE id=p_id AND revision=p_revision AND state='draft' RETURNING * INTO saved;
  IF saved.id IS NULL THEN RAISE EXCEPTION 'stale_or_locked'; END IF;
  event_kind:='draft_updated';
 END IF;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(saved.id,saved.channel,event_kind,jsonb_build_object('revision',saved.revision));
 RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.save_crm_campaign_draft(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_campaign_draft(uuid,integer,jsonb) TO service_role;
CREATE FUNCTION public.cancel_crm_campaign(p_id uuid,p_revision integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE crm_campaigns SET state='cancelled',revision=revision+1,updated_at=now() WHERE id=p_id AND revision=p_revision AND state IN ('draft','scheduled') RETURNING * INTO c;
 IF c.id IS NULL THEN RETURN false; END IF;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind) VALUES(c.id,c.channel,'cancelled');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.cancel_crm_campaign(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_crm_campaign(uuid,integer) TO service_role;