-- E-mail Marketing: remetente configurado, endereços próprios de teste, reserva atômica por destinatário
-- (evita envio duplicado) e cancelamento de agendamentos. Tudo service-only, chamado por funções de
-- servidor com sessão CRM completa. Consentimento exato (0064/0065) continua obrigatório e é rechecado aqui.

CREATE TABLE public.crm_campaign_email_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 sender_email text NOT NULL DEFAULT '' CHECK (sender_email = lower(btrim(sender_email)) AND char_length(sender_email) <= 254),
 sender_name text NOT NULL DEFAULT '' CHECK (char_length(sender_name) <= 70),
 reply_to text NOT NULL DEFAULT '' CHECK (reply_to = lower(btrim(reply_to)) AND char_length(reply_to) <= 254),
 timezone text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK (char_length(timezone) BETWEEN 1 AND 64),
 revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz
);
INSERT INTO public.crm_campaign_email_settings (id) VALUES (true);
GRANT SELECT ON public.crm_campaign_email_settings TO service_role;
REVOKE ALL ON public.crm_campaign_email_settings FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_campaign_email_settings ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_campaign_email_settings IS 'Remetente e fuso das campanhas de e-mail. Sem credenciais: a chave da Brevo fica apenas em BREVO_API_KEY no servidor.';

CREATE TABLE public.crm_campaign_test_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 6 AND 254),
 label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 80),
 evidence text NOT NULL CHECK (char_length(evidence) BETWEEN 10 AND 500),
 recorded_by text NOT NULL CHECK (char_length(recorded_by) BETWEEN 2 AND 254),
 authorized_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
GRANT SELECT ON public.crm_campaign_test_recipients TO service_role;
REVOKE ALL ON public.crm_campaign_test_recipients FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_campaign_test_recipients ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_campaign_test_recipients IS 'Endereços próprios autorizados explicitamente para receber envios de teste. Não autorizam campanhas para leads.';

CREATE TABLE public.crm_campaign_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES public.crm_campaigns(id),
 lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
 contact text NOT NULL CHECK (contact = lower(btrim(contact))),
 state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','accepted','scheduled','failed','unknown','cancelled')),
 batch_id uuid NOT NULL,
 scheduled_at timestamptz,
 provider_message_id text CHECK (char_length(provider_message_id) <= 300),
 error_code text CHECK (char_length(error_code) <= 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (campaign_id, contact)
);
CREATE INDEX crm_campaign_deliveries_state_idx ON public.crm_campaign_deliveries (state, created_at);
GRANT SELECT ON public.crm_campaign_deliveries TO service_role;
REVOKE ALL ON public.crm_campaign_deliveries FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_campaign_deliveries ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.crm_campaign_deliveries IS 'Uma linha por campanha+contato, reservada antes da chamada ao provedor. Desconhecido nunca é reenviado.';

ALTER TABLE public.crm_campaign_events DROP CONSTRAINT IF EXISTS crm_campaign_events_kind_check;
ALTER TABLE public.crm_campaign_events ADD CONSTRAINT crm_campaign_events_kind_check CHECK (kind IN ('draft_created','draft_updated','cancelled','consent_recorded','consent_withdrawn','scheduled','sending','accepted','delivered','read','failed','replied','unknown','settings_updated','test_recipient_recorded','test_recipient_revoked','test_reserved','test_sent','test_failed','dispatch_finished'));

