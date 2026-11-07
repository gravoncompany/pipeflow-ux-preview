CREATE OR REPLACE FUNCTION public.create_crm_client_card(p_actor text, p_client uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.crm_clients%ROWTYPE; new_lead uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:clients',0));
  SELECT * INTO c FROM public.crm_clients WHERE id=p_client FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  IF c.lead_id IS NOT NULL THEN RETURN c.lead_id; END IF;
  INSERT INTO public.leads(name,company,whatsapp,email,website,source,stage,pipeline_id,history)
  VALUES(left(coalesce(nullif(c.contact_name,''),c.trade_name),200),left(c.trade_name,200),left(coalesce(nullif(c.whatsapp,''),c.phone,''),40),left(coalesce(c.email,''),200),left(coalesce(c.website,''),500),'Clientes','fechado',NULL,
    jsonb_build_array(jsonb_build_object('id','client:'||c.id||':card','date',now(),'text','Card criado a partir do cadastro de cliente.','kind','client_card_created','source','clients','client',c.id,'responsible',left(p_actor,160))))
  RETURNING id INTO new_lead;
  UPDATE public.crm_clients SET lead_id=new_lead, revision=revision+1, updated_at=now() WHERE id=c.id;
  RETURN new_lead;
END $$;
REVOKE ALL ON FUNCTION public.create_crm_client_card(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_crm_client_card(text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.link_crm_client_card(p_actor text, p_client uuid, p_lead uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.crm_clients%ROWTYPE; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:clients',0));
  SELECT * INTO c FROM public.crm_clients WHERE id=p_client FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'client_unavailable'; END IF;
  IF c.lead_id = p_lead THEN RETURN p_lead; END IF;
  IF c.lead_id IS NOT NULL THEN RAISE EXCEPTION 'client_already_linked'; END IF;
  PERFORM 1 FROM public.leads WHERE id=p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_clients WHERE lead_id=p_lead) THEN RAISE EXCEPTION 'already_client'; END IF;
  UPDATE public.crm_clients SET lead_id=p_lead, revision=revision+1, updated_at=now() WHERE id=c.id;
  UPDATE public.leads SET history=coalesce(history,'[]'::jsonb)||jsonb_build_object('id','client:'||c.id||':linked','date',now(),'text','Card vinculado manualmente ao cliente '||c.trade_name||'.','kind','client_card_linked','source','clients','client',c.id,'responsible',left(p_actor,160)) WHERE id=p_lead;
  RETURN p_lead;
END $$;
REVOKE ALL ON FUNCTION public.link_crm_client_card(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.link_crm_client_card(text,uuid,uuid) TO service_role;

ALTER TABLE public.crm_campaigns ADD COLUMN IF NOT EXISTS client_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.save_crm_campaign_draft(p_id uuid,p_revision integer,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE saved public.crm_campaigns; event_kind text; cids jsonb := coalesce(p_payload->'clientIds','[]'::jsonb);
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_payload->>'channel' NOT IN ('email','whatsapp') OR char_length(p_payload->>'name') NOT BETWEEN 2 AND 150 OR char_length(coalesce(p_payload->>'body',''))>10000 OR char_length(coalesce(p_payload->>'subject',''))>300 OR jsonb_typeof(p_payload->'leadIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'leadIds')>1000 OR jsonb_typeof(cids) IS DISTINCT FROM 'array' OR jsonb_array_length(cids)>1000 THEN RAISE EXCEPTION 'invalid_draft'; END IF;
 IF p_payload->>'channel'='email' THEN cids:='[]'::jsonb; END IF;
 IF p_id IS NULL THEN
  INSERT INTO crm_campaigns(name,channel,subject,body,sender_reference,instance_reference,lead_ids,client_ids,scheduled_at) VALUES(p_payload->>'name',p_payload->>'channel',coalesce(p_payload->>'subject',''),coalesce(p_payload->>'body',''),coalesce(p_payload->>'senderReference',''),coalesce(p_payload->>'instanceReference',''),p_payload->'leadIds',cids,nullif(p_payload->>'scheduledAt','')::timestamptz) RETURNING * INTO saved;
  event_kind:='draft_created';
 ELSE
  UPDATE crm_campaigns SET name=p_payload->>'name',channel=p_payload->>'channel',subject=coalesce(p_payload->>'subject',''),body=coalesce(p_payload->>'body',''),sender_reference=coalesce(p_payload->>'senderReference',''),instance_reference=coalesce(p_payload->>'instanceReference',''),lead_ids=p_payload->'leadIds',client_ids=cids,scheduled_at=nullif(p_payload->>'scheduledAt','')::timestamptz,revision=revision+1,updated_at=now() WHERE id=p_id AND revision=p_revision AND state='draft' RETURNING * INTO saved;
  IF saved.id IS NULL THEN RAISE EXCEPTION 'stale_or_locked'; END IF;
  event_kind:='draft_updated';
 END IF;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(saved.id,saved.channel,event_kind,jsonb_build_object('revision',saved.revision));
 RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.save_crm_campaign_draft(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_campaign_draft(uuid,integer,jsonb) TO service_role;