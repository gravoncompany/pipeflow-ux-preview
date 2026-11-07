-- lovable-cron-fallback-reviewed: five-second checks are armed only for pending/sending/evidence recovery and removed after drain, not enabled during implementation.
CREATE OR REPLACE FUNCTION public.arm_first_contact_queue() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE s public.first_contact_settings; j bigint; BEGIN
 SELECT * INTO s FROM public.first_contact_settings WHERE company_key='crm:1' FOR UPDATE;
 IF s.enabled AND s.runtime_ready AND length(s.job_secret)>=32 AND (EXISTS(SELECT 1 FROM public.first_contact_sequences WHERE state IN ('pending','sending')) OR EXISTS(SELECT 1 FROM public.first_contact_attempts WHERE state='sending' AND provider_id IS NOT NULL)) THEN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='crm-first-contact-pending') THEN PERFORM cron.schedule('crm-first-contact-pending','5 seconds','SELECT net.http_post(url:=''https://project--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app/api/public/jobs/first-contact'',headers:=jsonb_build_object(''Content-Type'',''application/json'',''Authorization'',''Bearer ''||job_secret),body:=''{}''::jsonb,timeout_milliseconds:=20000) FROM public.first_contact_settings WHERE enabled AND runtime_ready AND company_key=''crm:1'''); END IF;
 ELSE SELECT jobid INTO j FROM cron.job WHERE jobname='crm-first-contact-pending'; IF j IS NOT NULL THEN PERFORM cron.unschedule(j); END IF; END IF;
END $$;
REVOKE ALL ON FUNCTION public.arm_first_contact_queue() FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.arm_first_contact_queue() TO service_role;
CREATE OR REPLACE FUNCTION public.preserve_first_contact_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ DECLARE e jsonb; BEGIN
 FOR e IN SELECT value FROM jsonb_array_elements(coalesce(OLD.history,'[]'::jsonb)) WHERE value->>'kind' IN ('first_contact_reply','first_contact_complete') LOOP
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(NEW.history,'[]'::jsonb)) n WHERE n->>'id'=e->>'id') THEN NEW.history:=coalesce(NEW.history,'[]'::jsonb)||jsonb_build_array(e); END IF; END LOOP; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.preserve_first_contact_audit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER first_contact_preserve_audit BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.preserve_first_contact_audit();