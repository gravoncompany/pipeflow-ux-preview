import { createClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";
import { canDisclosePortalIdentity } from "./portal-account";
import { canonicalPortalNumber } from "./gravon-portal-identity.server";

/** Legacy full/limited cookies are deliberately NOT an administrative identity. */
export async function getPortalAccount() {
  const header = getRequestHeader("Authorization");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!header?.startsWith("Bearer ") || !url || !key) return null;
  const token = header.slice(7);
  const client = createClient(url, key, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.email_confirmed_at) return null;
  // Authenticated ordinary client, never service-role authorization or user-editable metadata.
  const { data: roles, error: roleError } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .limit(1);
  const authorized = !roleError && roles?.length === 1;
  const { data: channels, error: channelError } = authorized
    ? await client
        .from("portal_admin_channels")
        .select("instance,canonical_phone")
        .eq("user_id", data.user.id)
    : { data: [], error: null };
  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    authorized,
    channels: channelError ? [] : (channels ?? []),
    allows: (instance: string, jid: string) =>
      canDisclosePortalIdentity(
        true,
        authorized ? ["admin"] : [],
        channelError ? [] : (channels ?? []),
        instance,
        canonicalPortalNumber(jid),
      ),
  };
}

export async function isPortalAdministrator(): Promise<boolean> {
  return (await getPortalAccount())?.authorized === true;
}
