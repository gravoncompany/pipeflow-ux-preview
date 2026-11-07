import { PORTAL_NOTIFY_MAX_BYTES, PORTAL_NOTIFY_PATH, portalNotificationSchema, validApprovalUrl, type PortalNotification, type NotifyState } from "./portal-whatsapp-notify";
import { sameWhatsAppNumber } from "./phone";

const encoder = new TextEncoder();
export type NotifyConfig = { token?: string; signingSecret?: string; approvalOrigin?: string; enabled: boolean };
export type NotifyClaim = { code: "claimed" | "duplicate" | "conflict" | "replay" | "rate_limited"; state?: NotifyState };
export type NotifyDependencies = {
  claim: (input: PortalNotification, fingerprint: string, requestId: string) => Promise<NotifyClaim>;
  send: (input: PortalNotification, requestId: string) => Promise<{ state: "accepted" | "failed" | "unknown"; providerId?: string; remoteJid?: string }>;
  finish: (input: PortalNotification, requestId: string, outcome: Awaited<ReturnType<NotifyDependencies["send"]>>) => Promise<void>;
};

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
async function constantEqual(left: string, right: string) {
  const a = await digest(left); const b = await digest(right);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return mismatch === 0;
}
async function readBounded(request: Request) {
  if (!request.body) throw new Error("invalid_body");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > PORTAL_NOTIFY_MAX_BYTES) throw new Error("body_limit");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
const reply = (status: number, code: string, state?: NotifyState) => Response.json(
  { code, ...(state ? { state, delivery_confirmed: state === "delivered" } : {}) },
  { status, headers: { "Cache-Control": "no-store" } },
);

/** No logging: body, approval URL and auth headers must never reach diagnostics. */
export async function handlePortalNotification(request: Request, config: NotifyConfig, load: () => Promise<NotifyDependencies>, now = Date.now()) {
  if (!config.token || !config.signingSecret) return reply(503, "credentials_not_configured");
  const auth = request.headers.get("authorization") ?? "";
  if (auth.length > 4096 || !await constantEqual(auth, `Bearer ${config.token}`)) return reply(401, "unauthorized");
  const timestamp = request.headers.get("x-gravon-timestamp") ?? "";
  const requestId = request.headers.get("x-gravon-request-id") ?? "";
  const signature = request.headers.get("x-gravon-signature") ?? "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300000 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
      !/^[a-f0-9]{64}$/.test(signature)) return reply(401, "invalid_signature");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return reply(415, "json_required");
  let body: string;
  try { body = await readBounded(request); } catch { return reply(413, "invalid_or_oversized_body"); }
  const key = await crypto.subtle.importKey("raw", encoder.encode(config.signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
  const valid = await crypto.subtle.verify("HMAC", key, bytes, encoder.encode(`${timestamp}\n${requestId}\nPOST\n${PORTAL_NOTIFY_PATH}\n${body}`));
  if (!valid) return reply(401, "invalid_signature");
  let input: PortalNotification;
  try { input = portalNotificationSchema.parse(JSON.parse(body)); } catch { return reply(400, "invalid_payload"); }
  if (!sameWhatsAppNumber(input.client_phone, input.consent.phone) || Date.parse(input.consent.recorded_at) > now ||
      !config.approvalOrigin || !validApprovalUrl(input.approval_url, config.approvalOrigin)) return reply(400, "invalid_consent_or_approval_url");
  // Fail closed: no DB writes, instance lookup or transport until separately authorized.
  if (!config.enabled) return reply(503, "integration_disabled");
  const fingerprint = Array.from(await digest(JSON.stringify(input)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const deps = await load();
    const claim = await deps.claim(input, fingerprint, requestId);
    if (claim.code === "duplicate") return reply(claim.state === "sending" ? 202 : 200, "duplicate", claim.state);
    if (claim.code === "rate_limited") return reply(429, "rate_limited");
    if (claim.code !== "claimed") return reply(409, claim.code);
    let outcome: Awaited<ReturnType<NotifyDependencies["send"]>>;
    try { outcome = await deps.send(input, requestId); } catch { outcome = { state: "unknown" }; }
    await deps.finish(input, requestId, outcome);
    return reply(outcome.state === "accepted" ? 200 : outcome.state === "unknown" ? 202 : 502, "processed", outcome.state);
  } catch { return reply(503, "processing_unavailable"); }
}