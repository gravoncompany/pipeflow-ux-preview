-- Mensagens de Referência: textos de campanhas (Google Ads / Meta Ads) que identificam a origem
-- do lead e o funil/etapa de entrada. Service-only; o navegador acessa apenas por server functions.
-- Idempotente: pode ser reaplicada sem duplicar objetos; não insere referências nem altera dados existentes.

CREATE OR REPLACE FUNCTION public.crm_phone_key(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
-- Mirrors src/lib/phone.ts phoneKey (DDD + last 8 digits).
DECLARE d text := regexp_replace(split_part(coalesce(p,''),'@',1),'[^0-9]','','g'); BEGIN
 IF length(d)>=12 AND left(d,2)='55' THEN d:=substr(d,3); END IF;
 IF length(d)<10 THEN RETURN right(d,8); END IF;
 RETURN left(d,2)||right(d,8);
END $$;

CREATE OR REPLACE FUNCTION public.crm_phone_digits(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
-- Mirrors src/lib/phone.ts phoneDigits.
DECLARE d text := regexp_replace(split_part(coalesce(p,''),'@',1),'[^0-9]','','g'); BEGIN
 IF length(d) IN (10,11) THEN d:='55'||d; END IF;
 RETURN d;
END $$;

CREATE OR REPLACE FUNCTION public.crm_same_whatsapp(a text, b text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
-- Mirrors sameWhatsAppNumber: complete number, or only Brazil's optional mobile ninth digit.
DECLARE x text := public.crm_phone_digits(a); y text := public.crm_phone_digits(b); s text; l text; BEGIN
 IF x !~ '^[0-9]{10,15}$' OR y !~ '^[0-9]{10,15}$' THEN RETURN false; END IF;
 IF x=y THEN RETURN true; END IF;
 IF length(x)<length(y) THEN s:=x; l:=y; ELSE s:=y; l:=x; END IF;
 RETURN s ~ '^55[1-9][0-9][6-9][0-9]{7}$' AND length(l)=13 AND l=left(s,4)||'9'||substr(s,5);
END $$;

CREATE OR REPLACE FUNCTION public.crm_normalize_reference(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT translate(lower(regexp_replace(btrim(coalesce(p,'')),'\s+',' ','g')),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')
$$;

CREATE TABLE IF NOT EXISTS public.crm_reference_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 5 AND 1000),
 normalized_body text GENERATED ALWAYS AS (public.crm_normalize_reference(body)) STORED,
 match_mode text NOT NULL DEFAULT 'exact' CHECK (match_mode IN ('exact','contains')),
 source text NOT NULL CHECK (source IN ('google_ads','meta_ads')),
 pipeline_id uuid REFERENCES public.sales_pipelines(id), -- NULL = Funil principal
 stage_id text NOT NULL CHECK (char_length(stage_id) BETWEEN 1 AND 80),
 active boolean NOT NULL DEFAULT true,
 revision bigint NOT NULL DEFAULT 1,
 updated_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_reference_messages_unique ON public.crm_reference_messages(normalized_body, match_mode);
REVOKE ALL ON public.crm_reference_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_reference_messages TO service_role;
ALTER TABLE public.crm_reference_messages ENABLE ROW LEVEL SECURITY;

-- One row per inbound message that matched a reference: idempotent replays and diagnostics.
CREATE TABLE IF NOT EXISTS public.crm_reference_captures (
 message_id text PRIMARY KEY,
 instance text NOT NULL,
 reference_id uuid REFERENCES public.crm_reference_messages(id) ON DELETE SET NULL,
 pipeline_id uuid,
 contact_key text NOT NULL,
 lead_id uuid,
 source text NOT NULL,
 status text NOT NULL CHECK (status IN ('created','existing','ambiguous_lead','ambiguous_reference','invalid_target')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_reference_captures_created ON public.crm_reference_captures(created_at DESC);
REVOKE ALL ON public.crm_reference_captures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.crm_reference_captures TO service_role;
ALTER TABLE public.crm_reference_captures ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.save_crm_reference_message(p_actor uuid, p_id uuid, p_revision bigint, p_body text, p_mode text, p_source text, p_pipeline uuid, p_stage text, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.crm_reference_messages%ROWTYPE; stages jsonb; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_mode NOT IN ('exact','contains') OR p_source NOT IN ('google_ads','meta_ads') OR char_length(btrim(coalesce(p_body,''))) NOT BETWEEN 5 AND 1000
   OR char_length(coalesce(p_stage,'')) NOT BETWEEN 1 AND 80 OR p_active IS NULL THEN RAISE EXCEPTION 'invalid_reference' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-reference-messages',0));
 IF p_pipeline IS NOT NULL THEN
  SELECT p.stages INTO stages FROM public.sales_pipelines p WHERE p.id=p_pipeline AND NOT p.archived FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_pipeline' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(stages) s WHERE s->>'id'=p_stage) THEN RAISE EXCEPTION 'unknown_stage' USING ERRCODE='22023'; END IF;
 END IF; -- Funil principal: etapas validadas pelo servidor contra as etapas padrão.
 IF p_id IS NULL THEN
  IF (SELECT count(*) FROM public.crm_reference_messages)>=50 THEN RAISE EXCEPTION 'limit_reached' USING ERRCODE='22023'; END IF;
  INSERT INTO public.crm_reference_messages(body,match_mode,source,pipeline_id,stage_id,active,updated_by)
  VALUES(btrim(p_body),p_mode,p_source,p_pipeline,p_stage,p_active,p_actor) RETURNING * INTO r;
 ELSE
  UPDATE public.crm_reference_messages SET body=btrim(p_body),match_mode=p_mode,source=p_source,pipeline_id=p_pipeline,stage_id=p_stage,active=p_active,
   revision=revision+1,updated_by=p_actor,updated_at=now() WHERE id=p_id AND revision=p_revision RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'reference_changed' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.delete_crm_reference_message(p_id uuid, p_revision bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-reference-messages',0));
 DELETE FROM public.crm_reference_messages WHERE id=p_id AND revision=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'reference_changed' USING ERRCODE='40001'; END IF;
 RETURN true; -- Captures keep their history (reference_id becomes NULL).
END $$;

-- Exact match wins; otherwise the longest "contains" reference. Equal-length matches with
-- different destinations are ambiguous and never create cards.
CREATE OR REPLACE FUNCTION public.capture_crm_reference_message(p_instance text, p_message text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.whatsapp_messages%ROWTYPE; r public.crm_reference_messages%ROWTYPE; c public.crm_reference_captures%ROWTYPE;
 n text; k text; best integer; targets integer; ids uuid[]; target uuid; lbl text; tag text; us text; um text; st text; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE message_id=p_message AND instance=p_instance;
 IF NOT FOUND OR m.from_me OR coalesce(m.media_type,'')<>'' OR coalesce(m.remote_jid,'') !~ '^[0-9]{10,15}@s\.whatsapp\.net$' THEN
  RETURN jsonb_build_object('status','ignored'); END IF;
 n:=public.crm_normalize_reference(m.body);
 SELECT * INTO r FROM public.crm_reference_messages WHERE active AND match_mode='exact' AND normalized_body=n;
 IF NOT FOUND THEN
  SELECT max(char_length(normalized_body)) INTO best FROM public.crm_reference_messages WHERE active AND match_mode='contains' AND position(normalized_body IN n)>0;
  IF best IS NULL THEN RETURN jsonb_build_object('status','ignored'); END IF;
  SELECT count(DISTINCT (coalesce(pipeline_id::text,'main'),stage_id,source)) INTO targets FROM public.crm_reference_messages
   WHERE active AND match_mode='contains' AND position(normalized_body IN n)>0 AND char_length(normalized_body)=best;
  SELECT * INTO r FROM public.crm_reference_messages WHERE active AND match_mode='contains' AND position(normalized_body IN n)>0
   AND char_length(normalized_body)=best ORDER BY created_at, id LIMIT 1;
 ELSE targets:=1; END IF;
 k:=public.crm_phone_key(m.phone);
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-reference-contact:'||k,0));
 SELECT * INTO c FROM public.crm_reference_captures WHERE message_id=p_message;
 IF FOUND THEN RETURN jsonb_build_object('status',c.status,'leadId',c.lead_id,'pipelineId',c.pipeline_id,'source',c.source,'replayed',true); END IF;
 IF targets>1 THEN st:='ambiguous_reference';
 ELSIF r.pipeline_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_pipelines p CROSS JOIN jsonb_array_elements(p.stages) s
   WHERE p.id=r.pipeline_id AND NOT p.archived AND s->>'id'=r.stage_id) THEN st:='invalid_target';
 END IF;
 IF r.source='meta_ads' THEN lbl:='Meta Ads'; tag:='meta-ads'; us:='facebook'; um:='paid_social'; ELSE lbl:='Google Ads'; tag:='google-ads'; us:='google'; um:='cpc'; END IF;
 IF st IS NULL THEN
  -- Same funnel and same contact never get a second card.
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-reference-pipeline:'||coalesce(r.pipeline_id::text,'main'),0));
  SELECT array_agg(l.id) INTO ids FROM public.leads l WHERE l.pipeline_id IS NOT DISTINCT FROM r.pipeline_id AND public.crm_phone_key(l.whatsapp)=k;
  IF coalesce(cardinality(ids),0)>1 THEN st:='ambiguous_lead';
  ELSIF coalesce(cardinality(ids),0)=1 THEN
   target:=ids[1]; st:='existing';
   UPDATE public.leads l SET
    tags=CASE WHEN jsonb_typeof(l.tags)='array' AND l.tags ? tag THEN l.tags WHEN jsonb_typeof(l.tags)='array' THEN l.tags||jsonb_build_array(tag) ELSE jsonb_build_array(tag) END,
    source=CASE WHEN coalesce(btrim(l.source),'')='' THEN lbl ELSE l.source END,
    utm_source=CASE WHEN coalesce(btrim(l.utm_source),'')='' THEN us ELSE l.utm_source END,
    utm_medium=CASE WHEN coalesce(btrim(l.utm_medium),'')='' THEN um ELSE l.utm_medium END,
    last_conversation=m.body,
    history=CASE WHEN jsonb_typeof(l.history)='array' THEN l.history ELSE '[]'::jsonb END||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'date',now()::text,
     'kind','reference_capture','source','whatsapp','text','Nova mensagem de referência recebida pelo WhatsApp; origem '||lbl||'.'))
   WHERE l.id=target;
  ELSE
   st:='created';
   INSERT INTO public.leads(name,whatsapp,stage,pipeline_id,source,utm_source,utm_medium,tags,entry_date,last_conversation,history)
   VALUES(coalesce(nullif(btrim(m.push_name),''),m.phone),m.phone,r.stage_id,r.pipeline_id,lbl,us,um,jsonb_build_array(tag),
    (m.sent_at AT TIME ZONE 'America/Sao_Paulo')::date,m.body,
    jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'date',now()::text,'kind','reference_capture','source','whatsapp',
     'text','Lead criado pela mensagem de referência recebida no WhatsApp; origem '||lbl||'.')))
   RETURNING id INTO target;
  END IF;
 END IF;
 INSERT INTO public.crm_reference_captures(message_id,instance,reference_id,pipeline_id,contact_key,lead_id,source,status)
 VALUES(p_message,p_instance,r.id,r.pipeline_id,k,target,r.source,st);
 RETURN jsonb_build_object('status',st,'leadId',target,'pipelineId',r.pipeline_id,'source',r.source,'referenceId',r.id);
END $$;

REVOKE ALL ON FUNCTION public.save_crm_reference_message(uuid,uuid,bigint,text,text,text,uuid,text,boolean),
 public.delete_crm_reference_message(uuid,bigint), public.capture_crm_reference_message(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_reference_message(uuid,uuid,bigint,text,text,text,uuid,text,boolean),
 public.delete_crm_reference_message(uuid,bigint), public.capture_crm_reference_message(text,text) TO service_role;
