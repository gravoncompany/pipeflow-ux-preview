ALTER TABLE public.crm_campaigns ADD COLUMN IF NOT EXISTS audience_kind text NOT NULL DEFAULT 'individual' CHECK (audience_kind IN ('individual','groups'));
ALTER TABLE public.crm_campaigns ADD COLUMN IF NOT EXISTS group_targets jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(group_targets)='array' AND jsonb_array_length(group_targets)<=300);
ALTER TABLE public.crm_campaigns ADD COLUMN IF NOT EXISTS manual_targets jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(manual_targets)='array' AND jsonb_array_length(manual_targets)<=1000);
ALTER TABLE public.crm_campaigns DROP CONSTRAINT IF EXISTS crm_campaigns_state_check;
ALTER TABLE public.crm_campaigns ADD CONSTRAINT crm_campaigns_state_check CHECK (state IN ('draft','scheduled','running','paused','completed','cancelled'));

ALTER TABLE public.crm_campaign_events DROP CONSTRAINT IF EXISTS crm_campaign_events_kind_check;
ALTER TABLE public.crm_campaign_events ADD CONSTRAINT crm_campaign_events_kind_check CHECK (kind IN ('draft_created','draft_updated','cancelled','consent_recorded','consent_withdrawn','scheduled','sending','accepted','delivered','read','failed','replied','unknown','settings_updated','test_recipient_recorded','test_recipient_revoked','test_reserved','test_sent','test_failed','dispatch_finished','paused','resumed'));

ALTER TABLE public.crm_campaign_send_pacing DROP CONSTRAINT IF EXISTS crm_campaign_send_pacing_min_gap_seconds_check;
ALTER TABLE public.crm_campaign_send_pacing DROP CONSTRAINT IF EXISTS crm_campaign_send_pacing_check;
ALTER TABLE public.crm_campaign_send_pacing DROP CONSTRAINT IF EXISTS crm_campaign_send_pacing_pause_every_check;
ALTER TABLE public.crm_campaign_send_pacing ADD CONSTRAINT crm_campaign_send_pacing_gap_range CHECK (min_gap_seconds BETWEEN 1 AND 300 AND max_gap_seconds BETWEEN 1 AND 600 AND max_gap_seconds >= min_gap_seconds);
ALTER TABLE public.crm_campaign_send_pacing ADD CONSTRAINT crm_campaign_send_pacing_every_range CHECK (pause_every BETWEEN 1 AND 500);

