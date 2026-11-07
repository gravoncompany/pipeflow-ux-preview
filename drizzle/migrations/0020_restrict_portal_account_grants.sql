REVOKE ALL ON public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
REVOKE ALL ON public.portal_admin_channels FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.portal_admin_channels TO authenticated;
GRANT ALL ON public.portal_admin_channels TO service_role;
REVOKE ALL ON FUNCTION public.require_verified_role_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_verified_role_account() TO service_role;