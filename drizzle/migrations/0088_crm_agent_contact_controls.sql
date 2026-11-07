-- Controle individual da Gravon IA por contato (card do Pipeline e Conversas compartilham a mesma chave crm_phone_key).
-- Service-only; nada é ativado. Apenas adiciona uma condição de bloqueio às regras existentes do agente.
CREATE TABLE IF NOT EXISTS public.crm_agent_contact_controls (
 contact_key text PRIMARY KEY CHECK (contact_key ~ '^[0-9]{8,10}$'),
 mode text NOT NULL DEFAULT 'active' CHECK (mode IN ('active','paused','disabled')),
 paused_until timestamptz,
 revision bigint NOT NULL DEFAULT 0,
 updated_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (mode<>'paused' OR paused_until IS NOT NULL)
);
REVOKE ALL ON public.crm_agent_contact_controls FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_agent_contact_controls TO service_role;
ALTER TABLE public.crm_agent_contact_controls ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.crm_agent_contact_block(p_contact text) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN c.mode='disabled' THEN 'Gravon IA desativada para este contato.'
  WHEN c.mode='paused' AND c.paused_until>public.crm_agent_now() THEN 'Gravon IA pausada para este contato.' END
 FROM public.crm_agent_contact_controls c WHERE c.contact_key=p_contact
$$;

