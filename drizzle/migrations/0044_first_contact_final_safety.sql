-- lovable-cron-fallback-reviewed: bounded earliest-deadline wake; self-disarms before callback and after drain; 1-300 seconds only with work, 45-second crash watchdog, readiness remains false.
CREATE OR REPLACE FUNCTION public.finish_first_contact(p_id uuid,p_lease uuid,p_state text,p_provider text,p_at timestamptz,p_error text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE s public.first_contact_settings; q public.first_contact_sequences; a public.first_contact_attempts; l public.leads; BEGIN
 SELECT * INTO s FROM public.first_contact_settings WHERE company_key='crm:1' FOR UPDATE; SELECT * INTO q FROM public.first_contact_sequences WHERE id=p_id FOR UPDATE;
 IF q.id IS NULL OR q.lease_id IS DISTINCT FROM p_lease THEN RETURN false; END IF;
 SELECT * INTO a FROM public.first_contact_attempts WHERE sequence_id=q.id AND step=q.next_step FOR UPDATE; IF a.id IS NULL THEN RETURN false; END IF; IF a.state='accepted' THEN RETURN true; END IF;
 IF p_state NOT IN ('accepted','failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF; IF p_state='accepted' AND (length(coalesce(p_provider,'')) NOT BETWEEN 1 AND 200 OR p_at IS NULL) THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
 UPDATE public.first_contact_attempts SET state=p_state,provider_id=p_provider,accepted_at=p_at,error_code=left(p_error,160) WHERE id=a.id;
 IF p_state<>'accepted' THEN UPDATE public.first_contact_sequences SET state=CASE WHEN state='cancelled' THEN state ELSE p_state END,reason=coalesce(reason,left(p_error,160)),completed_at=now() WHERE id=q.id; PERFORM public.arm_first_contact_queue(); RETURN true; END IF;
 INSERT INTO public.whatsapp_messages(message_id,instance,phone,remote_jid,phone_key,from_me,body,sent_at,send_state,accepted_at) VALUES(p_provider,q.instance,q.phone,q.phone||'@s.whatsapp.net',CASE WHEN q.phone LIKE '55%' THEN substring(q.phone,3,2)||right(q.phone,8) ELSE right(q.phone,10) END,true,a.body,p_at,'accepted',p_at) ON CONFLICT(message_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE message_id=p_provider AND instance=q.instance AND from_me AND body=a.body AND public.first_contact_number(phone)=q.contact_key) THEN RAISE EXCEPTION 'receipt_collision'; END IF;
 IF q.state='cancelled' OR NOT coalesce(s.enabled AND s.runtime_ready,false) OR q.settings_revision IS DISTINCT FROM s.revision OR q.inbound_id IS NOT NULL THEN
 UPDATE public.first_contact_sequences SET state='cancelled',reason=coalesce(reason,'authorization_changed_after_acceptance'),completed_at=coalesce(completed_at,now()),lease_until=NULL WHERE id=q.id AND state='sending';
 PERFORM public.arm_first_contact_queue(); RETURN true; END IF;
 SELECT * INTO l FROM public.leads WHERE id=q.lead_id FOR UPDATE;
 IF l.id IS NULL OR l.stage<>'lead-novo' OR l.pipeline_id IS NOT NULL OR NOT coalesce(public.commercial_knowledge_access(s.authorized_by,'crm:1'),false) OR q.instance IS DISTINCT FROM s.instance OR q.sender_phone IS DISTINCT FROM s.sender_phone OR NOT EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE user_id=s.authorized_by AND instance=s.instance AND company_key='crm:1' AND public.first_contact_number(canonical_phone)=public.first_contact_number(s.sender_phone)) OR EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE instance=s.instance AND company_key<>'crm:1') OR public.first_contact_number(CASE WHEN length(regexp_replace(l.whatsapp,'[^0-9]','','g')) IN (10,11) THEN '55'||regexp_replace(l.whatsapp,'[^0-9]','','g') ELSE regexp_replace(l.whatsapp,'[^0-9]','','g') END)<>q.contact_key OR EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE instance=q.instance AND NOT from_me AND public.first_contact_number(phone)=q.contact_key AND sent_at>=q.started_at) THEN UPDATE public.first_contact_sequences SET state='cancelled',reason='lead_or_authorization_changed',completed_at=now() WHERE id=q.id;
 ELSIF q.next_step=4 THEN IF (SELECT count(*) FROM public.first_contact_attempts WHERE sequence_id=q.id AND state='accepted')<>4 THEN RAISE EXCEPTION 'incomplete_sequence'; END IF;
 UPDATE public.leads SET stage='tentando-contato',history=coalesce(history,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id','first-contact-complete-'||q.id::text,'date',now(),'text','Lead Novo → Tentando Contato. Quatro mensagens de primeiro contato aceitas pela Evolution; entrega não confirmada.','kind','first_contact_complete')) WHERE id=l.id;
 UPDATE public.first_contact_sequences SET state='completed',next_step=5,completed_at=now(),moved_at=now() WHERE id=q.id;
 ELSE UPDATE public.first_contact_sequences SET state='pending',next_step=next_step+1,due_at=now()+make_interval(secs=>s.interval_seconds),lease_id=NULL,lease_until=NULL WHERE id=q.id; END IF; PERFORM public.arm_first_contact_queue(); RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_first_contact(uuid,uuid,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.finish_first_contact(uuid,uuid,text,text,timestamptz,text) TO service_role;
ALTER TABLE public.first_contact_settings ADD COLUMN wake_at timestamptz;
ALTER TABLE public.first_contact_attempts ADD COLUMN recovery_count integer NOT NULL DEFAULT 0, ADD COLUMN recovery_due_at timestamptz;
CREATE UNIQUE INDEX capture_submission_once ON public.leads(first_contact_submission_id) WHERE first_contact_submission_id LIKE 'capture:%';
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
 UNION ALL SELECT lease_until FROM public.first_contact_sequences WHERE state='sending'
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
 PERFORM cron.schedule('crm-first-contact-pending',greatest(1,least(300,ceil(extract(epoch FROM target-now()))::int))::text||' seconds','SELECT public.dispatch_first_contact_wake()');
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
  UPDATE public.first_contact_attempts SET recovery_due_at=now()+interval '45 seconds' WHERE state='sending' AND provider_id IS NOT NULL AND coalesce(recovery_due_at,now())<=now();
  PERFORM net.http_post(url:='https://project--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app/api/public/jobs/first-contact',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||s.job_secret),body:='{}'::jsonb,timeout_milliseconds:=20000);
 ELSE PERFORM public.arm_first_contact_queue(); END IF;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_first_contact_wake() FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.dispatch_first_contact_wake() TO service_role;
CREATE OR REPLACE FUNCTION public.preserve_first_contact_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ DECLARE e jsonb; BEGIN
 FOR e IN SELECT value FROM jsonb_array_elements(coalesce(OLD.history,'[]'::jsonb)) WHERE value->>'kind' IN ('first_contact_reply','first_contact_complete') LOOP
  SELECT coalesce(jsonb_agg(n),'[]'::jsonb) INTO NEW.history FROM jsonb_array_elements(coalesce(NEW.history,'[]'::jsonb)) n WHERE n->>'id' IS DISTINCT FROM e->>'id';
  NEW.history:=NEW.history||jsonb_build_array(e);
 END LOOP; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.preserve_first_contact_audit() FROM PUBLIC,anon,authenticated;