CREATE TABLE public.crm_campaign_send_pacing (
  campaign_id uuid PRIMARY KEY REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  min_gap_seconds integer NOT NULL CHECK (min_gap_seconds IN (1,5,10,15)),
  max_gap_seconds integer NOT NULL CHECK (max_gap_seconds IN (5,10,15,20) AND max_gap_seconds > min_gap_seconds),
  pause_every integer NOT NULL CHECK (pause_every IN (1,2,5,10,20,40,80)),
  pause_seconds integer NOT NULL CHECK (pause_seconds BETWEEN 30 AND 1800),
  sent_since_pause integer NOT NULL DEFAULT 0,
  next_send_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.crm_campaign_send_pacing TO service_role;
REVOKE ALL ON public.crm_campaign_send_pacing FROM PUBLIC, anon, authenticated;
ALTER TABLE public.crm_campaign_send_pacing ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.save_crm_campaign_pacing(p_campaign uuid, p_min integer, p_max integer, p_every integer, p_pause integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM crm_campaigns WHERE id=p_campaign AND channel='whatsapp' FOR UPDATE;
  IF st IS NULL OR st NOT IN ('draft','running') THEN RETURN false; END IF;
  INSERT INTO crm_campaign_send_pacing(campaign_id,min_gap_seconds,max_gap_seconds,pause_every,pause_seconds)
  VALUES (p_campaign,p_min,p_max,p_every,p_pause)
  ON CONFLICT (campaign_id) DO UPDATE SET min_gap_seconds=EXCLUDED.min_gap_seconds,max_gap_seconds=EXCLUDED.max_gap_seconds,
    pause_every=EXCLUDED.pause_every,pause_seconds=EXCLUDED.pause_seconds,
    sent_since_pause=LEAST(crm_campaign_send_pacing.sent_since_pause, EXCLUDED.pause_every),updated_at=now();
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.save_crm_campaign_pacing(uuid,integer,integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_campaign_pacing(uuid,integer,integer,integer,integer) TO service_role;

-- Atomic pacing gate: only one caller can claim per slot; schedules the next slot (gap or pause) before releasing the lock.
CREATE OR REPLACE FUNCTION public.claim_paced_crm_whatsapp_delivery(p_campaign uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p crm_campaign_send_pacing%ROWTYPE; d jsonb; gap numeric; paused boolean := false;
BEGIN
  SELECT * INTO p FROM crm_campaign_send_pacing WHERE campaign_id=p_campaign FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('paced',false); END IF;
  IF now() < p.next_send_at THEN RETURN jsonb_build_object('paced',true,'wait',true,'next_send_at',p.next_send_at); END IF;
  d := public.claim_crm_whatsapp_delivery(p_campaign);
  IF d IS NULL THEN RETURN jsonb_build_object('paced',true,'wait',false,'delivery',null); END IF;
  gap := p.min_gap_seconds + random()*(p.max_gap_seconds-p.min_gap_seconds);
  IF p.sent_since_pause + 1 >= p.pause_every THEN gap := gap + p.pause_seconds; paused := true; END IF;
  UPDATE crm_campaign_send_pacing SET sent_since_pause = CASE WHEN paused THEN 0 ELSE sent_since_pause+1 END,
    next_send_at = now() + make_interval(secs => gap) WHERE campaign_id=p_campaign
    RETURNING next_send_at INTO p.next_send_at;
  RETURN jsonb_build_object('paced',true,'wait',false,'delivery',d,'next_send_at',p.next_send_at,'pausing',paused);
END $$;
REVOKE ALL ON FUNCTION public.claim_paced_crm_whatsapp_delivery(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paced_crm_whatsapp_delivery(uuid) TO service_role;