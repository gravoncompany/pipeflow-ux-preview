import { z } from "zod";

export const instagramId = z.string().regex(/^\d{1,40}$/);
export const instagramSettings = z.object({ greetingEnabled: z.boolean(), greeting: z.string().trim().max(1000) }).strict()
  .refine(v => !v.greetingEnabled || v.greeting.length > 0, "Escreva a saudação antes de ativar.");
const mid = z.string().min(1).max(512);
const message = z.object({ mid, text: z.string().max(20000).optional(), is_echo: z.boolean().optional(), is_self: z.boolean().optional(), is_deleted: z.boolean().optional(), attachments: z.array(z.unknown()).max(50).optional() });
const timestamp = z.coerce.number().int().min(0).max(8640000000000000).transform(t => t < 100000000000 ? t * 1000 : t);
const messagingEvent = z.object({ sender: z.object({ id: instagramId }), recipient: z.object({ id: instagramId }), timestamp, message: message.optional() });
export type InstagramEvent = z.infer<typeof messagingEvent>;
// Loose item: Meta may omit sender/recipient/timestamp (e.g. message_edit with num_edit 0
// announces a brand-new direct) — those are resolved by mid through the Graph API.
const looseItem = z.object({
  sender: z.object({ id: instagramId }).optional().catch(undefined),
  recipient: z.object({ id: instagramId }).optional().catch(undefined),
  timestamp: timestamp.optional().catch(undefined),
  message: message.optional().catch(undefined),
  message_edit: z.object({ mid, text: z.string().max(20000).optional(), num_edit: z.coerce.number().int().min(0).optional() }).optional().catch(undefined),
});
export type InstagramCandidate = { event: InstagramEvent } | { lookup: string } | { skip: string };
/** Schema-only description of a value: key names and types, never values. */
export function payloadShape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return depth > 5 ? "array" : [value.length, ...value.slice(0, 2).map(v => payloadShape(v, depth + 1))];
  if (value && typeof value === "object") return depth > 5 ? "object" : Object.fromEntries(Object.entries(value).slice(0, 15).map(([k, v]) => [k.replace(/[^\w.-]/g, "").slice(0, 40), payloadShape(v, depth + 1)]));
  return value === null ? "null" : typeof value;
}
export function instagramCandidate(item: unknown): InstagramCandidate {
  const full = messagingEvent.safeParse(item);
  if (full.success && full.data.message) return { event: full.data };
  const loose = looseItem.safeParse(item);
  if (!loose.success) return { skip: "unrecognized_item" };
  const v = loose.data;
  if (v.message) return v.message.is_self === true ? { skip: "meta_self_test" } : { lookup: v.message.mid };
  if (v.message_edit) {
    if ((v.message_edit.num_edit ?? 0) > 0) return { skip: "message_edited" };
    if (v.sender && v.recipient && v.timestamp !== undefined && v.message_edit.text !== undefined)
      return { event: { sender: v.sender, recipient: v.recipient, timestamp: v.timestamp, message: { mid: v.message_edit.mid, text: v.message_edit.text } } };
    return { lookup: v.message_edit.mid };
  }
  const kind = item && typeof item === "object" ? Object.keys(item).find(k => !["sender", "recipient", "timestamp"].includes(k)) : undefined;
  return { skip: `no_message:${(kind ?? "none").replace(/[^\w]/g, "").slice(0, 30)}` };
}
const entrySchema = z.object({ id: instagramId, messaging: z.array(z.unknown()).max(100).optional(), changes: z.array(z.object({ field: z.string().max(100), value: z.unknown() }).passthrough()).max(100).optional() }).passthrough();
const envelope = z.object({ object: z.literal("instagram"), entry: z.array(z.unknown()).max(100) });
export type InstagramEntry = { id: string; candidates: InstagramCandidate[] };
// Meta's official examples include batches of envelopes. Identifiers remain strings so
// account matching never rounds a numeric identity. Unknown entries/items are dropped
// individually (and described by shape only) instead of rejecting signed batches.
export const instagramWebhook = z.union([envelope, z.array(envelope).min(1).max(100)])
  .transform(value => Array.isArray(value) ? value : [value])
  .refine(value => value.reduce((total, item) => total + item.entry.length, 0) <= 100, "Too many entries")
  .transform(value => {
    const entry: InstagramEntry[] = []; const rejected: unknown[] = [];
    for (const raw of value.flatMap(item => item.entry)) {
      const e = entrySchema.safeParse(raw);
      if (!e.success) { rejected.push(payloadShape(raw)); continue; }
      const items = [...(e.data.messaging ?? []), ...(e.data.changes ?? []).filter(c => c.field === "messages").map(c => c.value)];
      // Both arrays are independently bounded by entrySchema. Do not silently
      // discard changes.messages when the messaging array already has 100 items.
      entry.push({ id: e.data.id, candidates: items.map(instagramCandidate) });
    }
    return { object: "instagram" as const, entry, rejected };
  });
/** Graph API message node (GET /{mid}) → canonical event; null if it doesn't match the mid. */
const graphMessage = z.object({ id: mid, created_time: z.string().max(64), from: z.object({ id: instagramId }), to: z.object({ data: z.array(z.object({ id: instagramId })).min(1).max(10) }), message: z.string().max(20000).optional(), attachments: z.unknown().optional(), is_unsupported: z.boolean().optional() });
export function eventFromGraphMessage(expectedMid: string, raw: unknown): InstagramEvent | null {
  const r = graphMessage.safeParse(raw);
  if (!r.success || r.data.id !== expectedMid) return null;
  const at = Date.parse(r.data.created_time.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (!Number.isFinite(at)) return null;
  const hasAttachments = Boolean(r.data.attachments && typeof r.data.attachments === "object");
  return { sender: { id: r.data.from.id }, recipient: { id: r.data.to.data[0]!.id }, timestamp: at,
    message: { mid: r.data.id, ...(r.data.message ? { text: r.data.message } : {}), ...(hasAttachments && !r.data.message ? { attachments: [r.data.attachments] } : {}) } };
}
export function classifyInstagramEvent(account: string, event: InstagramEvent, now = Date.now()) {
  if (!event.message || event.message.is_self === true || event.timestamp > now + 300000) return null;
  const outgoing = event.sender.id === account;
  if (outgoing ? event.recipient.id === account : event.recipient.id !== account || event.message.is_echo === true) return null;
  return { sender: outgoing ? event.recipient.id : event.sender.id, mid: event.message.mid, inbound: !outgoing,
    body: event.message.is_deleted ? null : event.message.text ?? null,
    kind: event.message.is_deleted ? "deleted" : event.message.text !== undefined ? "text" : event.message.attachments?.length ? "attachment" : "unsupported",
    sentAt: new Date(event.timestamp).toISOString() };
}
export function eligibleFirstGreeting(first: boolean, enabled: boolean, inbound: boolean, sent: number, now: number) {
  return first && enabled && inbound && sent <= now + 300000 && sent >= now - 86400000;
}
export async function verifyInstagramSignature(body: Uint8Array, signature: string | null, secret: string) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = Uint8Array.from(signature.slice(7).match(/../g) ?? [], hex => parseInt(hex, 16));
  return crypto.subtle.verify("HMAC", key, signed, body as Uint8Array<ArrayBuffer>);
}
export function verificationChallenge(url: URL, expected: string | undefined) {
  const challenge = url.searchParams.get("hub.challenge");
  return expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected && challenge && /^\d{1,200}$/.test(challenge) ? challenge : null;
}