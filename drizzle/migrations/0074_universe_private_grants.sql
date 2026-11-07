REVOKE ALL ON public.universe_receipts,public.universe_settings,public.universe_audit,public.universe_awards FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.universe_confirmed_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.universe_receipts,public.universe_settings TO service_role;
GRANT SELECT,INSERT ON public.universe_audit,public.universe_awards TO service_role;
GRANT SELECT ON public.universe_confirmed_sources TO service_role;
REVOKE ALL ON FUNCTION public.universe_receipt_guard(),public.universe_source_changed() FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE public.universe_awards IS 'Private permanent financial achievements; never deleted by later revenue corrections. No browser access.';