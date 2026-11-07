CREATE FUNCTION public.cancel_full_first_contact_test_on_reply() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NEW.from_me=false THEN
 UPDATE public.first_contact_full_tests SET state='cancelled',reason='lead_replied',completed_at=now() WHERE state='running' AND instance=NEW.instance AND public.first_contact_number(phone)=public.first_contact_number(NEW.phone) AND NEW.sent_at>=started_at;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cancel_full_first_contact_test_on_reply() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_full_first_contact_test_on_reply() TO service_role;
CREATE TRIGGER cancel_full_first_contact_test_reply AFTER INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION public.cancel_full_first_contact_test_on_reply();
DO $$ DECLARE f text; BEGIN
 f:=pg_get_functiondef('public.finish_full_first_contact_test_step(uuid,integer,text,text,text,timestamp with time zone,text)'::regprocedure);
 f:=replace(f,'OR p_jid!~','OR p_jid IS NULL OR p_jid!~');
 EXECUTE f;
END $$;