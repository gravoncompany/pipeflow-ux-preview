CREATE TABLE public.first_contact_tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_key text NOT NULL UNIQUE CHECK(company_key='crm:1'), author uuid NOT NULL, instance text NOT NULL, sender_phone text NOT NULL, phone text NOT NULL CHECK(phone='5551999986839'), first_name text NOT NULL, body text NOT NULL, consent_at timestamptz NOT NULL DEFAULT now(), state text NOT NULL DEFAULT 'sending' CHECK(state IN ('sending','accepted','failed','unknown')), provider_id text, remote_jid text, accepted_at timestamptz, persisted_at timestamptz, error_code text, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.first_contact_tests TO service_role;
REVOKE ALL ON public.first_contact_tests FROM anon,authenticated;
ALTER TABLE public.first_contact_tests ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.claim_first_contact_test(p_author uuid,p_instance text,p_sender text,p_phone text,p_first text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.first_contact_tests; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('first-contact-controlled-test'));
 IF p_phone<>'5551999986839' OR p_first IS NULL OR p_first!~'^[[:alpha:]][[:alpha:]’''-]{0,79}$' OR NOT public.commercial_knowledge_access(p_author,'crm:1') OR NOT EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE user_id=p_author AND company_key='crm:1' AND instance=p_instance AND public.first_contact_number(canonical_phone)=public.first_contact_number(p_sender)) OR EXISTS(SELECT 1 FROM public.portal_admin_channels WHERE instance=p_instance AND company_key<>'crm:1') OR NOT EXISTS(SELECT 1 FROM public.first_contact_settings WHERE company_key='crm:1' AND NOT enabled AND NOT runtime_ready) OR EXISTS(SELECT 1 FROM public.first_contact_sequences WHERE state IN ('pending','sending')) THEN RAISE EXCEPTION 'controlled_test_not_authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.first_contact_tests WHERE company_key='crm:1';
 IF FOUND THEN
  IF r.author<>p_author OR r.instance<>p_instance OR r.sender_phone<>p_sender OR r.phone<>p_phone OR r.first_name<>p_first THEN RAISE EXCEPTION 'controlled_test_already_reserved'; END IF;
  RETURN jsonb_build_object('claimed',false,'id',r.id);
 END IF;
 INSERT INTO public.first_contact_tests(author,instance,sender_phone,phone,first_name,body) VALUES(p_author,p_instance,p_sender,p_phone,p_first,'Olá, '||p_first||'! Tudo bem?') RETURNING * INTO r;
 RETURN jsonb_build_object('claimed',true,'id',r.id);
END $$;
REVOKE ALL ON FUNCTION public.claim_first_contact_test(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_first_contact_test(uuid,text,text,text,text) TO service_role;
CREATE FUNCTION public.persist_first_contact_test(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.first_contact_tests; m public.whatsapp_messages; BEGIN
 SELECT * INTO r FROM public.first_contact_tests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.state<>'accepted' OR r.provider_id IS NULL OR r.accepted_at IS NULL OR r.remote_jid IS NULL OR public.first_contact_number(split_part(r.remote_jid,'@',1))<>public.first_contact_number(r.phone) THEN RETURN false; END IF;
 INSERT INTO public.whatsapp_messages(message_id,instance,phone,remote_jid,phone_key,from_me,body,sent_at,send_state,accepted_at) VALUES(r.provider_id,r.instance,split_part(r.remote_jid,'@',1),r.remote_jid,substring(r.phone,3,2)||right(r.phone,8),true,r.body,r.accepted_at,'accepted',r.accepted_at) ON CONFLICT(message_id) DO NOTHING;
 SELECT * INTO m FROM public.whatsapp_messages WHERE message_id=r.provider_id;
 IF m.instance IS DISTINCT FROM r.instance OR m.remote_jid IS DISTINCT FROM r.remote_jid OR m.body IS DISTINCT FROM r.body OR m.from_me IS DISTINCT FROM true THEN RAISE EXCEPTION 'test_message_collision'; END IF;
 PERFORM public.reconcile_analysis_delivery(r.instance,r.provider_id);
 UPDATE public.first_contact_tests SET persisted_at=coalesce(persisted_at,now()) WHERE id=r.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.persist_first_contact_test(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_first_contact_test(uuid) TO service_role;