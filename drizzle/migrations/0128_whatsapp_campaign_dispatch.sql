-- Campanhas de WhatsApp: ciência única do usuário (sem consentimento por ficha), fila por destinatário
-- com reserva atômica antes do envio, sem reenvio de resultado desconhecido. Descadastros continuam excluídos.
ALTER TABLE public.crm_campaign_deliveries ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE public.crm_campaign_deliveries ADD COLUMN IF NOT EXISTS recipient_name text NOT NULL DEFAULT '' CHECK (char_length(recipient_name) <= 300);
ALTER TABLE public.crm_campaign_deliveries ADD COLUMN IF NOT EXISTS recipient_company text NOT NULL DEFAULT '' CHECK (char_length(recipient_company) <= 300);
ALTER TABLE public.crm_campaign_deliveries DROP CONSTRAINT IF EXISTS crm_campaign_deliveries_state_check;
ALTER TABLE public.crm_campaign_deliveries ADD CONSTRAINT crm_campaign_deliveries_state_check CHECK (state IN ('queued','reserved','accepted','scheduled','failed','unknown','cancelled'));
CREATE INDEX IF NOT EXISTS crm_campaign_deliveries_campaign_state_idx ON public.crm_campaign_deliveries (campaign_id, state, created_at);

CREATE TABLE IF NOT EXISTS public.crm_campaign_acknowledgements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES public.crm_campaigns(id),
 revision integer NOT NULL,
 statement text NOT NULL CHECK (char_length(statement) BETWEEN 20 AND 1000),
 actor text NOT NULL CHECK (char_length(actor) BETWEEN 2 AND 254),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.crm_campaign_acknowledgements TO service_role;
REVOKE ALL ON public.crm_campaign_acknowledgements FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_campaign_acknowledgements ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_campaign_acknowledgements IS 'Ciência registrada pelo usuário ao iniciar uma campanha de WhatsApp (texto exato, revisão e autor).';

CREATE OR REPLACE FUNCTION public.start_crm_whatsapp_campaign(p_id uuid, p_revision integer, p_recipients jsonb, p_statement text, p_actor text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns; r jsonb; n integer := 0; k integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.channel<>'whatsapp' OR c.state<>'draft' OR c.revision<>p_revision THEN RAISE EXCEPTION 'stale_campaign'; END IF;
 IF btrim(c.body)='' OR c.instance_reference='' THEN RAISE EXCEPTION 'incomplete_campaign'; END IF;
 IF jsonb_typeof(p_recipients)<>'array' OR jsonb_array_length(p_recipients)=0 OR jsonb_array_length(p_recipients)>1000 THEN RAISE EXCEPTION 'invalid_recipients'; END IF;
 INSERT INTO crm_campaign_acknowledgements(campaign_id,revision,statement,actor) VALUES(c.id,c.revision,p_statement,p_actor);
 FOR r IN SELECT * FROM jsonb_array_elements(p_recipients) LOOP
  IF (r->>'contact') !~ '^\d{10,15}$' THEN RAISE EXCEPTION 'invalid_contact'; END IF;
  -- Pedido de não recebimento registrado vence sempre.
  IF EXISTS (SELECT 1 FROM crm_campaign_permissions p WHERE p.channel='whatsapp' AND p.contact=r->>'contact' AND p.withdrawn_at IS NOT NULL) THEN CONTINUE; END IF;
  INSERT INTO crm_campaign_deliveries(campaign_id,lead_id,client_id,contact,state,batch_id,recipient_name,recipient_company)
   VALUES(c.id,nullif(r->>'leadId','')::uuid,nullif(r->>'clientId','')::uuid,r->>'contact','queued',c.id,left(coalesce(r->>'name',''),300),left(coalesce(r->>'company',''),300))
   ON CONFLICT (campaign_id,contact) DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
 END LOOP;
 IF n=0 THEN RAISE EXCEPTION 'no_eligible_recipients'; END IF;
 UPDATE crm_campaigns SET state='running',revision=revision+1,updated_at=now() WHERE id=c.id;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(c.id,'whatsapp','sending',jsonb_build_object('queued',n,'revision',c.revision));
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.start_crm_whatsapp_campaign(uuid,integer,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_crm_whatsapp_campaign(uuid,integer,jsonb,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_crm_whatsapp_delivery(p_campaign uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns; d public.crm_campaign_deliveries;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_campaign FOR UPDATE;
 IF c.id IS NULL OR c.channel<>'whatsapp' OR c.state<>'running' THEN RETURN NULL; END IF;
 -- Reservas interrompidas viram desconhecidas e nunca são reenviadas.
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
  IF EXISTS (SELECT 1 FROM crm_campaign_permissions p WHERE p.channel='whatsapp' AND p.contact=d.contact AND p.withdrawn_at IS NOT NULL) THEN
   UPDATE crm_campaign_deliveries SET state='cancelled',error_code='opted_out',updated_at=now() WHERE id=d.id;
   CONTINUE;
  END IF;
  UPDATE crm_campaign_deliveries SET state='reserved',updated_at=now() WHERE id=d.id RETURNING * INTO d;
  RETURN jsonb_build_object('id',d.id,'contact',d.contact,'leadId',d.lead_id,'name',d.recipient_name,'company',d.recipient_company,'body',c.body,'instance',c.instance_reference);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_crm_whatsapp_delivery(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crm_whatsapp_delivery(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_crm_whatsapp_delivery(p_id uuid, p_state text, p_message_id text, p_error text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.crm_campaign_deliveries;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE crm_campaign_deliveries SET state=p_state,provider_message_id=left(nullif(p_message_id,''),300),error_code=left(nullif(p_error,''),120),updated_at=now() WHERE id=p_id AND state='reserved' RETURNING * INTO d;
 IF d.id IS NULL THEN RETURN false; END IF;
 INSERT INTO crm_campaign_events(campaign_id,lead_id,channel,kind,details) VALUES(d.campaign_id,d.lead_id,'whatsapp',p_state,jsonb_build_object('delivery',d.id));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_crm_whatsapp_delivery(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_crm_whatsapp_delivery(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.stop_crm_whatsapp_campaign(p_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns; n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.channel<>'whatsapp' OR c.state<>'running' THEN RAISE EXCEPTION 'not_running'; END IF;
 UPDATE crm_campaign_deliveries SET state='cancelled',error_code='stopped',updated_at=now() WHERE campaign_id=c.id AND state='queued';
 GET DIAGNOSTICS n = ROW_COUNT;
 UPDATE crm_campaigns SET state='cancelled',revision=revision+1,updated_at=now() WHERE id=c.id;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(c.id,'whatsapp','cancelled',jsonb_build_object('unsent',n));
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.stop_crm_whatsapp_campaign(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stop_crm_whatsapp_campaign(uuid) TO service_role;