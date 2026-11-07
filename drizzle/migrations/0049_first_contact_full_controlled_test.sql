CREATE TABLE public.first_contact_full_tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_key text NOT NULL DEFAULT 'crm:1' UNIQUE CHECK(company_key='crm:1'), author uuid NOT NULL, instance text NOT NULL, sender_phone text NOT NULL, phone text NOT NULL CHECK(phone='5551999986839'), first_name text NOT NULL, state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','completed','cancelled','failed','unknown')), next_step integer NOT NULL DEFAULT 1 CHECK(next_step BETWEEN 1 AND 5), started_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, reason text, consent_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.first_contact_full_tests TO service_role;
ALTER TABLE public.first_contact_full_tests ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.first_contact_full_test_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_id uuid NOT NULL REFERENCES public.first_contact_full_tests(id), step integer NOT NULL CHECK(step BETWEEN 1 AND 4), body text NOT NULL, state text NOT NULL CHECK(state IN ('sending','accepted','failed','unknown')), attempted_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, provider_id text UNIQUE, remote_jid text, persisted_at timestamptz, error_code text, UNIQUE(test_id,step)
);
GRANT ALL ON public.first_contact_full_test_attempts TO service_role;
ALTER TABLE public.first_contact_full_test_attempts ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.full_first_contact_test_guard(p_author uuid,p_instance text,p_sender text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.commercial_knowledge_access(p_author,'crm:1') AND EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE user_id=p_author AND company_key='crm:1' AND instance=p_instance AND public.first_contact_number(canonical_phone)=public.first_contact_number(p_sender)) AND NOT EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE instance=p_instance AND company_key<>'crm:1') AND EXISTS(SELECT 1 FROM public.first_contact_settings WHERE company_key='crm:1' AND NOT enabled AND NOT runtime_ready) AND NOT EXISTS(SELECT 1 FROM public.first_contact_sequences WHERE state IN ('pending','sending'))
$$;
REVOKE ALL ON FUNCTION public.full_first_contact_test_guard(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.full_first_contact_test_guard(uuid,text,text) TO service_role;
CREATE FUNCTION public.start_full_first_contact_test(p_author uuid,p_instance text,p_sender text,p_phone text,p_first text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.first_contact_full_tests; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('first-contact-full-test'));
 IF p_phone IS DISTINCT FROM '5551999986839' OR p_first IS NULL OR p_first!~'^[[:alpha:]][[:alpha:]’''-]{0,79}$' OR NOT public.full_first_contact_test_guard(p_author,p_instance,p_sender) THEN RAISE EXCEPTION 'controlled_test_not_authorized'; END IF;
 IF EXISTS(SELECT 1 FROM public.first_contact_tests WHERE state IN ('sending','unknown')) THEN RAISE EXCEPTION 'initial_test_unresolved'; END IF;
 SELECT * INTO r FROM public.first_contact_full_tests WHERE company_key='crm:1';
 IF FOUND THEN
 IF r.author<>p_author OR r.instance<>p_instance OR r.sender_phone<>p_sender OR r.first_name<>p_first THEN RAISE EXCEPTION 'test_already_reserved'; END IF;
 RETURN jsonb_build_object('id',r.id,'claimed',false); END IF;
 INSERT INTO public.first_contact_full_tests(author,instance,sender_phone,phone,first_name) VALUES(p_author,p_instance,p_sender,p_phone,p_first) RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id,'claimed',true);
END $$;
REVOKE ALL ON FUNCTION public.start_full_first_contact_test(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_full_first_contact_test(uuid,text,text,text,text) TO service_role;
CREATE FUNCTION public.claim_full_first_contact_test_step(p_id uuid,p_author uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.first_contact_full_tests; b text; BEGIN
 SELECT * INTO r FROM public.first_contact_full_tests WHERE id=p_id AND author=p_author FOR UPDATE;
 IF NOT FOUND OR r.state<>'running' THEN RETURN NULL; END IF;
 IF NOT public.full_first_contact_test_guard(r.author,r.instance,r.sender_phone) THEN
 UPDATE public.first_contact_full_tests SET state='cancelled',reason='authorization_changed',completed_at=now() WHERE id=r.id; RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE instance=r.instance AND NOT from_me AND public.first_contact_number(phone)=public.first_contact_number(r.phone) AND sent_at>=r.started_at) THEN
 UPDATE public.first_contact_full_tests SET state='cancelled',reason='lead_replied',completed_at=now() WHERE id=r.id; RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.first_contact_full_test_attempts WHERE test_id=r.id AND step=r.next_step) OR r.due_at>now() OR r.next_step>4 THEN RETURN NULL; END IF;
 b:=CASE r.next_step WHEN 1 THEN 'Olá, '||r.first_name||'! Tudo bem?' WHEN 2 THEN 'Vi que você preencheu nosso formulário sobre nossa agência de tráfego pago e marketing digital, onde apresentamos nosso plano atual.' WHEN 3 THEN 'Estamos com um plano de teste disponível para que você possa conhecer nosso serviço de tráfego pago durante 30 dias.' WHEN 4 THEN 'Gostaria de saber se você já investiu em tráfego pago?' END;
 INSERT INTO public.first_contact_full_test_attempts(test_id,step,body,state) VALUES(r.id,r.next_step,b,'sending');
 RETURN jsonb_build_object('id',r.id,'step',r.next_step,'body',b,'phone',r.phone,'instance',r.instance,'senderPhone',r.sender_phone);
