import type { NotifyDependencies } from "./portal-whatsapp-notify-handler.server";
import { approvalNotificationText } from "./portal-whatsapp-notify";
import { EVOLUTION_BASE_URL } from "./evolution.functions";
import { evolutionSendText } from "./evolution-text.server";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import { openInstances } from "./whatsapp-message-sync";
import { boundedJson } from "./gravon-portal.server";

export async function liveNotifyDependencies(): Promise<NotifyDependencies> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!apiKey) throw new Error("evolution_not_configured");
  return {
    claim: async (input, fingerprint, requestId) => {
      const { data, error } = await db.rpc("claim_portal_whatsapp_notification", { p_notification: input.notification_id, p_project: input.project_id, p_version: input.art_version_id, p_phone: input.client_phone, p_fingerprint: fingerprint, p_request: requestId, p_consent_at: input.consent.recorded_at, p_evidence: input.consent.evidence_id, p_policy: input.consent.policy_version });
      if (error || !data || typeof data !== "object") throw new Error("claim_failed");
      return data as Awaited<ReturnType<NotifyDependencies["claim"]>>;
    },
    send: async (input, requestId) => {
      const instances = await fetchWithoutRedirects(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(10000) });
      if (!instances.ok) return { state: "failed" };
      const open = openInstances(await boundedJson(instances, 1_000_000));
      // Reuse only an unambiguous existing connection; never create or reconfigure instances.
      if (open.length !== 1 || !open[0]) return { state: "failed" };
      const bound = await db.rpc("bind_portal_whatsapp_notification", { p_notification: input.notification_id, p_request: requestId, p_instance: open[0].name });
      if (bound.error || bound.data !== true) return { state: "failed" };
      const response = await evolutionSendText(apiKey, open[0].name, input.client_phone, approvalNotificationText(input));
      if (!response.ok) return { state: response.status >= 500 ? "unknown" : "failed" };
      const raw = await boundedJson(response, 100_000).catch(() => null) as { key?: { id?: unknown; remoteJid?: unknown; fromMe?: unknown } } | null;
      const id = raw?.key?.id; const jid = raw?.key?.remoteJid;
      return typeof id === "string" && id.length <= 200 && raw?.key?.fromMe === true && jid === `${input.client_phone}@s.whatsapp.net`
        ? { state: "accepted", providerId: id, remoteJid: jid } : { state: "unknown" };
    },
    finish: async (input, requestId, outcome) => {
      const { data, error } = await db.rpc("finish_portal_whatsapp_notification", { p_notification: input.notification_id, p_request: requestId, p_state: outcome.state, p_provider: outcome.providerId ?? "", p_jid: outcome.remoteJid ?? "" });
      if (error || data !== true) throw new Error("finish_failed");
    },
  };
}