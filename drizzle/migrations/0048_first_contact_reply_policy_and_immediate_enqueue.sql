ALTER TABLE public.first_contact_settings ADD COLUMN stop_on_reply boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.first_contact_settings.stop_on_reply IS 'Stops remaining first-contact messages permanently on inbound reply; default enabled.';
CREATE OR REPLACE FUNCTION public.first_contact_reply_blocks(p_instance text,p_contact text,p_started timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT stop_on_reply FROM public.first_contact_settings WHERE company_key='crm:1'),true) AND EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE instance=p_instance AND NOT from_me AND public.first_contact_number(phone)=p_contact AND sent_at>=p_started)
$$;
REVOKE ALL ON FUNCTION public.first_contact_reply_blocks(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.first_contact_reply_blocks(text,text,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.save_first_contact_options(p_author uuid,p_enabled boolean,p_instance text,p_phone text,p_interval integer,p_revision uuid,p_stop_on_reply boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_stop_on_reply IS NULL OR p_interval IS NULL OR p_interval NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'invalid_options'; END IF;
 IF NOT public.save_first_contact_settings(p_author,p_enabled,p_instance,p_phone,p_interval,p_revision) THEN RETURN false; END IF;
 UPDATE public.first_contact_settings SET stop_on_reply=p_stop_on_reply WHERE company_key='crm:1';
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.save_first_contact_options(uuid,boolean,text,text,integer,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_first_contact_options(uuid,boolean,text,text,integer,uuid,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.wake_first_contact_on_enrollment() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.first_contact_settings WHERE company_key='crm:1' FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.first_contact_settings WHERE company_key='crm:1' AND enabled AND runtime_ready AND length(coalesce(job_secret,''))>=32) THEN RETURN; END IF;
 UPDATE public.first_contact_settings SET wake_at=now() WHERE company_key='crm:1';
 PERFORM public.dispatch_first_contact_wake();
END $$;
REVOKE ALL ON FUNCTION public.wake_first_contact_on_enrollment() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wake_first_contact_on_enrollment() TO service_role;
DO $$ DECLARE f text; sig text; predicate text := 'EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE instance=q.instance AND NOT from_me AND public.first_contact_number(phone)=q.contact_key AND sent_at>=q.started_at)'; BEGIN
 FOREACH sig IN ARRAY ARRAY['public.claim_first_contact(uuid,uuid)','public.revalidate_first_contact(uuid,uuid)','public.finish_first_contact(uuid,uuid,text,text,timestamp with time zone,text)'] LOOP
  f:=pg_get_functiondef(sig::regprocedure);
  IF position(predicate IN f)=0 THEN RAISE EXCEPTION 'reply_predicate_missing: %',sig; END IF;
  f:=replace(f,predicate,'public.first_contact_reply_blocks(q.instance,q.contact_key,q.started_at)');
  IF sig='public.revalidate_first_contact(uuid,uuid)' THEN
   f:=replace(f,' RETURN coalesce(', E' IF q.state=''sending'' AND q.lease_id=p_lease AND public.first_contact_reply_blocks(q.instance,q.contact_key,q.started_at) THEN PERFORM public.cancel_first_contact(q.instance,q.phone,''existing-inbound'',now(),false); RETURN false; END IF;\n RETURN coalesce(');
  END IF;
  EXECUTE f;
 END LOOP;
 f:=pg_get_functiondef('public.cancel_first_contact(text,text,text,timestamp with time zone,boolean)'::regprocedure);
 IF position(' FOR q IN SELECT' IN f)=0 THEN RAISE EXCEPTION 'cancel_guard_missing'; END IF;
 f:=replace(f,' FOR q IN SELECT', E' IF NOT p_ambiguous AND NOT coalesce((SELECT stop_on_reply FROM public.first_contact_settings WHERE company_key=''crm:1''),true) THEN RETURN 0; END IF;\n FOR q IN SELECT');
 EXECUTE f;
 f:=pg_get_functiondef('public.enroll_first_contact(uuid,text,text,text,timestamp with time zone,text,text)'::regprocedure);
 IF position('PERFORM public.arm_first_contact_queue(); RETURN ''enrolled'';' IN f)=0 THEN RAISE EXCEPTION 'enrollment_wake_missing'; END IF;
 f:=replace(f,'PERFORM public.arm_first_contact_queue(); RETURN ''enrolled'';','PERFORM public.wake_first_contact_on_enrollment(); RETURN ''enrolled'';');
 EXECUTE f;
END $$;