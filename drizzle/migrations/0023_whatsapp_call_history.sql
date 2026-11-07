CREATE TABLE public.whatsapp_call_receipts (
 instance text NOT NULL, call_id text NOT NULL, company_key text NOT NULL,
 contact_jid text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '', occurred_at timestamptz,
 direction text NOT NULL DEFAULT 'unknown', result text NOT NULL DEFAULT 'unknown',
 lead_id uuid, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(instance,call_id)
);
GRANT ALL ON public.whatsapp_call_receipts TO service_role;
ALTER TABLE public.whatsapp_call_receipts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.whatsapp_call_receipts IS 'Private webhook deduplication and diagnostic receipts; user-facing interactions live only in leads.history';
CREATE OR REPLACE FUNCTION public.persist_lead_interaction(p_lead uuid,p_entry jsonb,p_instance text DEFAULT NULL,p_call_id text DEFAULT NULL,p_company text DEFAULT 'crm:1') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE l public.leads; old_entry jsonb; merged jsonb; h jsonb; eid text;
BEGIN
 IF p_company <> 'crm:1' OR p_company IS NULL THEN RAISE EXCEPTION 'Company unavailable' USING ERRCODE='42501'; END IF;
 IF p_instance IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.portal_admin_channels c JOIN public.user_roles r ON r.user_id=c.user_id JOIN auth.users u ON u.id=r.user_id WHERE c.instance=p_instance AND c.company_key=p_company AND r.role='admin' AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL) THEN RAISE EXCEPTION 'Instance not authorized' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_entry)<>'object' OR length(coalesce(p_entry->>'id','')) NOT BETWEEN 1 AND 240 OR length(coalesce(p_entry->>'text','')) NOT BETWEEN 1 AND 6000 OR length(coalesce(p_entry->>'date',''))>80 THEN RAISE EXCEPTION 'Invalid interaction'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=p_lead FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead missing'; END IF;
 IF jsonb_typeof(l.history)<>'array' THEN RAISE EXCEPTION 'Invalid history'; END IF;
 eid:=p_entry->>'id';
 SELECT e INTO old_entry FROM jsonb_array_elements(l.history) e WHERE e->>'id'=eid;
 IF old_entry IS NOT NULL AND p_instance IS NULL THEN
  IF old_entry IS DISTINCT FROM p_entry THEN RAISE EXCEPTION 'Interaction replay conflict'; END IF;
  RETURN jsonb_build_object('ok',true,'history',l.history);
 END IF;
 merged:=p_entry;
 IF old_entry IS NOT NULL THEN
  merged:=old_entry||p_entry;
  IF old_entry->>'result'<>'unknown' AND p_entry->>'result'='unknown' THEN merged:=jsonb_set(merged,'{result}',old_entry->'result'); merged:=jsonb_set(merged,'{text}',old_entry->'text'); END IF;
  IF old_entry->>'direction'<>'unknown' AND p_entry->>'direction'='unknown' THEN merged:=jsonb_set(merged,'{direction}',old_entry->'direction'); merged:=jsonb_set(merged,'{text}',old_entry->'text'); END IF;
  IF old_entry->>'date'<>'' AND p_entry->>'date'='' THEN merged:=jsonb_set(merged,'{date}',old_entry->'date'); END IF;
 END IF;
 SELECT coalesce(jsonb_agg(CASE WHEN e->>'id'=eid THEN merged ELSE e END ORDER BY n),'[]'::jsonb) INTO h FROM jsonb_array_elements(l.history) WITH ORDINALITY t(e,n);
 IF old_entry IS NULL THEN h:=jsonb_build_array(merged)||h; END IF;
 IF h IS DISTINCT FROM l.history THEN UPDATE public.leads SET history=h WHERE id=l.id RETURNING history INTO h; END IF;
 RETURN jsonb_build_object('ok',true,'history',h);
END $$;
REVOKE ALL ON FUNCTION public.persist_lead_interaction(uuid,jsonb,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_lead_interaction(uuid,jsonb,text,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.protect_call_interaction_history() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$ BEGIN
 IF NEW.history IS DISTINCT FROM OLD.history AND EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.history) e WHERE e->>'kind' IN ('whatsapp_call','interaction') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.history) n WHERE n->>'id'=e->>'id')) THEN RAISE EXCEPTION 'History changed; reload before saving' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_call_interactions BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.protect_call_interaction_history();