CREATE OR REPLACE FUNCTION public.crm_campaign_phone_norm(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN length(d) IN (10,11) THEN '55'||d ELSE d END FROM (SELECT regexp_replace(split_part(coalesce(p,''),'@',1),'\D','','g') AS d) x
$$;

CREATE TABLE IF NOT EXISTS public.crm_campaign_lists (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
 kind text NOT NULL CHECK (kind IN ('individual','groups')),
 targets jsonb NOT NULL CHECK (jsonb_typeof(targets)='array' AND jsonb_array_length(targets) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.crm_campaign_lists TO service_role;
REVOKE ALL ON public.crm_campaign_lists FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_campaign_lists ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.save_crm_campaign_draft(p_id uuid,p_revision integer,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE saved public.crm_campaigns; event_kind text; cids jsonb := coalesce(p_payload->'clientIds','[]'::jsonb);
 kind text := coalesce(nullif(p_payload->>'audienceKind',''),'individual'); grp jsonb := coalesce(p_payload->'groups','[]'::jsonb); man jsonb := coalesce(p_payload->'manual','[]'::jsonb); x jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_payload->>'channel' NOT IN ('email','whatsapp') OR char_length(p_payload->>'name') NOT BETWEEN 2 AND 150 OR char_length(coalesce(p_payload->>'body',''))>10000 OR char_length(coalesce(p_payload->>'subject',''))>300 OR jsonb_typeof(p_payload->'leadIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'leadIds')>1000 OR jsonb_typeof(cids) IS DISTINCT FROM 'array' OR jsonb_array_length(cids)>1000 THEN RAISE EXCEPTION 'invalid_draft'; END IF;
 IF kind NOT IN ('individual','groups') OR jsonb_typeof(grp)<>'array' OR jsonb_typeof(man)<>'array' OR jsonb_array_length(grp)>300 OR jsonb_array_length(man)>1000 THEN RAISE EXCEPTION 'invalid_draft'; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(grp) LOOP IF coalesce(x->>'jid','') !~ '^[0-9]{5,40}(-[0-9]+)?@g\.us$' THEN RAISE EXCEPTION 'invalid_group'; END IF; END LOOP;
 FOR x IN SELECT * FROM jsonb_array_elements(man) LOOP IF coalesce(x->>'phone','') !~ '^\d{12,15}$' THEN RAISE EXCEPTION 'invalid_manual'; END IF; END LOOP;
 IF p_payload->>'channel'='email' THEN cids:='[]'::jsonb; grp:='[]'::jsonb; man:='[]'::jsonb; kind:='individual'; END IF;
 IF kind='groups' AND (jsonb_array_length(p_payload->'leadIds')>0 OR jsonb_array_length(cids)>0 OR jsonb_array_length(man)>0) THEN RAISE EXCEPTION 'mixed_audience'; END IF;
 IF kind='individual' AND jsonb_array_length(grp)>0 THEN RAISE EXCEPTION 'mixed_audience'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO crm_campaigns(name,channel,subject,body,sender_reference,instance_reference,lead_ids,client_ids,scheduled_at,audience_kind,group_targets,manual_targets) VALUES(p_payload->>'name',p_payload->>'channel',coalesce(p_payload->>'subject',''),coalesce(p_payload->>'body',''),coalesce(p_payload->>'senderReference',''),coalesce(p_payload->>'instanceReference',''),p_payload->'leadIds',cids,nullif(p_payload->>'scheduledAt','')::timestamptz,kind,grp,man) RETURNING * INTO saved;
  event_kind:='draft_created';
 ELSE
  UPDATE crm_campaigns SET name=p_payload->>'name',channel=p_payload->>'channel',subject=coalesce(p_payload->>'subject',''),body=coalesce(p_payload->>'body',''),sender_reference=coalesce(p_payload->>'senderReference',''),instance_reference=coalesce(p_payload->>'instanceReference',''),lead_ids=p_payload->'leadIds',client_ids=cids,scheduled_at=nullif(p_payload->>'scheduledAt','')::timestamptz,audience_kind=kind,group_targets=grp,manual_targets=man,revision=revision+1,updated_at=now() WHERE id=p_id AND revision=p_revision AND state='draft' RETURNING * INTO saved;
  IF saved.id IS NULL THEN RAISE EXCEPTION 'stale_or_locked'; END IF;
  event_kind:='draft_updated';
 END IF;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(saved.id,saved.channel,event_kind,jsonb_build_object('revision',saved.revision));
 RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.save_crm_campaign_draft(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_campaign_draft(uuid,integer,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.start_crm_whatsapp_campaign(p_id uuid, p_revision integer, p_recipients jsonb, p_statement text, p_actor text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns; r jsonb; n integer := 0; k integer; is_group boolean; future boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.channel<>'whatsapp' OR c.state<>'draft' OR c.revision<>p_revision THEN RAISE EXCEPTION 'stale_campaign'; END IF;
 IF btrim(c.body)='' OR c.instance_reference='' THEN RAISE EXCEPTION 'incomplete_campaign'; END IF;
 IF jsonb_typeof(p_recipients)<>'array' OR jsonb_array_length(p_recipients)=0 OR jsonb_array_length(p_recipients)>1000 THEN RAISE EXCEPTION 'invalid_recipients'; END IF;
 INSERT INTO crm_campaign_acknowledgements(campaign_id,revision,statement,actor) VALUES(c.id,c.revision,p_statement,p_actor);
 FOR r IN SELECT * FROM jsonb_array_elements(p_recipients) LOOP
  is_group := (r->>'contact') ~ '^[0-9]{5,40}(-[0-9]+)?@g\.us$';
  IF NOT is_group AND (r->>'contact') !~ '^\d{10,15}$' THEN RAISE EXCEPTION 'invalid_contact'; END IF;
  IF is_group <> (c.audience_kind='groups') THEN RAISE EXCEPTION 'mixed_audience'; END IF;
  IF NOT is_group AND EXISTS (SELECT 1 FROM crm_campaign_permissions p WHERE p.channel='whatsapp' AND crm_campaign_phone_norm(p.contact)=crm_campaign_phone_norm(r->>'contact') AND p.withdrawn_at IS NOT NULL) THEN CONTINUE; END IF;
  INSERT INTO crm_campaign_deliveries(campaign_id,lead_id,client_id,contact,state,batch_id,recipient_name,recipient_company)
   VALUES(c.id,nullif(r->>'leadId','')::uuid,nullif(r->>'clientId','')::uuid,r->>'contact','queued',c.id,left(coalesce(r->>'name',''),300),left(coalesce(r->>'company',''),300))
   ON CONFLICT (campaign_id,contact) DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
 END LOOP;
 IF n=0 THEN RAISE EXCEPTION 'no_eligible_recipients'; END IF;
 future := c.scheduled_at IS NOT NULL AND c.scheduled_at > now() + interval '1 minute';
 UPDATE crm_campaigns SET state=CASE WHEN future THEN 'scheduled' ELSE 'running' END,revision=revision+1,updated_at=now() WHERE id=c.id;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(c.id,'whatsapp',CASE WHEN future THEN 'scheduled' ELSE 'sending' END,jsonb_build_object('queued',n,'revision',c.revision,'audience',c.audience_kind));
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.start_crm_whatsapp_campaign(uuid,integer,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_crm_whatsapp_campaign(uuid,integer,jsonb,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_crm_whatsapp_delivery(p_campaign uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns; d public.crm_campaign_deliveries;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_campaign FOR UPDATE;
 IF c.id IS NULL OR c.channel<>'whatsapp' THEN RETURN NULL; END IF;
 IF c.state='scheduled' AND c.scheduled_at IS NOT NULL AND c.scheduled_at <= now() THEN
  UPDATE crm_campaigns SET state='running',revision=revision+1,updated_at=now() WHERE id=c.id RETURNING * INTO c;
  INSERT INTO crm_campaign_events(campaign_id,channel,kind) VALUES(c.id,'whatsapp','sending');
 END IF;
 IF c.state<>'running' THEN RETURN NULL; END IF;
 UPDATE crm_campaign_deliveries SET state='unknown',error_code='interrupted',updated_at=now() WHERE campaign_id=c.id AND state='reserved' AND updated_at < now() - interval '5 minutes';
 LOOP
  SELECT * INTO d FROM crm_campaign_deliveries WHERE campaign_id=c.id AND state='queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF d.id IS NULL THEN
   IF NOT EXISTS (SELECT 1 FROM crm_campaign_deliveries WHERE campaign_id=c.id AND state IN ('queued','reserved')) THEN
    UPDATE crm_campaigns SET state='completed',revision=revision+1,updated_at=now() WHERE id=c.id;
    INSERT INTO crm_campaign_events(campaign_id,channel,kind) VALUES(c.id,'whatsapp','dispatch_finished');
   END IF;
   RETURN NULL;
  END IF;
  IF d.contact !~ '@g\.us$' AND EXISTS (SELECT 1 FROM crm_campaign_permissions p WHERE p.channel='whatsapp' AND crm_campaign_phone_norm(p.contact)=crm_campaign_phone_norm(d.contact) AND p.withdrawn_at IS NOT NULL) THEN
   UPDATE crm_campaign_deliveries SET state='cancelled',error_code='opted_out',updated_at=now() WHERE id=d.id;
   CONTINUE;
  END IF;
  UPDATE crm_campaign_deliveries SET state='reserved',updated_at=now() WHERE id=d.id RETURNING * INTO d;
  RETURN jsonb_build_object('id',d.id,'contact',d.contact,'leadId',d.lead_id,'name',d.recipient_name,'company',d.recipient_company,'body',c.body,'instance',c.instance_reference);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_crm_whatsapp_delivery(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crm_whatsapp_delivery(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pause_crm_whatsapp_campaign(p_id uuid, p_pause boolean) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns; nxt text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.channel<>'whatsapp' THEN RAISE EXCEPTION 'not_found'; END IF;
 IF p_pause AND c.state='running' THEN nxt:='paused';
 ELSIF NOT p_pause AND c.state='paused' THEN nxt:='running';
 ELSE RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE crm_campaigns SET state=nxt,revision=revision+1,updated_at=now() WHERE id=c.id;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind) VALUES(c.id,'whatsapp',CASE WHEN p_pause THEN 'paused' ELSE 'resumed' END);
 RETURN nxt;
END $$;
REVOKE ALL ON FUNCTION public.pause_crm_whatsapp_campaign(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pause_crm_whatsapp_campaign(uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.stop_crm_whatsapp_campaign(p_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns; n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.channel<>'whatsapp' OR c.state NOT IN ('running','paused','scheduled') THEN RAISE EXCEPTION 'not_running'; END IF;
 UPDATE crm_campaign_deliveries SET state='cancelled',error_code='stopped',updated_at=now() WHERE campaign_id=c.id AND state='queued';
 GET DIAGNOSTICS n = ROW_COUNT;
 UPDATE crm_campaigns SET state='cancelled',revision=revision+1,updated_at=now() WHERE id=c.id;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(c.id,'whatsapp','cancelled',jsonb_build_object('unsent',n));
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.stop_crm_whatsapp_campaign(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stop_crm_whatsapp_campaign(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.save_crm_campaign_pacing(p_campaign uuid, p_min integer, p_max integer, p_every integer, p_pause integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE st text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
  SELECT state INTO st FROM crm_campaigns WHERE id=p_campaign AND channel='whatsapp' FOR UPDATE;
  IF st IS NULL OR st NOT IN ('draft','running','paused','scheduled') THEN RETURN false; END IF;
  INSERT INTO crm_campaign_send_pacing(campaign_id,min_gap_seconds,max_gap_seconds,pause_every,pause_seconds)
  VALUES (p_campaign,p_min,p_max,p_every,p_pause)
  ON CONFLICT (campaign_id) DO UPDATE SET min_gap_seconds=EXCLUDED.min_gap_seconds,max_gap_seconds=EXCLUDED.max_gap_seconds,
    pause_every=EXCLUDED.pause_every,pause_seconds=EXCLUDED.pause_seconds,
    sent_since_pause=LEAST(crm_campaign_send_pacing.sent_since_pause, EXCLUDED.pause_every),updated_at=now();
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.save_crm_campaign_pacing(uuid,integer,integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_campaign_pacing(uuid,integer,integer,integer,integer) TO service_role;