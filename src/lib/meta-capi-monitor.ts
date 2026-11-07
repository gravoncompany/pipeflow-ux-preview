import { z } from "zod";

/** Panel buckets. "Enviados" counts events that already had at least one attempt. */
export type Bucket = "accepted" | "pending" | "error";
export function statusBucket(status: string): Bucket {
  if (status === "sent") return "accepted";
  if (["failed", "unknown", "pixel_changed"].includes(status)) return "error";
  return "pending";
}

export function summarizeEvents(rows: { status: string; attempts: number }[]) {
  const out = { sent: 0, accepted: 0, pending: 0, error: 0, total: rows.length };
  for (const r of rows) {
    if (r.attempts > 0) out.sent++;
    out[statusBucket(r.status)]++;
  }
  return out;
}

export type AttemptOutcome = "accepted" | "rejected" | "recoverable" | "unknown";
type GraphOutcome = { ok: true; body: unknown } | { ok: false; http: number | null; code: string };

const RATE_LIMIT = ["4", "17", "32", "613"];
/**
 * Timeouts, network errors, 5xx and rate limits are recoverable (Meta drops repeats with the same
 * event_id, so a retry cannot double-count). Other 4xx are definitive rejections. Redirects and
 * unreadable success bodies are unknown and wait for a manual decision.
 */
export function classifyAttempt(r: GraphOutcome, acceptedBody: (body: unknown) => boolean): AttemptOutcome {
  if (r.ok) return acceptedBody(r.body) ? "accepted" : "unknown";
  const base = r.code.split(":")[0];
  if (r.code === "timeout" || r.code === "network") return "recoverable";
  if (r.code === "redirect") return "unknown";
  if (RATE_LIMIT.includes(base) || base.startsWith("80")) return "recoverable";
  if (r.http !== null && r.http >= 500) return "recoverable";
  return "rejected";
}

/** Technical request record: which fields were sent, never their values or hashes. */
export function requestSummary(body: { data: { event_name: string; event_id: string; event_time: number; action_source: string; user_data: Record<string, unknown>; custom_data?: Record<string, unknown> }[] }, pixelId: string) {
  const ev = body.data[0];
  return {
    endpoint: `/{pixel}/events`,
    pixel_id: pixelId,
    event_name: ev.event_name,
    event_id: ev.event_id,
    event_time: new Date(ev.event_time * 1000).toISOString(),
    action_source: ev.action_source,
    user_data_fields: Object.keys(ev.user_data).sort(),
    custom_data_fields: Object.keys(ev.custom_data ?? {}).sort(),
    test_event: false,
  };
}

const okBody = z.object({ events_received: z.number().int().optional(), fbtrace_id: z.string().max(100).optional() }).passthrough();
const errBody = z.object({ error: z.object({ code: z.number().int().optional(), error_subcode: z.number().int().optional(), type: z.string().optional(), fbtrace_id: z.string().optional() }).passthrough() }).passthrough();
/** Technical response record: counts, codes and trace id only, never provider prose. */
export function responseSummary(http: number | null, body: unknown) {
  const ok = okBody.safeParse(body);
  if (ok.success && ok.data.events_received !== undefined) return { http, events_received: ok.data.events_received, fbtrace_id: ok.data.fbtrace_id?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) ?? null };
  const err = errBody.safeParse(body);
  if (err.success) return { http, error_code: err.data.error.code ?? null, error_subcode: err.data.error.error_subcode ?? null,
    error_type: err.data.error.type?.replace(/[^A-Za-z]/g, "").slice(0, 40) ?? null, fbtrace_id: err.data.error.fbtrace_id?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) ?? null };
  return { http };
}

export const outcomeLabel: Record<AttemptOutcome, string> = {
  accepted: "Aceito pela Meta", rejected: "Recusado pela Meta", recoverable: "Falha temporária", unknown: "Resultado incerto",
};
export const sourceLabel: Record<string, string> = { ai_qualification: "Gravon IA · qualificação confirmada" };
export const eventLabel: Record<string, string> = { QualifiedLead: "Lead qualificado" };
