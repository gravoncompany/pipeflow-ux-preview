import { hasFullCrmSession } from "./crm-session.server";
import { internalKnowledgeActor } from "./commercial-knowledge.server";
import { encryptInstagramToken as encrypt, decryptInstagramToken as decrypt } from "./instagram-oauth-crypto.server";
import { classifyAttempt, requestSummary, responseSummary } from "./meta-capi-monitor";
import { META_GRAPH_VERSION, graphFetchInit, validatePixelAccess, buildCapiTestEvent, buildQualifiedLeadEvent, eventsReceivedSchema, graphErrorCode, pixelReadSchema, type MetaFailure } from "./meta-capi";

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const context = (company: string) => `meta-capi:${company}`;

export async function administrator() {
  const secret = process.env["CRM_SESSION_SECRET"];
  if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com a senha de acesso completo do CRM.");
  const actor = await internalKnowledgeActor("meta:capi", "menu");
  if (!actor) throw new Error("Entre com sua conta administrativa para configurar a Meta.");
  await actor.authorize().catch(() => { throw new Error("Sua conta não tem permissão de administrador."); });
  return actor;
}
function encryptionKey() {
  const key = process.env["META_CAPI_ENCRYPTION_KEY"];
  if (!key) throw new Error("Chave de proteção do token ausente no servidor.");
  return key;
}
export async function db() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }

