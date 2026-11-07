CREATE TABLE public.analysis_delivery_receipts (instance text NOT NULL,message_id text NOT NULL,remote_jid text NOT NULL,state text NOT NULL CHECK(state IN ('DELIVERY_ACK','READ','PLAYED')),received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(instance,message_id,remote_jid,state));
REVOKE ALL ON public.analysis_delivery_receipts FROM anon,authenticated;
GRANT ALL ON public.analysis_delivery_receipts TO service_role;
ALTER TABLE public.analysis_delivery_receipts ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.reconcile_analysis_delivery(p_instance text,p_id text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE public.whatsapp_messages m SET delivered_at=coalesce(m.delivered_at,s.delivered),read_at=coalesce(m.read_at,s.read_time),send_state=CASE WHEN s.read_time IS NOT NULL THEN 'read' WHEN s.delivered IS NOT NULL THEN 'delivered' ELSE m.send_state END FROM (SELECT remote_jid,min(received_at) AS delivered,min(received_at) FILTER(WHERE state IN ('READ','PLAYED')) AS read_time FROM public.analysis_delivery_receipts WHERE instance=p_instance AND message_id=p_id GROUP BY remote_jid) s WHERE m.instance=p_instance AND m.message_id=p_id AND m.from_me AND m.phone=split_part(s.remote_jid,'@',1);
$$;
REVOKE ALL ON FUNCTION public.reconcile_analysis_delivery(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_analysis_delivery(text,text) TO service_role;