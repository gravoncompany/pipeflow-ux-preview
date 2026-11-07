-- lovable-cron-fallback-reviewed: bounded recovery runs only with unfinished in-flight/receipt work and stops after drain, including when new sends are disabled.
CREATE OR REPLACE FUNCTION public.arm_first_contact_queue() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE s public.first_contact_settings; j bigint; BEGIN
 SELECT * INTO s FROM public.first_contact_settings WHERE company_key='crm:1' FOR UPDATE;
 IF s.runtime_ready AND length(s.job_secret)>=32 AND ((s.enabled AND EXISTS(SELECT 1 FROM public.first_contact_sequences WHERE state IN ('pending','sending'))) OR EXISTS(SELECT 1 FROM public.first_contact_attempts WHERE state='sending' AND provider_id IS NOT NULL)) THEN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='crm-first-contact-pending') THEN PERFORM cron.schedule('crm-first-contact-pending','5 seconds','SELECT net.http_post(url:=''https://project--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app/api/public/jobs/first-contact'',headers:=jsonb_build_object(''Content-Type'',''application/json'',''Authorization'',''Bearer ''||job_secret),body:=''{}''::jsonb,timeout_milliseconds:=20000) FROM public.first_contact_settings WHERE runtime_ready AND company_key=''crm:1'''); END IF;
 ELSE SELECT jobid INTO j FROM cron.job WHERE jobname='crm-first-contact-pending'; IF j IS NOT NULL THEN PERFORM cron.unschedule(j); END IF; END IF;
END $$;
REVOKE ALL ON FUNCTION public.arm_first_contact_queue() FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.arm_first_contact_queue() TO service_role;
CREATE OR REPLACE FUNCTION public.first_contact_event_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF auth.role()='service_role' AND NEW.first_contact_submission_id IS NOT NULL THEN UPDATE public.zapier_inbound_events SET lead_id=NEW.id,created_lead=true WHERE event_id=NEW.first_contact_submission_id AND lead_id IS NULL; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.first_contact_event_receipt() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER first_contact_finalize_submission AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.first_contact_event_receipt();