ALTER TABLE public.leads ADD COLUMN first_contact_form_origin text, ADD COLUMN first_contact_submission_id text, ADD COLUMN first_contact_consent_at timestamptz, ADD COLUMN first_contact_consent_version text, ADD COLUMN first_contact_first_name text, ADD COLUMN first_contact_phone text;
CREATE OR REPLACE FUNCTION public.enroll_first_contact_on_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF auth.role()='service_role' AND NEW.first_contact_form_origin='https://trafego.gravoncompany.com' AND NEW.first_contact_submission_id IS NOT NULL AND NEW.first_contact_consent_at IS NOT NULL AND NEW.first_contact_consent_version IS NOT NULL AND NEW.first_contact_first_name IS NOT NULL AND NEW.first_contact_phone IS NOT NULL THEN
 PERFORM public.enroll_first_contact(NEW.id,NEW.first_contact_submission_id,NEW.first_contact_phone,NEW.first_contact_first_name,NEW.first_contact_consent_at,NEW.first_contact_consent_version,NEW.first_contact_form_origin);
 END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enroll_first_contact_on_insert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER first_contact_enroll_on_insert AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.enroll_first_contact_on_insert();
CREATE OR REPLACE FUNCTION public.preserve_first_contact_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 NEW.first_contact_form_origin:=OLD.first_contact_form_origin; NEW.first_contact_submission_id:=OLD.first_contact_submission_id; NEW.first_contact_consent_at:=OLD.first_contact_consent_at; NEW.first_contact_consent_version:=OLD.first_contact_consent_version; NEW.first_contact_first_name:=OLD.first_contact_first_name; NEW.first_contact_phone:=OLD.first_contact_phone; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.preserve_first_contact_evidence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER first_contact_preserve_evidence BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.preserve_first_contact_evidence();
CREATE TABLE public.first_contact_worker_lock(id boolean PRIMARY KEY DEFAULT true CHECK(id),lease uuid,expires_at timestamptz);
GRANT ALL ON public.first_contact_worker_lock TO service_role; REVOKE ALL ON public.first_contact_worker_lock FROM anon,authenticated; ALTER TABLE public.first_contact_worker_lock ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.claim_first_contact_worker(p_lease uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 INSERT INTO public.first_contact_worker_lock(id) VALUES(true) ON CONFLICT DO NOTHING;
 UPDATE public.first_contact_worker_lock SET lease=p_lease,expires_at=now()+interval '40 seconds' WHERE id AND (expires_at IS NULL OR expires_at<now()); RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_first_contact_worker(uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.claim_first_contact_worker(uuid) TO service_role;