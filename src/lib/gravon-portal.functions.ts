import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getPortalAdminStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { getPortalAccount } = await import("./gravon-portal-admin.server");
  const account = await getPortalAccount();
  return {
    authorized: account?.authorized === true,
    signedIn: Boolean(account),
    email: account?.email ?? "",
    channelReady: Boolean(account?.channels.length),
  };
});

export const listPortalIdentityCandidates = createServerFn({ method: "POST" }).handler(async () => {
  const { getPortalAccount } = await import("./gravon-portal-admin.server");
  const account = await getPortalAccount();
  if (!account?.authorized) throw new Error("Identidade administrativa não verificada.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("gravon_ai_test_log")
    .select("id,instance,remote_jid,created_at")
    .eq("event", "inbound")
    .eq("status", "received")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("Contatos indisponíveis.");
  return (data ?? [])
    .filter((row) => row.instance && row.remote_jid && account.allows(row.instance, row.remote_jid))
    .map((row) => ({
      id: row.id,
      instance: row.instance ?? "",
      contact: row.remote_jid ?? "",
      receivedAt: row.created_at,
    }));
});

export const verifyPortalIdentityCandidate = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data }) => {
    const { getPortalAccount } = await import("./gravon-portal-admin.server");
    const account = await getPortalAccount();
    if (!account?.authorized) throw new Error("Identidade administrativa não verificada.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("gravon_ai_test_log")
      .select("inbound_id,instance,remote_jid")
      .eq("id", data.id)
      .eq("event", "inbound")
      .eq("status", "received")
      .maybeSingle();
    if (error || !row?.inbound_id || !row.instance || !row.remote_jid)
      throw new Error("Evento não verificável.");
    if (!account.allows(row.instance, row.remote_jid))
      throw new Error("Contato fora do canal autorizado.");
    const { resolvePortalIdentity } = await import("./gravon-portal-identity.server");
    try {
      const verified = await resolvePortalIdentity({
        inboundId: row.inbound_id, instance: row.instance, remoteJid: row.remote_jid,
      });
      const current = await getPortalAccount();
      if (!current?.allows(row.instance, row.remote_jid)) throw new Error("Permissão revogada.");
      return { ok: true as const, identity: {
      subject: verified.subject,
      contact: verified.contact,
      instance: verified.instance,
      eventAt: verified.eventAt,
      verifiedAt: verified.verifiedAt,
      source: verified.source,
      } };
    } catch (error) {
      const current = await getPortalAccount();
      if (!current?.allows(row.instance, row.remote_jid)) throw new Error("Permissão revogada.");
      const { safePortalIdentityDiagnostic } = await import("./portal-identity-diagnostics");
      return { ok: false as const, diagnostic: safePortalIdentityDiagnostic(error) };
    }
  });