CREATE FUNCTION public.save_crm_campaign_email_settings(p_revision integer, p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE saved public.crm_campaign_email_settings;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE crm_campaign_email_settings SET sender_email=lower(btrim(p_payload->>'senderEmail')), sender_name=btrim(p_payload->>'senderName'), reply_to=lower(btrim(coalesce(p_payload->>'replyTo',''))), timezone=btrim(p_payload->>'timezone'), revision=revision+1, updated_at=now()
  WHERE id AND revision=p_revision RETURNING * INTO saved;
 IF saved.id IS NULL THEN RAISE EXCEPTION 'stale_settings'; END IF;
 INSERT INTO crm_campaign_events(channel,kind,details) VALUES('email','settings_updated',jsonb_build_object('revision',saved.revision));
 RETURN to_jsonb(saved);
END $$;

CREATE FUNCTION public.record_crm_campaign_test_recipient(p_email text, p_label text, p_evidence text, p_recorded_by text, p_revoke boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.crm_campaign_test_recipients;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_revoke THEN
  UPDATE crm_campaign_test_recipients SET revoked_at=now() WHERE email=lower(btrim(p_email)) AND revoked_at IS NULL RETURNING * INTO r;
  IF r.id IS NULL THEN RETURN false; END IF;
  INSERT INTO crm_campaign_events(channel,kind,details) VALUES('email','test_recipient_revoked',jsonb_build_object('test_recipient',r.id));
  RETURN true;
 END IF;
 IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=lower(btrim(p_email))) THEN RAISE EXCEPTION 'suppressed_contact'; END IF;
 INSERT INTO crm_campaign_test_recipients(email,label,evidence,recorded_by) VALUES(lower(btrim(p_email)),btrim(p_label),p_evidence,p_recorded_by)
  ON CONFLICT (email) DO UPDATE SET label=excluded.label, evidence=excluded.evidence, recorded_by=excluded.recorded_by, authorized_at=now(), revoked_at=NULL RETURNING * INTO r;
 INSERT INTO crm_campaign_events(channel,kind,details) VALUES('email','test_recipient_recorded',jsonb_build_object('test_recipient',r.id));
 RETURN true;
END $$;

-- Limite atômico de testes: o lock na linha de configuração serializa reservas concorrentes.
CREATE FUNCTION public.reserve_crm_campaign_test(p_recipient uuid, p_campaign uuid, p_limit integer, p_window_seconds integer) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.crm_campaign_test_recipients; recent integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 PERFORM 1 FROM crm_campaign_email_settings WHERE id FOR UPDATE;
 SELECT * INTO r FROM crm_campaign_test_recipients WHERE id=p_recipient AND revoked_at IS NULL;
 IF r.id IS NULL THEN RAISE EXCEPTION 'test_recipient_not_authorized'; END IF;
 IF EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=r.email) THEN RAISE EXCEPTION 'suppressed_contact'; END IF;
 SELECT count(*) INTO recent FROM crm_campaign_events WHERE kind='test_reserved' AND created_at > now() - make_interval(secs => p_window_seconds);
 IF recent >= p_limit THEN RAISE EXCEPTION 'test_rate_limited'; END IF;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(p_campaign,'email','test_reserved',jsonb_build_object('test_recipient',r.id));
 RETURN r.email;
END $$;

