import { z } from "zod";

/** Graph API version used for every Conversions API call. */
export const META_GRAPH_VERSION = "v26.0";

export const pixelIdSchema = z.string().trim().regex(/^\d{6,25}$/, "O ID do Pixel tem só números (6 a 25 dígitos).");
// System-user tokens are long opaque strings; reject whitespace and obvious pastes of other values.
export const capiTokenSchema = z.string().trim().min(40, "Token curto demais. Copie o token completo do Gerenciador de Eventos.").max(2000).regex(/^[A-Za-z0-9_\-|.]+$/, "O token tem caracteres inválidos.");
export const testEventCodeSchema = z.string().trim().regex(/^TEST[A-Za-z0-9]{2,20}$/, "Use o código da aba Eventos de teste (começa com TEST).");

export const saveCapiInput = z.object({
  pixelId: pixelIdSchema,
  token: capiTokenSchema.optional(),
  revision: z.number().int().positive().nullable(),
}).strict();

export type MetaFailure = { http: number | null; code: string };

/** Turns a Graph error into a short Portuguese explanation, never echoing provider text. */
export function capiFailureText(f: { http: number | null; code: string | null }) {
  const c = f.code ?? "";
  if (c === "timeout") return "A Meta não respondeu em 10 segundos. Tente de novo em instantes.";
  if (c === "network") return "Não foi possível falar com a Meta agora. Tente de novo em instantes.";
  if (c === "190" || c.startsWith("190:")) return "A Meta recusou o token: ele é inválido, expirou ou foi revogado. Gere um novo no Gerenciador de Eventos.";
  if (c === "100" || c.startsWith("100:")) return "A Meta não encontrou esse Pixel com esse token. Confira o ID do Pixel e se o token foi gerado para ele.";
  if (["10", "200", "294"].some((p) => c === p || c.startsWith(`${p}:`))) return "O token não tem permissão para esse Pixel. Gere o token dentro das configurações do próprio Pixel.";
  if (c === "4" || c === "17" || c === "32" || c === "613" || c.startsWith("80")) return "A Meta limitou as consultas por enquanto. Aguarde alguns minutos.";
  if (c === "redirect") return "A Meta redirecionou a chamada de forma inesperada. Nada foi alterado; tente de novo.";
  if (c === "schema") return "A Meta respondeu num formato inesperado. Nada foi alterado.";
  return `A Meta recusou a solicitação${f.http ? ` (HTTP ${f.http})` : ""}. Nada foi alterado.`;
}

/**
 * Request options for every Graph API call. Cloudflare Workers reject redirect:"error"
 * (only "follow"/"manual" exist there), which made every call fail before reaching Meta;
 * "manual" keeps redirects un-followed and the caller treats any 3xx as a failure.
 * The token goes only in the Authorization header, never in the URL.
 */
export function graphFetchInit(token: string, body?: unknown): RequestInit {
  return {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  };
}

/** Meta refused to load the Pixel object for this token (100 or 100:33) — not proof the token is invalid. */
export function pixelReadRefused(code: string): boolean {
  return code === "100" || code === "100:33";
}

type GraphResult = { ok: true; body: unknown } | { ok: false; http: number | null; code: string };
/**
 * Validates token + Pixel without sending events. Tokens generated in Events Manager
 * ("API de Conversões → Gerar token") are meant only for POST /{pixel}/events, and Meta
 * often refuses GET /{pixel} for them with code 100 (subcode 33). Then the token itself is
 * checked with GET /me: valid → "limited" (Pixel access confirmed only by an accepted test
 * event); invalid/expired (190) → rejected. Other failures are returned unchanged.
 */
export async function validatePixelAccess(pixelId: string, call: (path: string) => Promise<GraphResult>) {
  const r = await call(`${pixelId}?fields=id,name`);
  if (r.ok) {
    const parsed = pixelReadSchema.safeParse(r.body);
    if (!parsed.success || parsed.data.id !== pixelId) return { ok: false as const, http: 200, code: "schema" };
    const fired = await call(`${pixelId}?fields=last_fired_time`);
    const lastFired = fired.ok ? z.object({ last_fired_time: z.string().optional() }).passthrough().safeParse(fired.body).data?.last_fired_time ?? null : null;
    return { ok: true as const, status: "ok" as const, name: parsed.data.name ?? null, lastFired };
  }
  if (!pixelReadRefused(r.code)) return r;
  const me = await call("me?fields=id");
  if (!me.ok) return me.code === "190" || me.code.startsWith("190:") ? me : r;
  return { ok: true as const, status: "limited" as const, name: null as string | null, lastFired: null as string | null };
}

export function graphErrorCode(body: unknown): string {
  const e = z.object({ error: z.object({ code: z.number().int(), error_subcode: z.number().int().optional() }).passthrough() }).safeParse(body);
  if (!e.success) return "unknown";
  return e.data.error.error_subcode ? `${e.data.error.code}:${e.data.error.error_subcode}` : String(e.data.error.code);
}

export const pixelReadSchema = z.object({ id: z.string(), name: z.string().max(500).optional(), last_fired_time: z.string().optional() }).passthrough();
export const eventsReceivedSchema = z.object({ events_received: z.number().int(), fbtrace_id: z.string().optional() }).passthrough();

/**
 * Connection-test event: visible only in Events Manager → Test events (test_event_code),
 * no personal data, fixed hashed placeholder id. Never counts as a real conversion.
 */
export async function buildCapiTestEvent(testEventCode: string, now = Date.now(), id: string = crypto.randomUUID()) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pipeflow-capi-connection-test"));
  const externalId = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    data: [{
      event_name: "Lead",
      event_time: Math.floor(now / 1000),
      event_id: `pipeflow-test-${id}`,
      action_source: "system_generated",
      user_data: { external_id: [externalId] },
      custom_data: { pipeflow_test: true },
    }],
    test_event_code: testEventCode,
    partner_agent: "lovable",
  };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * "Lead qualificado" event for the Conversions API (CRM integration shape). Personal data is only sent
 * SHA-256 hashed after Meta's normalization; event_id is fixed per lead so Meta also deduplicates.
 */
export async function buildQualifiedLeadEvent(input: { eventId: string; eventTime: string; leadId: string; email: string; phone: string }) {
  const email = input.email.trim().toLowerCase();
  let phone = input.phone.split("@")[0].replace(/\D/g, "");
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  const user_data: Record<string, string[]> = { external_id: [await sha256Hex(input.leadId)] };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) user_data.em = [await sha256Hex(email)];
  if (/^\d{12,15}$/.test(phone)) user_data.ph = [await sha256Hex(phone)];
  return {
    data: [{
      event_name: "QualifiedLead",
      event_time: Math.floor(new Date(input.eventTime).getTime() / 1000),
      event_id: input.eventId,
      action_source: "system_generated",
      user_data,
      custom_data: { event_source: "crm", lead_event_source: "Pipeflow" },
    }],
    partner_agent: "lovable",
  };
}
