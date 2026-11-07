-- lovable-cron-fallback-reviewed: pending-only self-disarming timer; pg_cron seconds range 1-59; guarded database wake before deadlines, no HTTP until due; zero idle jobs, 45-second crash watchdog.
CREATE OR REPLACE FUNCTION public.arm_first_contact_queue() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.first_contact_settings; j bigint; target timestamptz; BEGIN
 SELECT * INTO s FROM public.first_contact_settings WHERE company_key='crm:1' FOR UPDATE;
 SELECT jobid INTO j FROM cron.job WHERE jobname='crm-first-contact-pending';
 IF NOT coalesce(s.runtime_ready,false) OR length(coalesce(s.job_secret,''))<32 THEN
  IF j IS NOT NULL THEN PERFORM cron.unschedule(j); END IF;
  UPDATE public.first_contact_settings SET wake_at=NULL WHERE company_key='crm:1'; RETURN;
 END IF;
 SELECT min(t) INTO target FROM (
 SELECT due_at AS t FROM public.first_contact_sequences WHERE state='pending' AND s.enabled
 UNION ALL SELECT q.lease_until FROM public.first_contact_sequences q WHERE q.state='sending' AND NOT EXISTS(SELECT 1 FROM public.first_contact_attempts a WHERE a.sequence_id=q.id AND a.state='sending' AND a.provider_id IS NOT NULL)
 UNION ALL SELECT coalesce(recovery_due_at,now()) FROM public.first_contact_attempts WHERE state='sending' AND provider_id IS NOT NULL
 ) candidates;
 IF target IS NULL THEN
  IF j IS NOT NULL THEN PERFORM cron.unschedule(j); END IF;
  UPDATE public.first_contact_settings SET wake_at=NULL WHERE company_key='crm:1'; RETURN;
 END IF;
 target:=greatest(target,now()+interval '1 second');
 IF j IS NOT NULL AND s.wake_at IS NOT NULL AND abs(extract(epoch FROM s.wake_at-target))<1 THEN RETURN; END IF;
 IF j IS NOT NULL THEN PERFORM cron.unschedule(j); END IF;
 UPDATE public.first_contact_settings SET wake_at=target WHERE company_key='crm:1';
 PERFORM cron.schedule('crm-first-contact-pending',greatest(1,least(59,ceil(extract(epoch FROM target-now()))::int))::text||' seconds','SELECT public.dispatch_first_contact_wake()');
END $$;
REVOKE ALL ON FUNCTION public.arm_first_contact_queue() FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.arm_first_contact_queue() TO service_role;
CREATE OR REPLACE FUNCTION public.dispatch_first_contact_wake() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.first_contact_settings; j bigint; BEGIN
 SELECT * INTO s FROM public.first_contact_settings WHERE company_key='crm:1' FOR UPDATE;
 IF s.wake_at IS NULL OR s.wake_at>now() THEN RETURN; END IF;
 SELECT jobid INTO j FROM cron.job WHERE jobname='crm-first-contact-pending';
 IF j IS NOT NULL THEN PERFORM cron.unschedule(j); END IF;
 UPDATE public.first_contact_settings SET wake_at=NULL WHERE company_key='crm:1';
 IF NOT s.runtime_ready OR length(coalesce(s.job_secret,''))<32 THEN RETURN; END IF;
 UPDATE public.first_contact_attempts SET state='unknown',error_code='worker_outcome_unknown' WHERE state='sending' AND provider_id IS NULL AND sequence_id IN (SELECT id FROM public.first_contact_sequences WHERE state='sending' AND lease_until<=now());
 UPDATE public.first_contact_sequences SET state='unknown',reason='worker_outcome_unknown',completed_at=now() WHERE state='sending' AND lease_until<=now() AND NOT EXISTS(SELECT 1 FROM public.first_contact_attempts a WHERE a.sequence_id=first_contact_sequences.id AND a.state='sending' AND a.provider_id IS NOT NULL);
 IF (s.enabled AND EXISTS(SELECT 1 FROM public.first_contact_sequences WHERE state='pending' AND due_at<=now())) OR EXISTS(SELECT 1 FROM public.first_contact_attempts WHERE state='sending' AND provider_id IS NOT NULL AND coalesce(recovery_due_at,now())<=now()) THEN
  UPDATE public.first_contact_settings SET wake_at=now()+interval '45 seconds' WHERE company_key='crm:1';
  PERFORM cron.schedule('crm-first-contact-pending','45 seconds','SELECT public.dispatch_first_contact_wake()');
  PERFORM net.http_post(url:='https://project--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app/api/public/jobs/first-contact',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||s.job_secret),body:='{}'::jsonb,timeout_milliseconds:=20000);
 ELSE PERFORM public.arm_first_contact_queue(); END IF;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_first_contact_wake() FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.dispatch_first_contact_wake() TO service_role;