CREATE FUNCTION public.finish_crm_campaign_test(p_recipient uuid, p_campaign uuid, p_state text, p_message_id text, p_error text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(p_campaign,'email',CASE WHEN p_state='accepted' THEN 'test_sent' ELSE 'test_failed' END,jsonb_build_object('test_recipient',p_recipient,'state',left(p_state,20),'message_id',left(coalesce(p_message_id,''),300),'error',left(coalesce(p_error,''),120)));
 RETURN true;
END $$;

-- Reserva única: muda o rascunho exato (revisão e data validadas) para em envio/agendada e recheca
-- cada destinatário dentro da mesma transação. Qualquer divergência aborta tudo.
CREATE FUNCTION public.claim_crm_campaign_email(p_id uuid, p_revision integer, p_recipients jsonb, p_scheduled_at timestamptz, p_batch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
  IF lead_contact IS NULL OR lead_contact IS DISTINCT FROM item->>'contact' THEN RAISE EXCEPTION 'contact_changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM crm_campaign_permissions WHERE lead_id=(item->>'lead_id')::uuid AND channel='email' AND contact=lead_contact AND withdrawn_at IS NULL)
     OR EXISTS (SELECT 1 FROM crm_campaign_permissions WHERE channel='email' AND contact=lead_contact AND withdrawn_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM b2b_email_suppressions WHERE email=lead_contact) THEN RAISE EXCEPTION 'recipient_not_eligible'; END IF;
  INSERT INTO crm_campaign_deliveries(campaign_id,lead_id,contact,batch_id,scheduled_at) VALUES(c.id,(item->>'lead_id')::uuid,lead_contact,p_batch,p_scheduled_at) RETURNING * INTO d;
  out := out || jsonb_build_array(jsonb_build_object('id',d.id,'lead_id',d.lead_id,'contact',d.contact));
 END LOOP;
 UPDATE crm_campaigns SET state=CASE WHEN p_scheduled_at IS NULL THEN 'running' ELSE 'scheduled' END, revision=revision+1, updated_at=now() WHERE id=c.id;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(c.id,'email',CASE WHEN p_scheduled_at IS NULL THEN 'sending' ELSE 'scheduled' END,jsonb_build_object('recipients',jsonb_array_length(out),'batch',p_batch,'scheduled_at',p_scheduled_at));
 RETURN out;
END $$;

CREATE FUNCTION public.finish_crm_campaign_delivery(p_delivery uuid, p_state text, p_message_id text, p_error text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.crm_campaign_deliveries;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('accepted','scheduled','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE crm_campaign_deliveries SET state=p_state, provider_message_id=nullif(left(coalesce(p_message_id,''),300),''), error_code=nullif(left(coalesce(p_error,''),120),''), updated_at=now() WHERE id=p_delivery AND state='reserved' RETURNING * INTO d;
 IF d.id IS NULL THEN RETURN false; END IF;
 INSERT INTO crm_campaign_events(campaign_id,lead_id,channel,kind,details) VALUES(d.campaign_id,d.lead_id,'email',p_state,jsonb_build_object('delivery',d.id));
 RETURN true;
END $$;

CREATE FUNCTION public.complete_crm_campaign_dispatch(p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
 IF EXISTS (SELECT 1 FROM crm_campaign_deliveries WHERE campaign_id=p_id AND state='reserved') THEN RETURN c.state; END IF;
 IF c.state='running' OR (c.state='scheduled' AND NOT EXISTS (SELECT 1 FROM crm_campaign_deliveries WHERE campaign_id=p_id AND state='scheduled')) THEN
  UPDATE crm_campaigns SET state='completed', revision=revision+1, updated_at=now() WHERE id=p_id RETURNING * INTO c;
  INSERT INTO crm_campaign_events(campaign_id,channel,kind) VALUES(p_id,'email','dispatch_finished');
 END IF;
 RETURN c.state;
END $$;

-- Recuperação sem reenvio: reservas antigas viram desconhecidas; agendamentos vencidos viram aceitos.
CREATE FUNCTION public.settle_crm_campaigns() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer := 0; d record; c record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 FOR d IN UPDATE crm_campaign_deliveries SET state='unknown', error_code='worker_outcome_unknown', updated_at=now() WHERE state='reserved' AND created_at < now() - interval '10 minutes' RETURNING id,campaign_id,lead_id LOOP
  INSERT INTO crm_campaign_events(campaign_id,lead_id,channel,kind,details) VALUES(d.campaign_id,d.lead_id,'email','unknown',jsonb_build_object('delivery',d.id,'reason','worker_outcome_unknown'));
  n := n + 1;
 END LOOP;
 UPDATE crm_campaign_deliveries SET state='accepted', updated_at=now() WHERE state='scheduled' AND scheduled_at < now() - interval '15 minutes';
 FOR c IN SELECT id FROM crm_campaigns WHERE state IN ('running','scheduled') AND NOT EXISTS (SELECT 1 FROM crm_campaign_deliveries x WHERE x.campaign_id=crm_campaigns.id AND x.state IN ('reserved','scheduled')) AND EXISTS (SELECT 1 FROM crm_campaign_deliveries x WHERE x.campaign_id=crm_campaigns.id) LOOP
  UPDATE crm_campaigns SET state='completed', revision=revision+1, updated_at=now() WHERE id=c.id;
  INSERT INTO crm_campaign_events(campaign_id,channel,kind) VALUES(c.id,'email','dispatch_finished');
 END LOOP;
 RETURN n;
END $$;

-- Rascunhos continuam canceláveis como antes; uma campanha agendada no provedor só é cancelada pelo
-- fluxo que cancela primeiro na Brevo (cancel_crm_campaign_schedule).
CREATE OR REPLACE FUNCTION public.cancel_crm_campaign(p_id uuid,p_revision integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE crm_campaigns SET state='cancelled',revision=revision+1,updated_at=now() WHERE id=p_id AND revision=p_revision AND state IN ('draft','scheduled')
  AND NOT EXISTS (SELECT 1 FROM crm_campaign_deliveries d WHERE d.campaign_id=p_id) RETURNING * INTO c;
 IF c.id IS NULL THEN RETURN false; END IF;
 INSERT INTO crm_campaign_events(campaign_id,channel,kind) VALUES(c.id,c.channel,'cancelled');
 RETURN true;
END $$;

CREATE FUNCTION public.cancel_crm_campaign_schedule(p_id uuid, p_revision integer, p_cancelled uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.crm_campaigns; remaining integer; changed integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO c FROM crm_campaigns WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.state <> 'scheduled' OR c.revision <> p_revision THEN RAISE EXCEPTION 'stale_or_locked'; END IF;
 UPDATE crm_campaign_deliveries SET state='cancelled', updated_at=now() WHERE campaign_id=p_id AND state='scheduled' AND id = ANY(coalesce(p_cancelled,'{}'));
 GET DIAGNOSTICS changed = ROW_COUNT;
 SELECT count(*) INTO remaining FROM crm_campaign_deliveries WHERE campaign_id=p_id AND state IN ('scheduled','reserved');
 IF remaining = 0 THEN
  UPDATE crm_campaigns SET state='cancelled', revision=revision+1, updated_at=now() WHERE id=p_id;
  INSERT INTO crm_campaign_events(campaign_id,channel,kind,details) VALUES(p_id,'email','cancelled',jsonb_build_object('cancelled',changed));
 END IF;
 RETURN jsonb_build_object('cancelled',changed,'remaining',remaining);
END $$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['save_crm_campaign_email_settings(integer,jsonb)','record_crm_campaign_test_recipient(text,text,text,text,boolean)','reserve_crm_campaign_test(uuid,uuid,integer,integer)','finish_crm_campaign_test(uuid,uuid,text,text,text)','claim_crm_campaign_email(uuid,integer,jsonb,timestamptz,uuid)','finish_crm_campaign_delivery(uuid,text,text,text)','complete_crm_campaign_dispatch(uuid)','settle_crm_campaigns()','cancel_crm_campaign(uuid,integer)','cancel_crm_campaign_schedule(uuid,integer,uuid[])'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
 END LOOP;
END $$;
