CREATE TABLE public.crm_calendar_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  calendar_id text NOT NULL DEFAULT '',
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 240),
  gap_minutes integer NOT NULL DEFAULT 15 CHECK (gap_minutes BETWEEN 0 AND 20),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  business_days integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  day_start time NOT NULL DEFAULT '09:00',
  day_end time NOT NULL DEFAULT '18:00',
  lunch_start time NOT NULL DEFAULT '13:30',
  lunch_end time NOT NULL DEFAULT '14:00',
  min_notice_hours integer NOT NULL DEFAULT 2 CHECK (min_notice_hours BETWEEN 0 AND 168),
  responsible text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_calendar_settings_lunch CHECK (lunch_start < lunch_end)
);
INSERT INTO public.crm_calendar_settings (id) VALUES (1);
GRANT SELECT,INSERT,UPDATE ON public.crm_calendar_settings TO service_role;
ALTER TABLE public.crm_calendar_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_calendar_settings FROM anon,authenticated;

CREATE TABLE public.crm_calendar_blocked (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_calendar_blocked_time CHECK (ends_at > starts_at)
);
GRANT SELECT,INSERT,DELETE ON public.crm_calendar_blocked TO service_role;
ALTER TABLE public.crm_calendar_blocked ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_calendar_blocked FROM anon,authenticated;

CREATE TABLE public.crm_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  event_id text NOT NULL,
  summary text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  origin text NOT NULL CHECK (origin IN ('ai','manual')),
  responsible text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE(event_id),
  CONSTRAINT crm_appointments_time CHECK (ends_at > starts_at)
);
GRANT SELECT,INSERT,UPDATE ON public.crm_appointments TO service_role;
ALTER TABLE public.crm_appointments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_appointments FROM anon,authenticated;
CREATE INDEX crm_appointments_schedule ON public.crm_appointments(status,starts_at);
CREATE INDEX crm_appointments_lead ON public.crm_appointments(lead_id,status);

