ALTER TABLE public.gravon_ai_test_settings ADD COLUMN crm_move_enabled boolean NOT NULL DEFAULT false, ADD COLUMN crm_move_instance text NOT NULL DEFAULT '', ADD COLUMN crm_move_phone text NOT NULL DEFAULT '', ADD COLUMN crm_move_revision text NOT NULL DEFAULT '', ADD COLUMN crm_move_authorized_phone text NOT NULL DEFAULT '';

CREATE TABLE public.gravon_lead_stage_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE DEFAULT upper(replace(gen_random_uuid()::text,'-','')), instance text NOT NULL, phone text NOT NULL, remote_jid text NOT NULL, read_revision text NOT NULL, move_revision text NOT NULL, inbound_id text NOT NULL, confirmation_id text, lead_id uuid NOT NULL, lead_name text NOT NULL, company text NOT NULL, source_stage text NOT NULL, target_stage text NOT NULL, expected_updated_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '5 minutes'), completed_at timestamptz, UNIQUE(instance,inbound_id), CONSTRAINT gravon_action_status CHECK(status IN ('pending','moved','cancelled','expired','stale'))
);
GRANT ALL ON TABLE public.gravon_lead_stage_actions TO service_role;
REVOKE ALL ON TABLE public.gravon_lead_stage_actions FROM anon, authenticated;
ALTER TABLE public.gravon_lead_stage_actions ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.gravon_require_move_grant(p_instance text,p_phone text,p_read_revision text,p_move_revision text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.gravon_ai_test_settings s WHERE s.id=1 AND s.enabled AND s.crm_read_enabled AND s.crm_move_enabled AND s.crm_read_instance=p_instance AND s.crm_move_instance=p_instance AND s.crm_read_phone=p_phone AND s.crm_move_phone=p_phone AND s.crm_read_revision=p_read_revision AND s.crm_move_revision=p_move_revision AND length(p_read_revision)>0 AND length(p_move_revision)>0 AND s.authorized_phone=s.crm_move_authorized_phone FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Move authorization unavailable' USING ERRCODE='42501'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.gravon_require_move_grant(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_require_move_grant(text,text,text,text) TO service_role;

CREATE FUNCTION public.gravon_stage_action_result(p_action public.gravon_lead_stage_actions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT jsonb_build_object('status',p_action.status,'code',p_action.code,'leadId',p_action.lead_id,'leadName',left(p_action.lead_name,120),'company',left(p_action.company,120),'sourceStage',p_action.source_stage,'targetStage',p_action.target_stage); $$;
REVOKE ALL ON FUNCTION public.gravon_stage_action_result(public.gravon_lead_stage_actions) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_stage_action_result(public.gravon_lead_stage_actions) TO service_role;

CREATE FUNCTION public.gravon_propose_stage_move(p_instance text,p_phone text,p_read_revision text,p_move_revision text,p_inbound_id text,p_field text,p_query text,p_target_stage text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.gravon_lead_stage_actions; l public.leads; matches jsonb; target_id uuid;
BEGIN
 PERFORM public.gravon_require_move_grant(p_instance,p_phone,p_read_revision,p_move_revision);
 IF p_target_stage IS NULL OR p_target_stage <> ALL(ARRAY['lead-novo','tentando-contato','contato-realizado','retornar-mais-tarde','primeira-ligacao','segunda-ligacao','terceira-ligacao','qualificacao','mql','sql','reuniao-agendada','aguardando-decisao','fechado','perda']) THEN RAISE EXCEPTION 'Unknown target stage'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.gravon_ai_test_log WHERE event='inbound' AND instance=p_instance AND inbound_id=p_inbound_id) THEN RAISE EXCEPTION 'Inbound claim missing'; END IF;
 matches:=public.gravon_lookup_lead(p_instance,p_phone,p_read_revision,p_field,p_query);
 IF matches->>'ambiguous'='true' OR jsonb_array_length(matches->'leads')<>1 THEN RETURN jsonb_build_object('status','identify','choices',matches); END IF;
 target_id:=(matches->'leads'->0->>'id')::uuid;
 SELECT * INTO a FROM public.gravon_lead_stage_actions WHERE instance=p_instance AND inbound_id=p_inbound_id FOR UPDATE;
 IF FOUND THEN
  IF a.lead_id<>target_id OR a.target_stage<>p_target_stage OR a.read_revision<>p_read_revision OR a.move_revision<>p_move_revision THEN RAISE EXCEPTION 'One proposal per message'; END IF;
  RETURN public.gravon_stage_action_result(a);
 END IF;
 SELECT * INTO l FROM public.leads WHERE id=target_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
 IF l.stage=p_target_stage THEN RETURN jsonb_build_object('status','unchanged'); END IF;
 IF l.stage <> ALL(ARRAY['lead-novo','tentando-contato','contato-realizado','retornar-mais-tarde','primeira-ligacao','segunda-ligacao','terceira-ligacao','qualificacao','mql','sql','reuniao-agendada','aguardando-decisao','fechado','perda']) THEN RETURN jsonb_build_object('status','custom'); END IF;
 INSERT INTO public.gravon_lead_stage_actions(instance,phone,remote_jid,read_revision,move_revision,inbound_id,lead_id,lead_name,company,source_stage,target_stage,expected_updated_at) VALUES(p_instance,p_phone,p_phone||'@s.whatsapp.net',p_read_revision,p_move_revision,p_inbound_id,l.id,l.name,l.company,l.stage,p_target_stage,l.updated_at) RETURNING * INTO a;
 INSERT INTO public.gravon_ai_test_log(event,status,instance,phone,remote_jid,body,detail) VALUES('action','pending',p_instance,p_phone,a.remote_jid,'Movimentação aguardando confirmação: '||left(l.name,120)||' · '||l.stage||' → '||p_target_stage,a.id::text);
 RETURN public.gravon_stage_action_result(a);
END $$;
REVOKE ALL ON FUNCTION public.gravon_propose_stage_move(text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_propose_stage_move(text,text,text,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.gravon_resolve_stage_move(p_instance text,p_phone text,p_read_revision text,p_move_revision text,p_inbound_id text,p_code text,p_cancel boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.gravon_lead_stage_actions; l public.leads; command text;
BEGIN
 PERFORM public.gravon_require_move_grant(p_instance,p_phone,p_read_revision,p_move_revision);
 IF p_code IS NULL OR p_code !~ '^[A-F0-9]{32}$' OR p_cancel IS NULL THEN RETURN jsonb_build_object('status','invalid'); END IF;
 command:=CASE WHEN p_cancel THEN 'CANCELAR ' ELSE 'CONFIRMAR ' END||p_code;
 IF NOT EXISTS(SELECT 1 FROM public.gravon_ai_test_log WHERE event='inbound' AND instance=p_instance AND inbound_id=p_inbound_id AND upper(btrim(body))=command) THEN RAISE EXCEPTION 'Explicit confirmation missing'; END IF;
 SELECT * INTO a FROM public.gravon_lead_stage_actions WHERE code=p_code AND instance=p_instance AND phone=p_phone AND remote_jid=p_phone||'@s.whatsapp.net' AND read_revision=p_read_revision AND move_revision=p_move_revision FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid'); END IF;
 IF a.inbound_id=p_inbound_id THEN RETURN jsonb_build_object('status','invalid'); END IF;
 IF a.status<>'pending' THEN RETURN public.gravon_stage_action_result(a); END IF;
 IF a.expires_at<=clock_timestamp() THEN UPDATE public.gravon_lead_stage_actions SET status='expired',completed_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
 ELSIF p_cancel THEN UPDATE public.gravon_lead_stage_actions SET status='cancelled',confirmation_id=p_inbound_id,completed_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
 ELSE
  SELECT * INTO l FROM public.leads WHERE id=a.lead_id FOR UPDATE;
  IF NOT FOUND OR l.stage<>a.source_stage OR l.updated_at<>a.expected_updated_at THEN UPDATE public.gravon_lead_stage_actions SET status='stale',confirmation_id=p_inbound_id,completed_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
  ELSE
   IF jsonb_typeof(l.history)<>'array' THEN RAISE EXCEPTION 'Invalid lead history'; END IF;
   UPDATE public.leads SET stage=a.target_stage,history=jsonb_build_array(jsonb_build_object('id',a.id::text,'date',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD'),'text','Gravon AI via WhatsApp: '||a.source_stage||' → '||a.target_stage))||l.history WHERE id=l.id;
   UPDATE public.gravon_lead_stage_actions SET status='moved',confirmation_id=p_inbound_id,completed_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
  END IF;
 END IF;
 INSERT INTO public.gravon_ai_test_log(event,status,instance,phone,remote_jid,body,detail) VALUES('action',a.status,p_instance,p_phone,a.remote_jid,CASE WHEN a.status='moved' THEN 'Lead movido: '||left(a.lead_name,120)||' · '||a.source_stage||' → '||a.target_stage ELSE 'Movimentação: '||a.status END,a.id::text);
 RETURN public.gravon_stage_action_result(a);
END $$;
REVOKE ALL ON FUNCTION public.gravon_resolve_stage_move(text,text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gravon_resolve_stage_move(text,text,text,text,text,text,boolean) TO service_role;