CREATE TABLE public.crm_outbound_email_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32),'hex'),
 company_key text NOT NULL DEFAULT 'crm:1' CHECK(company_key='crm:1'), lead_id uuid NOT NULL REFERENCES public.leads(id),
 message_id uuid REFERENCES public.crm_email_flow_messages(id), url text NOT NULL CHECK(length(url)<=2000 AND url ~ '^https://'),
 subject text NOT NULL DEFAULT '', test boolean NOT NULL DEFAULT false, test_accepted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(message_id,url)
);
GRANT ALL ON public.crm_outbound_email_links TO service_role;
ALTER TABLE public.crm_outbound_email_links ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.crm_outbound_email_clicks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), link_id uuid NOT NULL REFERENCES public.crm_outbound_email_links(id),
 classification text NOT NULL CHECK(classification IN ('human','automated','unknown')), fingerprint text NOT NULL CHECK(length(fingerprint)=64),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.crm_outbound_email_clicks TO service_role;
ALTER TABLE public.crm_outbound_email_clicks ENABLE ROW LEVEL SECURITY;
CREATE INDEX outbound_clicks_link_date ON public.crm_outbound_email_clicks(link_id,created_at DESC);
CREATE FUNCTION public.register_outbound_email_link(p_message uuid,p_url text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.crm_email_flow_messages; t text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 SELECT * INTO m FROM crm_email_flow_messages WHERE id=p_message;
 IF m.id IS NULL OR m.direction<>'out' OR m.kind<>'sequence' OR m.state<>'reserved' THEN RAISE EXCEPTION 'invalid_message'; END IF;
 IF NOT EXISTS(SELECT 1 FROM leads l JOIN sales_pipelines p ON p.id=l.pipeline_id WHERE l.id=m.lead_id AND lower(trim(p.name))='outbound' AND NOT p.archived) THEN RETURN NULL; END IF;
 INSERT INTO crm_outbound_email_links(lead_id,message_id,url,subject) VALUES(m.lead_id,m.id,p_url,m.subject) ON CONFLICT(message_id,url) DO UPDATE SET url=excluded.url RETURNING token INTO t;
 RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.register_outbound_email_link(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_outbound_email_link(uuid,text) TO service_role;
CREATE FUNCTION public.record_outbound_email_click(p_token text,p_classification text,p_fingerprint text,p_record boolean DEFAULT true) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k public.crm_outbound_email_links; m public.crm_email_flow_messages; l public.leads; r public.crm_automation_runs; event_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied'; END IF;
 IF p_token !~ '^[0-9a-f]{64}$' OR p_classification NOT IN ('human','automated','unknown') OR p_fingerprint !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO k FROM crm_outbound_email_links WHERE token=p_token FOR UPDATE;
 IF k.id IS NULL THEN RETURN NULL; END IF;
 IF k.test THEN IF NOT k.test_accepted THEN RETURN NULL; END IF;
 ELSE SELECT * INTO m FROM crm_email_flow_messages WHERE id=k.message_id; IF m.state IS DISTINCT FROM 'accepted' OR m.lead_id IS DISTINCT FROM k.lead_id THEN RETURN NULL; END IF; END IF;
 IF NOT p_record THEN RETURN k.url; END IF;
 IF EXISTS(SELECT 1 FROM crm_outbound_email_clicks WHERE link_id=k.id AND fingerprint=p_fingerprint AND classification=p_classification AND created_at>now()-interval '10 seconds') THEN RETURN k.url; END IF;
 INSERT INTO crm_outbound_email_clicks(link_id,classification,fingerprint) VALUES(k.id,p_classification,p_fingerprint) RETURNING id INTO event_id;
 IF p_classification='human' THEN
 SELECT * INTO l FROM leads WHERE id=k.lead_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM sales_pipelines WHERE id=l.pipeline_id AND lower(trim(name))='outbound' AND NOT archived) THEN
 UPDATE leads SET tags=CASE WHEN coalesce(tags,'[]'::jsonb) ? 'clicou-no-link' THEN tags ELSE coalesce(tags,'[]'::jsonb)||'"clicou-no-link"'::jsonb END,
 history=coalesce(history,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id','outbound-click:'||event_id,'date',now(),'kind','email_marketing','source','Pipeflow','text',CASE WHEN k.test THEN '[Teste] ' ELSE '' END||'Clicou no link · E-mail: '||k.subject||' · URL: '||k.url||' · Mensagem: '||coalesce(k.message_id::text,k.id::text))) WHERE id=l.id;
 END IF;
 IF NOT k.test THEN
 SELECT * INTO r FROM crm_automation_runs WHERE enrollment_id=m.enrollment_id;
 IF r.id IS NOT NULL THEN
 UPDATE crm_automation_runs SET clicks=clicks+1,last_click_at=now(),updated_at=now() WHERE id=r.id;
 INSERT INTO crm_automation_events(automation_id,run_id,lead_id,kind,detail) VALUES(r.automation_id,r.id,k.lead_id,'click','E-mail: '||k.subject||' · URL: '||k.url||' · Mensagem: '||m.id);
 END IF; END IF;
 END IF;
 RETURN k.url;
END $$;
REVOKE ALL ON FUNCTION public.record_outbound_email_click(text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_outbound_email_click(text,text,text,boolean) TO service_role;