/** Bounded Graph call: Bearer header (token never in URLs), no redirects, 10s timeout. */
async function graph(path: string, token: string, init?: { body: unknown }): Promise<{ ok: true; body: unknown } | ({ ok: false; raw?: unknown } & MetaFailure)> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${path}`, graphFetchInit(token, init?.body));
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.error(`Meta CAPI request did not complete: ${name}`);
    return { ok: false, http: null, code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    console.error(`Meta CAPI request redirected [${res.status}]`);
    return { ok: false, http: res.status, code: "redirect" };
  }
  const text = (await res.text()).slice(0, 20_000);
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) {
    const code = graphErrorCode(body);
    const type = (body as { error?: { type?: unknown } } | null)?.error?.type;
    console.error(`Meta CAPI request failed [${res.status}] code=${code} type=${typeof type === "string" ? type.replace(/[^A-Za-z]/g, "").slice(0, 40) : "unknown"} path=${path.split("?")[0].replace(/\d+/g, "{id}")}`);
    return { ok: false, http: res.status, code, raw: body };
  }
  return { ok: true, body };
}

const readPixel = (pixelId: string, token: string) => validatePixelAccess(pixelId, (path) => graph(path, token));

const COLUMNS = "pixel_id,pixel_name,enabled,production_enabled,last_check_at,last_check_status,last_check_http,last_check_code,last_test_event_at,last_test_event_status,last_test_event_http,revision,updated_at";

export async function capiOverview() {
  const secret = process.env["CRM_SESSION_SECRET"];
  if (!secret || !(await hasFullCrmSession(secret))) return { needsAuth: true as const };
  const actor = await administrator();
  const { data, error } = await (await db()).from("meta_capi_settings").select(COLUMNS).eq("company_key", actor.company).maybeSingle();
  if (error) throw new Error("Não foi possível ler a configuração.");
  await actor.authorize();
  return { needsAuth: false as const, settings: data ? { ...data, tokenSaved: true } : null, keyReady: Boolean(process.env["META_CAPI_ENCRYPTION_KEY"]) };
}

async function storedToken(company: string) {
  const { data, error } = await (await db()).from("meta_capi_settings").select("pixel_id,encrypted_token,revision,enabled").eq("company_key", company).maybeSingle();
  if (error) throw new Error("Não foi possível ler a configuração.");
  if (!data) throw new Error("Salve o ID do Pixel e o token primeiro.");
  return { ...data, token: await decrypt(data.encrypted_token, encryptionKey(), context(company)) };
}

/** Saves only after Meta confirms the token reads this Pixel; never stores a rejected token. */
export async function saveCapi(input: { pixelId: string; token?: string; revision: number | null }) {
  const actor = await administrator();
  const client = await db();
  const token = input.token ?? (input.revision ? (await storedToken(actor.company)).token : undefined);
  if (!token) throw new Error("Cole o token da API de Conversões.");
  const check = await readPixel(input.pixelId, token);
  if (!check.ok) return { saved: false as const, failure: { http: check.http, code: check.code } };
  const encrypted = await encrypt(token, encryptionKey(), context(actor.company));
  await actor.authorize();
  const now = new Date().toISOString();
  const fields = { pixel_id: input.pixelId, encrypted_token: encrypted, pixel_name: check.name?.slice(0, 200) ?? null, enabled: true, last_check_at: now, last_check_status: check.status, last_check_http: 200, last_check_code: null, updated_by: actor.userId, updated_at: now };
  if (input.revision === null) {
    const { error } = await client.from("meta_capi_settings").insert({ company_key: actor.company, ...fields });
    if (error) throw new Error("Outra pessoa salvou a configuração agora. Atualize a página.");
  } else {
    const { data, error } = await client.from("meta_capi_settings").update({ ...fields, revision: input.revision + 1 }).eq("company_key", actor.company).eq("revision", input.revision).select("revision");
    if (error || !data?.length) throw new Error("A configuração mudou desde que você abriu a página. Atualize e tente de novo.");
  }
  return { saved: true as const, pixelName: check.name, limited: check.status === "limited" };
}

async function record(company: string, fields: Record<string, unknown>) {
  await (await db()).from("meta_capi_settings").update({ ...fields, updated_at: new Date().toISOString() }).eq("company_key", company);
}

export async function checkCapi() {
  const actor = await administrator();
  const s = await storedToken(actor.company);
  const r = await readPixel(s.pixel_id, s.token);
  await actor.authorize();
  const now = new Date().toISOString();
  await record(actor.company, r.ok
    ? { last_check_at: now, last_check_status: r.status, last_check_http: 200, last_check_code: null, ...(r.name ? { pixel_name: r.name.slice(0, 200) } : {}) }
    : { last_check_at: now, last_check_status: "failed", last_check_http: r.http, last_check_code: r.code.slice(0, 80) });
  return r.ok ? { ok: true as const, pixelName: r.name, lastFired: r.lastFired, limited: r.status === "limited" } : { ok: false as const, failure: { http: r.http, code: r.code } };
}

/** Sends one test event that only appears in Events Manager → Test events. */
export async function sendCapiTestEvent(testEventCode: string) {
  const actor = await administrator();
  const s = await storedToken(actor.company);
  if (!s.enabled) throw new Error("Ative a integração antes de enviar o evento de teste.");
  await actor.authorize();
  const r = await graph(`${s.pixel_id}/events`, s.token, { body: await buildCapiTestEvent(testEventCode) });
  const now = new Date().toISOString();
  if (!r.ok) {
    await record(actor.company, { last_test_event_at: now, last_test_event_status: "failed", last_test_event_http: r.http });
    return { ok: false as const, failure: { http: r.http, code: r.code } };
  }
  const parsed = eventsReceivedSchema.safeParse(r.body);
  await record(actor.company, { last_test_event_at: now, last_test_event_status: parsed.success ? "accepted" : "failed", last_test_event_http: 200,
    // Meta accepting an event for this Pixel proves the token can send to it.
    ...(parsed.success ? { last_check_at: now, last_check_status: "ok", last_check_http: 200, last_check_code: null } : {}) });
  return parsed.success ? { ok: true as const, received: parsed.data.events_received } : { ok: false as const, failure: { http: 200, code: "schema" } };
}

export async function setCapiEnabled(enabled: boolean, revision: number) {
  const actor = await administrator();
  await actor.authorize();
  const { data, error } = await (await db()).from("meta_capi_settings").update({ enabled, revision: revision + 1, updated_by: actor.userId, updated_at: new Date().toISOString() }).eq("company_key", actor.company).eq("revision", revision).select("revision");
  if (error || !data?.length) throw new Error("A configuração mudou desde que você abriu a página. Atualize e tente de novo.");
  return { enabled };
}

/** Removes the stored token and Pixel; the next save starts from scratch. */
export async function removeCapi(revision: number) {
  const actor = await administrator();
  await actor.authorize();
  const { data, error } = await (await db()).from("meta_capi_settings").delete().eq("company_key", actor.company).eq("revision", revision).select("company_key");
  if (error || !data?.length) throw new Error("A configuração mudou desde que você abriu a página. Atualize e tente de novo.");
  return { removed: true };
}

/**
 * Sends prepared "lead qualificado" events. The claim RPC only hands out events whose company has
 * enabled + production_enabled and the same Pixel; production_enabled is pinned false by a CHECK
 * constraint, so today this always sends nothing. Every attempt is recorded with a technical summary
 * (fields, codes, trace id — never token, hashes or personal data); recoverable failures are rescheduled.
 */
export async function dispatchQualifiedLeadEvents() {
  const client = await db();
  const { data: claimed, error } = await client.rpc("claim_meta_capi_lead_events", { p_limit: 10 });
  if (error) throw new Error("meta_capi_claim_failed");
  let sent = 0;
  for (const ev of claimed ?? []) {
    const record = (outcome: string, http: number | null, code: string | null, request: object, response: object) =>
      client.rpc("record_meta_capi_attempt", { p_event: ev.id, p_trigger: "automatic", p_outcome: outcome, p_http: http as never, p_code: code as never, p_request: request as never, p_response: response as never });
    const { data: row } = await client.from("meta_capi_lead_events").select("company_key").eq("id", ev.id).maybeSingle();
    const { data: lead } = await client.from("leads").select("email,whatsapp").eq("id", ev.lead_id).maybeSingle();
    const { data: s } = row ? await client.from("meta_capi_settings").select("company_key,encrypted_token,pixel_id").eq("company_key", row.company_key).maybeSingle() : { data: null };
    if (!lead || !s || s.pixel_id !== ev.pixel_id) { await record("rejected", null, "missing", { pixel_id: ev.pixel_id, event_id: ev.event_id }, {}); continue; }
    const token = await decrypt(s.encrypted_token, encryptionKey(), context(s.company_key));
    const body = await buildQualifiedLeadEvent({ eventId: ev.event_id, eventTime: ev.event_time, leadId: ev.lead_id, email: lead.email ?? "", phone: lead.whatsapp ?? "" });
    const r = await graph(`${ev.pixel_id}/events`, token, { body });
    const outcome = classifyAttempt(r, (b) => eventsReceivedSchema.safeParse(b).success);
    if (outcome === "accepted") sent++;
    await record(outcome, r.ok ? 200 : r.http, r.ok ? (outcome === "accepted" ? null : "schema") : r.code, requestSummary(body, ev.pixel_id), responseSummary(r.ok ? 200 : r.http, r.ok ? r.body : r.raw));
  }
  return { sent };
}
