CREATE TABLE public.ai_learning_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','paused','cancelled')), phase text NOT NULL DEFAULT 'analysis', created_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz, conversation_count integer NOT NULL DEFAULT 0, message_count integer NOT NULL DEFAULT 0, insight_offset integer NOT NULL DEFAULT 0, insights jsonb NOT NULL DEFAULT '[]', error text
);
GRANT ALL ON public.ai_learning_runs TO service_role;
ALTER TABLE public.ai_learning_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_learning_runs FROM anon, authenticated;
CREATE UNIQUE INDEX ai_learning_one_active ON public.ai_learning_runs ((true)) WHERE status = 'running';
CREATE TABLE public.ai_learning_items (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL REFERENCES public.ai_learning_runs(id), conversation_key text NOT NULL, chunk integer NOT NULL, messages jsonb NOT NULL, result jsonb, UNIQUE(run_id, conversation_key, chunk)
);
GRANT ALL ON public.ai_learning_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ai_learning_items_id_seq TO service_role;
ALTER TABLE public.ai_learning_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_learning_items FROM anon, authenticated;
CREATE FUNCTION public.start_ai_learning() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_own text;
BEGIN
 PERFORM pg_advisory_xact_lock(7351932);
 SELECT id INTO v_id FROM ai_learning_runs WHERE status='running' LIMIT 1;
 IF v_id IS NOT NULL THEN RETURN v_id; END IF;
 SELECT regexp_replace(authorized_phone, '\D', '', 'g') INTO v_own FROM gravon_ai_test_settings WHERE id=1;
 v_own := CASE WHEN length(v_own)>=10 THEN substring(v_own FROM greatest(length(v_own)-9,1) FOR 2)||right(v_own,8) ELSE v_own END;
 INSERT INTO ai_learning_runs DEFAULT VALUES RETURNING id INTO v_id;
 INSERT INTO ai_learning_items(run_id,conversation_key,chunk,messages)
 SELECT v_id,phone_key,chunk,jsonb_agg(jsonb_build_object('message_id',message_id,'body',body,'from_me',from_me,'sent_at',sent_at,'media_type',media_type) ORDER BY sent_at,message_id)
 FROM (SELECT *, ((row_number() OVER(PARTITION BY phone_key ORDER BY sent_at,message_id)-1)/50)::integer AS chunk FROM whatsapp_messages WHERE phone_key IS DISTINCT FROM v_own AND phone NOT LIKE '%@g.us%' AND body NOT LIKE '🤖%' AND body NOT LIKE 'GRAVON AI%') m GROUP BY phone_key,chunk;
 UPDATE ai_learning_runs SET conversation_count=(SELECT count(DISTINCT conversation_key) FROM ai_learning_items WHERE run_id=v_id),message_count=(SELECT coalesce(sum(jsonb_array_length(messages)),0) FROM ai_learning_items WHERE run_id=v_id) WHERE id=v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.start_ai_learning() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_ai_learning() TO service_role;
CREATE FUNCTION public.claim_ai_learning(p_run uuid,p_token uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 WITH claimed AS (UPDATE ai_learning_runs SET lease_token=p_token,lease_until=now()+interval '10 minutes' WHERE id=p_run AND status='running' AND (lease_until IS NULL OR lease_until<now()) RETURNING id) SELECT exists(SELECT 1 FROM claimed);
$$;
REVOKE ALL ON FUNCTION public.claim_ai_learning(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_learning(uuid,uuid) TO service_role;