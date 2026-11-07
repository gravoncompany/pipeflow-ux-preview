-- Primeiro contato B2B: associa o disparo aceito ao Outbound e sinaliza seu estado.
ALTER TABLE public.b2b_ai_email_items
 ADD COLUMN IF NOT EXISTS outbound_follow_up text
   CHECK (outbound_follow_up IN ('pending','scheduled','sent','review')),
 ADD COLUMN IF NOT EXISTS outbound_checked_at timestamptz;

CREATE OR REPLACE FUNCTION public.b2b_prep_enqueue_lead(p_lead uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE added uuid;
BEGIN
 IF current_setting('pipeflow.b2b_after_email',true) = 'on' THEN RETURN; END IF;
 INSERT INTO b2b_prep_queue(lead_id)
 SELECT l.id FROM leads l JOIN sales_pipelines p ON p.id=l.pipeline_id
 WHERE l.id=p_lead AND l.stage='lead-novo' AND lower(p.name)='outbound' AND NOT p.archived
   AND EXISTS (SELECT 1 FROM b2b_companies b WHERE b.lead_id=l.id)
 ON CONFLICT (lead_id) DO NOTHING RETURNING lead_id INTO added;
 IF added IS NOT NULL THEN PERFORM wake_b2b_prep(); END IF;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'b2b_prep_enqueue_failed';
END $$;

CREATE OR REPLACE FUNCTION public.crm_automation_capture_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF current_setting('pipeflow.b2b_after_email',true) = 'on' THEN RETURN NULL; END IF;
 IF NEW.pipeline_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.pipeline_id IS NOT DISTINCT FROM NEW.pipeline_id) THEN RETURN NULL; END IF;
 BEGIN
  IF EXISTS (SELECT 1 FROM crm_automations WHERE trigger_pipeline_id = NEW.pipeline_id AND state IN ('test','active')) THEN
   INSERT INTO crm_automation_entries(lead_id, pipeline_id) VALUES (NEW.id, NEW.pipeline_id) ON CONFLICT DO NOTHING;
  END IF;
 EXCEPTION WHEN OTHERS THEN NULL; -- nunca impede a gravação do card
 END;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.track_b2b_outbound_email(p_id uuid, p_sent boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 item public.b2b_ai_email_items; card record; target uuid; lead uuid;
 place text; imported jsonb; segment text; label text; event_id text; detail text;
 previous_guard text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO item FROM b2b_ai_email_items WHERE id=p_id FOR UPDATE;
 IF item.id IS NULL OR item.send_state <> 'accepted' OR item.outbound_follow_up IS NULL
    OR item.outbound_follow_up NOT IN ('pending','scheduled') THEN RETURN false; END IF;
 IF p_sent AND item.scheduled_for > now() THEN RETURN false; END IF;

 lead := item.send_lead_id;
 place := coalesce(nullif(item.company->>'mapsPlaceId',''),
   CASE WHEN item.company_key ~ '^(ChI|GhI|Ei)[A-Za-z0-9_-]{8,297}$' THEN item.company_key END);
 segment := nullif(left(btrim(coalesce(nullif(item.company->>'segmentTag',''),item.company->>'segment','')),100),'');
 label := CASE WHEN p_sent THEN 'E-mail enviado' ELSE 'E-mail agendado' END;
 event_id := 'b2b-first-email:'||item.id||CASE WHEN p_sent THEN '' ELSE ':scheduled' END;
 detail := 'Primeiro contato B2B · E-mail'||chr(10)||
   CASE WHEN p_sent THEN 'Enviado pela Brevo — '
        ELSE 'Agendado na Brevo para '||to_char(item.scheduled_for AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' — ' END||
   'assunto "'||left(item.subject,200)||'" para '||item.recipient||'.';

 IF lead IS NULL AND place IS NOT NULL AND place = item.company_key THEN
  SELECT lead_id INTO lead FROM b2b_companies WHERE place_id=place;
  IF lead IS NULL THEN
   SELECT id INTO target FROM sales_pipelines
    WHERE NOT archived AND lower(btrim(name))='outbound'
    AND stages->0->>'id'='lead-novo' AND stages @> '[{"id":"tentando-contato"}]'::jsonb
    AND (SELECT count(*) FROM sales_pipelines WHERE NOT archived AND lower(btrim(name))='outbound')=1;
   IF target IS NOT NULL THEN
    -- Este ingresso já tem um primeiro contato. Não ativa gatilhos de nova prospecção.
    previous_guard := coalesce(current_setting('pipeflow.b2b_after_email',true),'');
    PERFORM set_config('pipeflow.b2b_after_email','on',true);
    imported := import_b2b_companies(target,jsonb_build_array(jsonb_build_object(
      'placeId',place,'cnpj','','legalName','','tradeName',item.company->>'name',
      'registrationStatus','','segment',coalesce(segment,''),'city',coalesce(item.company->>'city',''),
      'state',coalesce(item.company->>'state',''),'address',coalesce(item.company->>'address',''),
      'phones',CASE WHEN item.company->>'whatsapp' ~ '^[0-9]{8,15}$' THEN jsonb_build_array(item.company->>'whatsapp') ELSE '[]'::jsonb END,
      'emails',jsonb_build_array(item.recipient),'website',coalesce(item.company->>'website',''),'instagram','',
      'source','manual','sourceReference',coalesce(nullif(item.company->>'source',''),'Google Maps'),
      'identityConfirmed',true,'storageAuthorized',true)));
    PERFORM set_config('pipeflow.b2b_after_email',previous_guard,true);
    -- Quando e-mail ou telefone colide com outro cadastro, não adivinha o vínculo.
    SELECT lead_id INTO lead FROM b2b_companies WHERE place_id=place;
    IF lead IS NOT NULL AND imported->0->>'status'='created' THEN
     UPDATE leads SET history=(
      SELECT coalesce(jsonb_agg(CASE WHEN h->>'text'='Importado após revisão pela Prospecção B2B. Nenhum contato enviado.'
        THEN jsonb_set(h,'{text}',to_jsonb('Criado pelo primeiro contato da Prospecção B2B.'::text)) ELSE h END ORDER BY ord),'[]'::jsonb)
      FROM jsonb_array_elements(history) WITH ORDINALITY AS t(h,ord)
     ),next_action='Acompanhar retorno do primeiro e-mail' WHERE id=lead;
    END IF;
   END IF;
  END IF;
 END IF;

 IF lead IS NULL THEN
  UPDATE b2b_ai_email_items SET outbound_follow_up=CASE WHEN place IS NULL THEN NULL ELSE 'review' END WHERE id=p_id;
  RETURN false;
 END IF;
 SELECT l.id,l.tags,l.history,p.name,p.archived INTO card FROM leads l
 LEFT JOIN sales_pipelines p ON p.id=l.pipeline_id WHERE l.id=lead FOR UPDATE OF l;
 IF card.id IS NULL THEN
  UPDATE b2b_ai_email_items SET outbound_follow_up='review' WHERE id=p_id;
  RETURN false;
 END IF;

 IF lower(btrim(card.name))='outbound' AND NOT card.archived THEN
  UPDATE leads SET tags=(
   SELECT coalesce(jsonb_agg(to_jsonb(tag) ORDER BY first_pos),'[]'::jsonb)
   FROM (SELECT tag,min(ord) AS first_pos
     FROM jsonb_array_elements_text(
      (CASE WHEN jsonb_typeof(card.tags)='array' THEN card.tags ELSE '[]'::jsonb END)
       || jsonb_build_array(segment,label)) WITH ORDINALITY AS t(tag,ord)
     WHERE tag IS NOT NULL AND (NOT p_sent OR tag<>'E-mail agendado') GROUP BY tag) tags
  ) WHERE id=lead;
  IF p_sent THEN
   PERFORM crm_email_sent_effects(lead,event_id,detail);
  END IF;
 END IF;

 -- Registra a programação sem adiantar etapa. Outros funis recebem apenas o histórico.
 IF NOT p_sent OR lower(btrim(coalesce(card.name,'')))<>'outbound' OR coalesce(card.archived,true) THEN
  UPDATE leads SET history=(CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END)
   || jsonb_build_array(jsonb_build_object('id',event_id,'date',now(),'kind','email_marketing','source','Pipeflow','text',left(detail,600)))
  WHERE id=lead AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(history)='array' THEN history ELSE '[]'::jsonb END) h WHERE h->>'id'=event_id);
 END IF;

 UPDATE b2b_ai_email_items SET send_lead_id=lead,
  outbound_follow_up=CASE WHEN lower(btrim(card.name))='outbound' AND NOT card.archived
   THEN CASE WHEN p_sent THEN 'sent' ELSE 'scheduled' END ELSE NULL END
 WHERE id=p_id;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.finish_b2b_ai_email_send(p_id uuid,p_state text,p_provider_id text,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public.b2b_ai_email_items;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE b2b_ai_email_items SET send_state=p_state,provider_message_id=nullif(left(coalesce(p_provider_id,''),300),''),
  send_error=left(coalesce(p_error,''),120),
  sent_at=CASE WHEN p_state='accepted' THEN coalesce(scheduled_for,now()) END,
  outbound_follow_up=CASE WHEN p_state='accepted' THEN 'pending' END
 WHERE id=p_id AND send_state='reserved' RETURNING * INTO item;
 IF item.id IS NULL THEN RETURN false; END IF;
 IF p_state='accepted' THEN
  BEGIN
   PERFORM track_b2b_outbound_email(p_id,item.scheduled_for IS NULL);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'b2b_outbound_tracking_pending';
  END;
 END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.settle_b2b_ai_email_sends()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer; item record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 UPDATE b2b_ai_email_items SET send_state='unknown', send_error='worker_outcome_unknown'
 WHERE send_state='reserved' AND send_reserved_at<now()-interval '10 minutes';
 GET DIAGNOSTICS n = ROW_COUNT;
 FOR item IN SELECT id,scheduled_for FROM b2b_ai_email_items
  WHERE send_state='accepted' AND outbound_follow_up='pending'
  AND (outbound_checked_at IS NULL OR outbound_checked_at<now()-interval '5 minutes')
  ORDER BY outbound_checked_at NULLS FIRST LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  UPDATE b2b_ai_email_items SET outbound_checked_at=now() WHERE id=item.id;
  BEGIN
   PERFORM track_b2b_outbound_email(item.id,item.scheduled_for IS NULL);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'b2b_outbound_tracking_pending';
  END;
 END LOOP;
 RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.track_b2b_outbound_email(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.track_b2b_outbound_email(uuid,boolean) TO service_role;
