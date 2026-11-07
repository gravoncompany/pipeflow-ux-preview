ALTER TABLE public.first_contact_settings ADD COLUMN enrollment_after timestamptz;
COMMENT ON COLUMN public.first_contact_settings.enrollment_after IS 'Production activation cutoff; only leads created and consented strictly after activation may enroll. NULL fails closed.';
CREATE FUNCTION public.first_contact_activation_cutoff() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF NEW.enabled AND NOT OLD.enabled THEN NEW.enrollment_after:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.first_contact_activation_cutoff() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER first_contact_activation_cutoff BEFORE UPDATE ON public.first_contact_settings FOR EACH ROW EXECUTE FUNCTION public.first_contact_activation_cutoff();
DO $$ DECLARE f text; BEGIN
 f:=pg_get_functiondef('public.enroll_first_contact(uuid,text,text,text,timestamp with time zone,text,text)'::regprocedure);
 IF position('IF l.id IS NULL OR' IN f)=0 THEN RAISE EXCEPTION 'enrollment_predicate_missing'; END IF;
 f:=replace(f,'IF l.id IS NULL OR', 'IF s.enrollment_after IS NULL OR l.created_at<=s.enrollment_after OR p_consent_at<=s.enrollment_after OR l.id IS NULL OR');
 EXECUTE f;
 f:=pg_get_functiondef('public.dispatch_first_contact_wake()'::regprocedure);
 IF position('https://project--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app' IN f)=0 THEN RAISE EXCEPTION 'callback_missing'; END IF;
 f:=replace(f,'https://project--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app','https://crm.gravoncompany.com');
 EXECUTE f;
END $$;