CREATE OR REPLACE FUNCTION public.set_crm_agent_contact_control(p_contact text, p_mode text, p_hours integer, p_revision bigint, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.crm_agent_contact_controls%ROWTYPE; cur bigint; until timestamptz; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF coalesce(p_contact,'') !~ '^[0-9]{8,10}$' OR p_mode IS NULL OR p_mode NOT IN ('active','paused','disabled') OR p_actor IS NULL THEN RAISE EXCEPTION 'invalid_control' USING ERRCODE='22023'; END IF;
 IF p_mode='paused' AND (p_hours IS NULL OR p_hours NOT BETWEEN 1 AND 720) THEN RAISE EXCEPTION 'invalid_pause' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-contact:'||p_contact,0));
 SELECT * INTO c FROM public.crm_agent_contact_controls WHERE contact_key=p_contact FOR UPDATE;
 cur := coalesce(c.revision,0);
 IF p_revision IS DISTINCT FROM cur THEN RAISE EXCEPTION 'stale_revision' USING ERRCODE='40001'; END IF;
 until := CASE WHEN p_mode='paused' THEN public.crm_agent_now()+make_interval(hours=>p_hours) END;
 INSERT INTO public.crm_agent_contact_controls(contact_key,mode,paused_until,revision,updated_by,updated_at) VALUES(p_contact,p_mode,until,cur+1,p_actor,now())
 ON CONFLICT(contact_key) DO UPDATE SET mode=excluded.mode, paused_until=excluded.paused_until, revision=excluded.revision, updated_by=excluded.updated_by, updated_at=now()
 RETURNING * INTO c;
 INSERT INTO public.crm_agent_audit(event,actor_id,detail) VALUES('contact_control',p_actor,jsonb_build_object('contact',p_contact,'mode',p_mode,'until',until));
 RETURN to_jsonb(c);
END $$;

CREATE OR REPLACE FUNCTION public.claim_crm_agent(p_instance text, p_inbound text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE m public.whatsapp_messages%ROWTYPE; s public.crm_agent_settings%ROWTYPE; l record; k text; n integer; reason text; st text := 'pending'; human boolean := false; local timestamp; run_id uuid; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE message_id=p_inbound AND instance=p_instance;
 IF NOT FOUND OR m.from_me OR coalesce(m.remote_jid,'') !~ '^[0-9]{10,15}@s\.whatsapp\.net$' THEN RETURN jsonb_build_object('status','ignored','reason','not_inbound'); END IF;
 IF EXISTS(SELECT 1 FROM public.crm_agent_runs WHERE inbound_id=p_inbound) THEN RETURN jsonb_build_object('status','duplicate'); END IF;
 k:=public.crm_phone_key(m.phone);
 -- Which funnel answers is decided by the contact's card; an agent never answers outside its funnel.
 SELECT count(*) INTO n FROM public.leads x JOIN public.crm_agent_settings c ON c.pipeline_id IS NOT DISTINCT FROM x.pipeline_id
  WHERE c.enabled AND public.crm_phone_key(x.whatsapp)=k AND (x.pipeline_id IS NULL OR EXISTS(SELECT 1 FROM public.sales_pipelines p WHERE p.id=x.pipeline_id AND NOT p.archived));
 IF n=0 THEN RETURN jsonb_build_object('status','ignored','reason','no_agent'); END IF;
 IF n>1 THEN
  INSERT INTO public.crm_agent_audit(event,detail) VALUES('ambiguous_contact',jsonb_build_object('inbound',p_inbound,'cards',n));
  RETURN jsonb_build_object('status','ignored','reason','ambiguous_contact');
 END IF;
 SELECT x.id, x.stage, x.pipeline_id, x.gravon_change_revision AS revision INTO l FROM public.leads x JOIN public.crm_agent_settings c ON c.pipeline_id IS NOT DISTINCT FROM x.pipeline_id
  WHERE c.enabled AND public.crm_phone_key(x.whatsapp)=k AND (x.pipeline_id IS NULL OR EXISTS(SELECT 1 FROM public.sales_pipelines p WHERE p.id=x.pipeline_id AND NOT p.archived));
 SELECT * INTO s FROM public.crm_agent_settings WHERE pipeline_id IS NOT DISTINCT FROM l.pipeline_id;
 IF s.instance<>p_instance THEN RETURN jsonb_build_object('status','ignored','reason','other_instance'); END IF;
 IF public.crm_same_whatsapp(m.phone,s.sender_phone) THEN RETURN jsonb_build_object('status','ignored','reason','own_number'); END IF;
 IF s.audience='test' AND NOT EXISTS(SELECT 1 FROM unnest(s.recipients) x WHERE public.crm_same_whatsapp(x,m.phone)) THEN RETURN jsonb_build_object('status','ignored','reason','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-contact:'||k,0));
 local:=public.crm_agent_now() AT TIME ZONE 'America/Sao_Paulo';
 IF s.blocked_reason IS NOT NULL THEN st:='skipped'; reason:='Agente pausado: '||s.blocked_reason;
 ELSIF coalesce(m.media_type,'')<>'' THEN st:='human'; human:=true; reason:='Mídia não interpretada pela IA; atendimento humano necessário.';
 ELSIF m.sent_at<public.crm_agent_now()-make_interval(mins=>s.max_message_age_minutes) THEN st:='skipped'; reason:='Mensagem antiga demais para resposta automática.';
 ELSIF NOT (l.stage=ANY(s.allowed_stages)) THEN st:='skipped'; reason:='Etapa do card não autorizada para o agente.';
 ELSIF public.crm_agent_contact_block(k) IS NOT NULL THEN st:='skipped'; reason:=public.crm_agent_contact_block(k);
 ELSIF EXISTS(SELECT 1 FROM public.crm_agent_holds h WHERE h.contact_key=k AND h.active) THEN st:='skipped'; reason:='Contato em atendimento humano.';
 ELSIF s.pause_on_human_reply AND public.crm_agent_human_since(p_instance,k,public.crm_agent_now()-make_interval(hours=>s.human_pause_hours)) THEN st:='skipped'; reason:='Atendimento humano recente; agente pausado para este contato.';
 ELSIF NOT (extract(dow FROM local)::integer=ANY(s.business_days) AND local::time>=s.day_start AND local::time<s.day_end) THEN st:='skipped'; reason:='Fora do horário de atendimento configurado.';
 ELSIF EXISTS(SELECT 1 FROM public.crm_agent_runs x WHERE x.contact_key=k AND x.status IN ('sending','unknown')) THEN st:='skipped'; reason:='Envio anterior sem confirmação para este contato.';
 ELSIF (SELECT count(*) FROM public.crm_agent_runs x WHERE x.contact_key=k AND x.status IN ('sending','accepted','completed','unknown') AND x.created_at>=public.crm_agent_day_start())>=s.max_replies_per_contact_day THEN st:='skipped'; reason:='Limite diário de respostas para este contato atingido.';
 ELSIF (SELECT count(*) FROM public.crm_agent_runs x WHERE x.settings_id=s.id AND x.status IN ('sending','accepted','completed','unknown') AND x.created_at>=public.crm_agent_day_start())>=s.max_replies_per_day THEN st:='skipped'; reason:='Limite diário de respostas do funil atingido.';
 END IF;
 INSERT INTO public.crm_agent_runs(settings_id,pipeline_id,lead_id,inbound_id,instance,phone,contact_key,from_stage,lead_revision,settings_revision,status,reason)
 VALUES(s.id,l.pipeline_id,l.id,p_inbound,p_instance,m.phone,k,l.stage,l.revision,s.revision,st,reason) ON CONFLICT(inbound_id) DO NOTHING RETURNING id INTO run_id;
 IF run_id IS NULL THEN RETURN jsonb_build_object('status','duplicate'); END IF;
 INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(s.id,run_id,l.id,CASE WHEN st='pending' THEN 'received' ELSE st END,jsonb_build_object('inbound',p_inbound,'reason',reason));
 IF human THEN
  INSERT INTO public.crm_agent_holds(contact_key,reason) VALUES(k,reason) ON CONFLICT(contact_key) DO UPDATE SET active=true,reason=excluded.reason,released_by=NULL,updated_at=now();
 END IF;
 IF st<>'pending' THEN RETURN jsonb_build_object('status',st,'reason',reason,'runId',run_id); END IF;
 RETURN public.claim_next_crm_agent_run(k);
END $fn$;

CREATE OR REPLACE FUNCTION public.begin_crm_agent_send(p_run uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE r public.crm_agent_runs%ROWTYPE; s public.crm_agent_settings%ROWTYPE; l record; inbound timestamptz; why text; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-agent-contact:'||r.contact_key,0));
 SELECT * INTO r FROM public.crm_agent_runs WHERE id=p_run FOR UPDATE;
 SELECT * INTO s FROM public.crm_agent_settings WHERE id=r.settings_id FOR SHARE;
 SELECT x.stage, x.pipeline_id, x.gravon_change_revision AS revision INTO l FROM public.leads x WHERE x.id=r.lead_id;
 SELECT w.sent_at INTO inbound FROM public.whatsapp_messages w WHERE w.message_id=r.inbound_id;
 IF r.status<>'analyzing' OR r.lease_until<=public.crm_agent_now() THEN RETURN false; END IF;
 IF r.reply IS NULL OR char_length(r.reply) NOT BETWEEN 1 AND s.max_reply_chars THEN why:='Resposta ausente ou acima do limite configurado.';
 ELSIF NOT s.enabled OR s.blocked_reason IS NOT NULL OR s.revision<>r.settings_revision OR s.instance<>r.instance THEN why:='Configuração do agente alterada durante a análise.';
 ELSIF l IS NULL OR l.stage IS DISTINCT FROM r.from_stage OR l.pipeline_id IS DISTINCT FROM r.pipeline_id OR l.revision IS DISTINCT FROM r.lead_revision THEN why:='Card alterado durante a análise.';
 ELSIF EXISTS(SELECT 1 FROM public.whatsapp_messages w WHERE w.instance=r.instance AND w.phone_key=r.contact_key AND NOT w.from_me AND w.sent_at>inbound) THEN why:='O cliente enviou outra mensagem; a mais recente será respondida.';
 ELSIF public.crm_agent_human_since(r.instance,r.contact_key,inbound) THEN why:='Atendimento humano iniciado durante a análise.';
 ELSIF public.crm_agent_contact_block(r.contact_key) IS NOT NULL THEN why:=public.crm_agent_contact_block(r.contact_key);
 ELSIF EXISTS(SELECT 1 FROM public.crm_agent_holds h WHERE h.contact_key=r.contact_key AND h.active) THEN why:='Contato em atendimento humano.';
 ELSIF (SELECT count(*) FROM public.crm_agent_runs x WHERE x.settings_id=s.id AND x.status IN ('sending','accepted','completed','unknown') AND x.created_at>=public.crm_agent_day_start())>=s.max_replies_per_day THEN why:='Limite diário do funil atingido.';
 END IF;
 IF why IS NOT NULL THEN
  UPDATE public.crm_agent_runs SET status='skipped', reason=why, lease_until=NULL, updated_at=now() WHERE id=r.id;
  INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event,detail) VALUES(r.settings_id,r.id,r.lead_id,'skipped',jsonb_build_object('reason',why));
  RETURN false;
 END IF;
 UPDATE public.crm_agent_runs SET status='sending', updated_at=now() WHERE id=r.id;
 INSERT INTO public.crm_agent_audit(settings_id,run_id,lead_id,event) VALUES(r.settings_id,r.id,r.lead_id,'send_reserved');
 RETURN true;
END $fn$;

REVOKE ALL ON FUNCTION public.crm_agent_contact_block(text), public.set_crm_agent_contact_control(text,text,integer,bigint,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_agent_contact_block(text), public.set_crm_agent_contact_control(text,text,integer,bigint,uuid) TO service_role;