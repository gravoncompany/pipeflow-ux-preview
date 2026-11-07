import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import { boundedJson } from "./gravon-portal.server";
import {
  classifySend,
  providerStatusFrom,
  type EmailSettings,
  type ProviderProbe,
  type ProviderStatus,
  type SendOutcome,
} from "./email-campaigns";

/** Brevo API v3. A chave fica só em BREVO_API_KEY; nunca é retornada, registrada ou enviada ao navegador. */
export const BREVO_BASE_URL = "https://api.brevo.com/v3";
const TIMEOUT_MS = 10000;
const RESPONSE_LIMIT = 256 * 1024;

export function brevoKey(env: Record<string, string | undefined> = process.env) {
  const key = env.BREVO_API_KEY?.trim() ?? "";
  return key && key.length <= 512 && !/\s/.test(key) ? key : "";
}

async function call(key: string, path: string, init: RequestInit, transport: typeof fetch) {
  const response = await fetchWithoutRedirects(
    `${BREVO_BASE_URL}${path}`,
    {
      ...init,
      headers: {
        accept: "application/json",
        "api-key": key,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
    transport,
  );
  let body: unknown = null;
  try {
    body = response.status === 204 ? null : await boundedJson(response, RESPONSE_LIMIT);
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function probe(key: string, path: string, transport: typeof fetch) {
  try {
    return await call(key, path, { method: "GET" }, transport);
  } catch {
    return { error: true as const };
  }
}

export async function brevoProviderStatus(
  settings: EmailSettings,
  transport: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<ProviderStatus> {
  const key = brevoKey(env);
  if (!key)
    return providerStatusFrom(
      { configured: false, account: null, senders: null, domains: null },
      settings,
    );
  const account = await probe(key, "/account", transport);
  const ok = !("error" in account) && account.status === 200;
  const [senders, domains] =
    ok && settings.sender_email
      ? await Promise.all([
          probe(key, "/senders", transport),
          probe(key, "/senders/domains", transport),
        ])
      : [null, null];
  const result: ProviderProbe = {
    configured: true,
    account: "error" in account ? account : { status: account.status },
    senders,
    domains,
  };
  return providerStatusFrom(result, settings);
}

export type ProviderBlocklist =
  | { ok: true; blocked: Record<string, string> }
  | { ok: false; code: "credential_missing" | "unavailable" | "too_many" };

const BLOCKLIST_PAGE = 100;
const BLOCKLIST_MAX_PAGES = 30;

/**
 * Somente leitura: lista de bloqueio transacional da Brevo (falha permanente, reclamação de spam,
 * descadastro, bloqueio manual). Retorna apenas os endereços pedidos, com o código do motivo.
 */
export async function brevoBlockedContacts(
  emails: string[],
  transport: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<ProviderBlocklist> {
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return { ok: true, blocked: {} };
  const key = brevoKey(env);
  if (!key) return { ok: false, code: "credential_missing" };
  const blocked: Record<string, string> = {};
  try {
    for (let page = 0; page < BLOCKLIST_MAX_PAGES; page++) {
      const r = await call(
        key,
        `/smtp/blockedContacts?limit=${BLOCKLIST_PAGE}&offset=${page * BLOCKLIST_PAGE}&sort=desc`,
        { method: "GET" },
        transport,
      );
      if (r.status !== 200 || !r.body || typeof r.body !== "object") return { ok: false, code: "unavailable" };
      const body = r.body as { count?: unknown; contacts?: unknown };
      const rows = Array.isArray(body.contacts) ? body.contacts : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const email = String((row as { email?: unknown }).email ?? "").trim().toLowerCase();
        const code = String(((row as { reason?: { code?: unknown } }).reason?.code ?? "") || "blocked").slice(0, 60);
        if (wanted.has(email)) blocked[email] = code;
      }
      const total = typeof body.count === "number" ? body.count : rows.length;
      if (rows.length < BLOCKLIST_PAGE || (page + 1) * BLOCKLIST_PAGE >= total) return { ok: true, blocked };
    }
    return { ok: false, code: "too_many" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export type BrevoMessage = {
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
  scheduledAt: string | null;
  batchId: string;
  tag: string;
  /** Endereço de respostas desta mensagem (fluxos: caixa do Gmail conectada). */
  replyTo?: string;
  /** Encadeamento de respostas (In-Reply-To/References). */
  inReplyTo?: string;
};

/**
 * Uma requisição por destinatário com conteúdo já renderizado (sem linguagem de template do provedor).
 * Exceção de rede, prazo ou redirecionamento = resultado desconhecido: nunca reenviar automaticamente.
 */
export async function brevoSend(
  settings: EmailSettings,
  message: BrevoMessage,
  transport: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<SendOutcome> {
  const key = brevoKey(env);
  if (!key) return { state: "failed", code: "credential_missing" };
  const payload: Record<string, unknown> = {
    sender: { email: settings.sender_email, name: settings.sender_name },
    to: [{ email: message.to, ...(message.toName ? { name: message.toName.slice(0, 70) } : {}) }],
    subject: message.subject,
    htmlContent: message.html,
    textContent: message.text,
    tags: [message.tag],
    headers: {
      "List-Unsubscribe": `<mailto:${message.replyTo || settings.reply_to || settings.sender_email}?subject=DESCADASTRAR>`,
      ...(message.inReplyTo && /^<[^<>\s]{3,490}>$/.test(message.inReplyTo)
        ? { "In-Reply-To": message.inReplyTo, References: message.inReplyTo }
        : {}),
    },
  };
  const replyTo = message.replyTo || settings.reply_to;
  if (replyTo) payload.replyTo = { email: replyTo };
  if (message.scheduledAt) {
    payload.scheduledAt = message.scheduledAt;
    payload.batchId = message.batchId;
  }
  try {
    const response = await call(
      key,
      "/smtp/email",
      { method: "POST", body: JSON.stringify(payload) },
      transport,
    );
    return classifySend(response.status, response.body);
  } catch {
    return { state: "unknown", code: "network_or_timeout" };
  }
}

/** Cancela um envio agendado (batchId ou messageId). Só 2xx confirma o cancelamento. */
export async function brevoCancelScheduled(
  identifier: string,
  transport: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
) {
  const key = brevoKey(env);
  if (!key) return false;
  try {
    const response = await call(
      key,
      `/smtp/email/${encodeURIComponent(identifier)}`,
      { method: "DELETE" },
      transport,
    );
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

/** Evidência de envio de um e-mail agendado, limitada ao ID e endereço originais. */
export async function brevoConfirmsEmailSent(
  messageId: string,
  recipient: string,
  transport: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
) {
  const key = brevoKey(env);
  if (!key || !messageId || !recipient) return false;
  const params = new URLSearchParams({ messageId, limit: "20" });
  const result = await probe(key, `/smtp/statistics/events?${params}`, transport);
  if ("error" in result || result.status !== 200 || !result.body || typeof result.body !== "object") return false;
  const events = (result.body as { events?: unknown }).events;
  if (!Array.isArray(events)) return false;
  return events.some((event: unknown) => {
    if (!event || typeof event !== "object") return false;
    const e = event as { messageId?: unknown; email?: unknown; event?: unknown };
    return e.messageId === messageId && typeof e.email === "string" &&
      e.email.trim().toLowerCase() === recipient && (e.event === "sent" || e.event === "delivered");
  });
}

/**
 * Somente leitura: eventos transacionais (delivered, opened, clicks…) dos messageIds informados.
 * Limitado a 300 mensagens e 5 consultas simultâneas; sem chave ou com falha total retorna null.
 */
export async function brevoMessageEvents(
  messageIds: string[],
  transport: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<{ byMessage: Map<string, Set<string>>; failed: number } | null> {
  const key = brevoKey(env);
  const ids = [...new Set(messageIds.filter(Boolean))].slice(0, 300);
  if (!key) return null;
  const byMessage = new Map<string, Set<string>>();
  let failed = 0;
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      const r = await probe(key, `/smtp/statistics/events?${new URLSearchParams({ messageId: id, limit: "100" })}`, transport);
      if ("error" in r || r.status !== 200 || !r.body || typeof r.body !== "object") { failed++; return; }
      const events = (r.body as { events?: unknown }).events;
      const set = new Set<string>();
      if (Array.isArray(events)) for (const e of events) {
        if (e && typeof e === "object" && (e as { messageId?: unknown }).messageId === id && typeof (e as { event?: unknown }).event === "string") set.add((e as { event: string }).event);
      }
      byMessage.set(id, set);
    }));
  }
  return ids.length && failed === ids.length ? null : { byMessage, failed };
}
