CREATE OR REPLACE FUNCTION public.gravon_resolve_stage_move(p_instance text,p_phone text,p_read_revision text,p_move_revision text,p_inbound_id text,p_code text,p_cancel boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  IF NOT FOUND OR l.stage<>a.source_stage OR l.updated_at<>a.expected_updated_at OR l.gravon_change_revision<>a.expected_change_revision THEN UPDATE public.gravon_lead_stage_actions SET status='stale',confirmation_id=p_inbound_id,completed_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
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