CREATE OR REPLACE FUNCTION public.save_crm_calendar_settings(p_actor text,p_calendar text,p_duration integer,p_gap integer,p_days integer[],p_start time,p_end time,p_lunch_start time,p_lunch_end time,p_notice integer,p_responsible text,p_enabled boolean,p_revision bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.crm_calendar_settings%ROWTYPE; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_duration NOT BETWEEN 5 AND 240 OR p_gap NOT BETWEEN 0 AND 20 OR p_notice NOT BETWEEN 0 AND 168 OR p_start>=p_end OR cardinality(p_days)=0 OR EXISTS(SELECT 1 FROM unnest(p_days) d WHERE d NOT BETWEEN 0 AND 6) THEN RAISE EXCEPTION 'invalid_settings'; END IF;
  IF p_lunch_start IS NULL OR p_lunch_end IS NULL OR p_lunch_start>=p_lunch_end OR p_lunch_start<p_start OR p_lunch_end>p_end THEN RAISE EXCEPTION 'invalid_settings'; END IF;
  IF p_enabled AND length(coalesce(p_calendar,''))=0 THEN RAISE EXCEPTION 'calendar_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:calendar',0));
  SELECT * INTO s FROM public.crm_calendar_settings WHERE id=1 FOR UPDATE;
  IF FOUND AND s.revision<>p_revision THEN RAISE EXCEPTION 'settings_changed'; END IF;
  INSERT INTO public.crm_calendar_settings(id,calendar_id,duration_minutes,gap_minutes,business_days,day_start,day_end,lunch_start,lunch_end,min_notice_hours,responsible,enabled,revision,updated_by,updated_at)
  VALUES(1,left(coalesce(p_calendar,''),500),p_duration,p_gap,p_days,p_start,p_end,p_lunch_start,p_lunch_end,p_notice,left(coalesce(p_responsible,''),160),p_enabled,1,left(p_actor,160),now())
  ON CONFLICT(id) DO UPDATE SET calendar_id=left(coalesce(p_calendar,''),500),duration_minutes=p_duration,gap_minutes=p_gap,business_days=p_days,day_start=p_start,day_end=p_end,lunch_start=p_lunch_start,lunch_end=p_lunch_end,min_notice_hours=p_notice,responsible=left(coalesce(p_responsible,''),160),enabled=p_enabled,revision=crm_calendar_settings.revision+1,updated_by=left(p_actor,160),updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.book_crm_appointment(p_actor text,p_lead uuid,p_event text,p_summary text,p_start timestamptz,p_end timestamptz,p_origin text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.crm_calendar_settings%ROWTYPE; l public.leads%ROWTYPE; new_id uuid; when_label text; has_stage boolean; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_origin NOT IN ('ai','manual') OR p_event IS NULL OR length(p_event) NOT BETWEEN 1 AND 500 OR p_summary IS NULL OR length(p_summary) NOT BETWEEN 1 AND 500 OR p_end<=p_start OR p_start<now()-interval '5 minutes' THEN RAISE EXCEPTION 'invalid_appointment'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:calendar',0));
  SELECT * INTO s FROM public.crm_calendar_settings WHERE id=1 FOR SHARE;
  IF NOT FOUND OR NOT s.enabled OR s.calendar_id='' THEN RAISE EXCEPTION 'calendar_disabled'; END IF;
  SELECT * INTO l FROM public.leads WHERE id=p_lead FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_appointments a WHERE a.status='scheduled' AND tstzrange(a.starts_at,a.ends_at) && tstzrange(p_start,p_end)) THEN RAISE EXCEPTION 'slot_conflict'; END IF;
  INSERT INTO public.crm_appointments(lead_id,event_id,summary,starts_at,ends_at,origin,responsible,created_by) VALUES(p_lead,p_event,p_summary,p_start,p_end,p_origin,s.responsible,left(p_actor,160)) RETURNING id INTO new_id;
  when_label := to_char(p_start AT TIME ZONE s.timezone,'DD/MM/YYYY HH24:MI');
  has_stage := l.pipeline_id IS NULL OR EXISTS(SELECT 1 FROM public.sales_pipelines p WHERE p.id=l.pipeline_id AND p.archived=false AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.stages) st WHERE st->>'id'='reuniao-agendada'));
  UPDATE public.leads SET
    stage=CASE WHEN has_stage THEN 'reuniao-agendada' ELSE stage END,
    history=coalesce(history,'[]'::jsonb)||jsonb_build_object('id','appt:'||new_id||':booked','date',now(),'text',CASE WHEN has_stage THEN 'Reunião agendada para '||when_label||' — card movido para Reunião Agendada.' ELSE 'Reunião agendada para '||when_label||'. O funil deste lead não tem a etapa Reunião Agendada; o card permaneceu na etapa atual.' END,'kind','appointment_booked','source','calendar','appointment',new_id,'event',p_event,'start',p_start,'origin',p_origin,'responsible',left(p_actor,160))
  WHERE id=p_lead;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.reschedule_crm_appointment(p_actor text,p_id uuid,p_start timestamptz,p_end timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.crm_appointments%ROWTYPE; s public.crm_calendar_settings%ROWTYPE; when_label text; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_end<=p_start OR p_start<now()-interval '5 minutes' THEN RAISE EXCEPTION 'invalid_appointment'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:calendar',0));
  SELECT * INTO s FROM public.crm_calendar_settings WHERE id=1 FOR SHARE;
  SELECT * INTO a FROM public.crm_appointments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR a.status<>'scheduled' THEN RAISE EXCEPTION 'appointment_unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_appointments o WHERE o.id<>p_id AND o.status='scheduled' AND tstzrange(o.starts_at,o.ends_at) && tstzrange(p_start,p_end)) THEN RAISE EXCEPTION 'slot_conflict'; END IF;
  when_label := to_char(p_start AT TIME ZONE coalesce(s.timezone,'America/Sao_Paulo'),'DD/MM/YYYY HH24:MI');
  UPDATE public.crm_appointments SET starts_at=p_start,ends_at=p_end WHERE id=p_id;
  UPDATE public.leads SET history=coalesce(history,'[]'::jsonb)||jsonb_build_object('id','appt:'||p_id||':rescheduled:'||extract(epoch from now())::bigint,'date',now(),'text','Reunião reagendada para '||when_label||'.','kind','appointment_rescheduled','source','calendar','appointment',p_id,'event',a.event_id,'start',p_start,'responsible',left(p_actor,160)) WHERE id=a.lead_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_crm_appointment(p_actor text,p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.crm_appointments%ROWTYPE; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm:1:calendar',0));
  SELECT * INTO a FROM public.crm_appointments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR a.status<>'scheduled' THEN RAISE EXCEPTION 'already_cancelled'; END IF;
  UPDATE public.crm_appointments SET status='cancelled',cancelled_at=now() WHERE id=p_id;
  UPDATE public.leads SET history=coalesce(history,'[]'::jsonb)||jsonb_build_object('id','appt:'||p_id||':cancelled','date',now(),'text','Reunião cancelada.','kind','appointment_cancelled','source','calendar','appointment',p_id,'event',a.event_id,'responsible',left(p_actor,160)) WHERE id=a.lead_id;
END $$;

CREATE OR REPLACE FUNCTION public.add_crm_calendar_blocked(p_actor text,p_start timestamptz,p_end timestamptz,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_id uuid; BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_end<=p_start OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_block'; END IF;
  INSERT INTO public.crm_calendar_blocked(starts_at,ends_at,reason,created_by) VALUES(p_start,p_end,left(p_reason,160),left(p_actor,160)) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.remove_crm_calendar_blocked(p_actor text,p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  DELETE FROM public.crm_calendar_blocked WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'block_unavailable'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.save_crm_calendar_settings(text,text,integer,integer,integer[],time,time,time,time,integer,text,boolean,bigint),public.book_crm_appointment(text,uuid,text,text,timestamptz,timestamptz,text),public.reschedule_crm_appointment(text,uuid,timestamptz,timestamptz),public.cancel_crm_appointment(text,uuid),public.add_crm_calendar_blocked(text,timestamptz,timestamptz,text),public.remove_crm_calendar_blocked(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_calendar_settings(text,text,integer,integer,integer[],time,time,time,time,integer,text,boolean,bigint),public.book_crm_appointment(text,uuid,text,text,timestamptz,timestamptz,text),public.reschedule_crm_appointment(text,uuid,timestamptz,timestamptz),public.cancel_crm_appointment(text,uuid),public.add_crm_calendar_blocked(text,timestamptz,timestamptz,text),public.remove_crm_calendar_blocked(text,uuid) TO service_role;