END $$;
REVOKE ALL ON FUNCTION public.claim_full_first_contact_test_step(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_full_first_contact_test_step(uuid,uuid) TO service_role;
CREATE FUNCTION public.revalidate_full_first_contact_test(p_id uuid,p_author uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.first_contact_full_tests; BEGIN
 SELECT * INTO r FROM public.first_contact_full_tests WHERE id=p_id AND author=p_author FOR UPDATE;
 IF NOT FOUND OR r.state<>'running' THEN RETURN false; END IF;
 IF NOT public.full_first_contact_test_guard(r.author,r.instance,r.sender_phone) OR EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE instance=r.instance AND NOT from_me AND public.first_contact_number(phone)=public.first_contact_number(r.phone) AND sent_at>=r.started_at) THEN
 UPDATE public.first_contact_full_tests SET state='cancelled',reason='reply_or_authorization_changed',completed_at=now() WHERE id=r.id; RETURN false; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.revalidate_full_first_contact_test(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revalidate_full_first_contact_test(uuid,uuid) TO service_role;
CREATE FUNCTION public.finish_full_first_contact_test_step(p_id uuid,p_step integer,p_state text,p_provider text,p_jid text,p_at timestamptz,p_error text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.first_contact_full_tests; a public.first_contact_full_test_attempts; m public.whatsapp_messages; BEGIN
 SELECT * INTO r FROM public.first_contact_full_tests WHERE id=p_id FOR UPDATE;
 SELECT * INTO a FROM public.first_contact_full_test_attempts WHERE test_id=p_id AND step=p_step FOR UPDATE;
 IF r.id IS NULL OR a.id IS NULL THEN RETURN false; END IF;
 IF a.persisted_at IS NOT NULL THEN RETURN true; END IF;
 IF p_state='accepted' THEN
 IF p_provider IS NULL OR p_provider='' OR p_at IS NULL OR p_jid!~'^[0-9]{10,15}@s[.]whatsapp[.]net$' OR public.first_contact_number(split_part(p_jid,'@',1))<>public.first_contact_number(r.phone) OR (a.provider_id IS NOT NULL AND a.provider_id<>p_provider) THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
 INSERT INTO public.whatsapp_messages(message_id,instance,phone,remote_jid,phone_key,from_me,body,sent_at,send_state,accepted_at) VALUES(p_provider,r.instance,split_part(p_jid,'@',1),p_jid,substring(r.phone,3,2)||right(r.phone,8),true,a.body,p_at,'accepted',p_at) ON CONFLICT(message_id) DO NOTHING;
 SELECT * INTO m FROM public.whatsapp_messages WHERE message_id=p_provider;
 IF m.instance IS DISTINCT FROM r.instance OR m.body IS DISTINCT FROM a.body OR m.remote_jid IS DISTINCT FROM p_jid OR m.from_me IS DISTINCT FROM true THEN RAISE EXCEPTION 'test_message_collision'; END IF;
 PERFORM public.reconcile_analysis_delivery(r.instance,p_provider);
 UPDATE public.first_contact_full_test_attempts SET state='accepted',provider_id=p_provider,remote_jid=p_jid,accepted_at=p_at,persisted_at=now() WHERE id=a.id;
 IF r.state='running' THEN
 IF EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE instance=r.instance AND NOT from_me AND public.first_contact_number(phone)=public.first_contact_number(r.phone) AND sent_at>=r.started_at) THEN UPDATE public.first_contact_full_tests SET state='cancelled',reason='lead_replied',completed_at=now() WHERE id=r.id;
 ELSE UPDATE public.first_contact_full_tests SET next_step=p_step+1,due_at=greatest(now(),p_at)+interval '10 seconds',state=CASE WHEN p_step=4 THEN 'completed' ELSE 'running' END,completed_at=CASE WHEN p_step=4 THEN now() ELSE NULL END WHERE id=r.id; END IF; END IF;
 ELSE
 IF p_state NOT IN ('failed','unknown') THEN RAISE EXCEPTION 'invalid_state'; END IF;
 UPDATE public.first_contact_full_test_attempts SET state=p_state,error_code=p_error WHERE id=a.id AND state='sending';
 UPDATE public.first_contact_full_tests SET state=p_state,reason=p_error,completed_at=now() WHERE id=r.id AND state='running';
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_full_first_contact_test_step(uuid,integer,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_full_first_contact_test_step(uuid,integer,text,text,text,timestamptz,text) TO service_role;