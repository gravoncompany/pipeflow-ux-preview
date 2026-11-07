ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS remote_jid text, ADD COLUMN IF NOT EXISTS message_source text, ADD COLUMN IF NOT EXISTS send_state text, ADD COLUMN IF NOT EXISTS accepted_at timestamptz, ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE public.gravon_ai_test_log ADD COLUMN IF NOT EXISTS instance text, ADD COLUMN IF NOT EXISTS remote_jid text, ADD COLUMN IF NOT EXISTS inbound_id text, ADD COLUMN IF NOT EXISTS outbound_id text, ADD COLUMN IF NOT EXISTS accepted_at timestamptz, ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
CREATE UNIQUE INDEX gravon_test_inbound_claim ON public.gravon_ai_test_log(instance,inbound_id) WHERE event='inbound' AND inbound_id IS NOT NULL AND instance IS NOT NULL;
CREATE OR REPLACE FUNCTION public.save_gravon_accepted_message(p_message_id text,p_instance text,p_remote_jid text,p_phone_key text,p_body text,p_accepted_at timestamptz) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE affected integer;
BEGIN
 IF coalesce(p_message_id,'')='' OR coalesce(p_instance,'')='' OR coalesce(p_remote_jid,'') !~ '^[0-9]+@s\.whatsapp\.net$' OR coalesce(p_phone_key,'')='' THEN RAISE EXCEPTION 'Invalid message identity'; END IF;
 INSERT INTO public.whatsapp_messages(message_id,instance,phone,phone_key,from_me,body,sent_at,remote_jid,message_source,send_state,accepted_at)
 VALUES(p_message_id,p_instance,split_part(p_remote_jid,'@',1),p_phone_key,true,p_body,p_accepted_at,p_remote_jid,'gravon_ai','accepted',p_accepted_at)
 ON CONFLICT(message_id) DO UPDATE SET remote_jid=excluded.remote_jid,message_source='gravon_ai',accepted_at=coalesce(whatsapp_messages.accepted_at,excluded.accepted_at),send_state=CASE WHEN whatsapp_messages.delivered_at IS NOT NULL OR whatsapp_messages.send_state='delivered' THEN 'delivered' ELSE 'accepted' END
 WHERE whatsapp_messages.instance=excluded.instance AND whatsapp_messages.phone_key=excluded.phone_key AND whatsapp_messages.from_me=true AND whatsapp_messages.body=excluded.body;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END; $$;
REVOKE ALL ON FUNCTION public.save_gravon_accepted_message(text,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_gravon_accepted_message(text,text,text,text,text,timestamptz) TO service_role;
COMMENT ON COLUMN public.whatsapp_messages.send_state IS 'accepted means provider acceptance only; delivered requires explicit matching delivery event; NULL preserves legacy unknown state';
COMMENT ON COLUMN public.gravon_ai_test_log.inbound_id IS 'Structured new inbound claim; legacy rows remain unmodified';