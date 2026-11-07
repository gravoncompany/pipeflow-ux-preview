CREATE TABLE public.user_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('admin','team')),
 granted_at timestamptz NOT NULL DEFAULT now(),
 granted_by text NOT NULL,
 UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_read_own ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE FUNCTION public.require_verified_role_account() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Verified account required for role assignment';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_verified_role_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_verified_role_account() TO service_role;
CREATE TRIGGER user_roles_verified_account BEFORE INSERT OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.require_verified_role_account();
CREATE TABLE public.portal_admin_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 instance text NOT NULL CHECK (char_length(instance) BETWEEN 1 AND 160),
 canonical_phone text NOT NULL CHECK (canonical_phone ~ '^[0-9]{10,15}$'),
 granted_at timestamptz NOT NULL DEFAULT now(),
 granted_by text NOT NULL,
 UNIQUE(user_id, instance, canonical_phone)
);
GRANT SELECT ON public.portal_admin_channels TO authenticated;
GRANT ALL ON public.portal_admin_channels TO service_role;
ALTER TABLE public.portal_admin_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_channels_read_own_admin ON public.portal_admin_channels FOR SELECT TO authenticated USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'));
COMMENT ON TABLE public.user_roles IS 'Explicit owner-controlled roles; never assigned automatically on signup. Verified email required.';
COMMENT ON TABLE public.portal_admin_channels IS 'Owner-approved exact personal WhatsApp channel scope for Portal identity disclosure; never inferred from browser or model.';