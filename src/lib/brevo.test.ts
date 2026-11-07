import { test } from "node:test";
import assert from "node:assert/strict";
import { brevoCancelScheduled, brevoProviderStatus, brevoSend } from "./brevo.server";
import { emptyEmailSettings, type EmailSettings } from "./email-campaigns";

// Nenhum teste acessa a rede: todas as chamadas usam um transporte simulado.
const env = { BREVO_API_KEY: "xkeysib-teste-nunca-real" };
const settings: EmailSettings = { ...emptyEmailSettings, sender_email: "contato@gravon.com.br", sender_name: "Gravon", reply_to: "", revision: 1 };
type Call = { url: string; init: RequestInit };
function transport(routes: Record<string, () => Response>, calls: Call[] = []) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const key = `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    return route();
  }) as typeof fetch;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("verificação usa a chave só no cabeçalho e nunca a devolve", async () => {
  const calls: Call[] = [];
  const status = await brevoProviderStatus(settings, transport({
    "GET /v3/account": () => json(200, { email: "conta@privado.test", plan: [] }),
    "GET /v3/senders": () => json(200, { senders: [{ email: settings.sender_email, active: true }] }),
    "GET /v3/senders/domains": () => json(200, { domains: [{ domain_name: "gravon.com.br", authenticated: true }] }),
  }, calls), env);
  assert.deepEqual(status.checks.map(c => c.state), ["ok", "ok", "ok", "ok"]);
  assert.ok(calls.every(c => (c.init.headers as Record<string, string>)["api-key"] === env.BREVO_API_KEY && c.init.redirect === "manual" && c.init.signal));
  assert.equal(JSON.stringify(status).includes(env.BREVO_API_KEY), false);
  assert.equal(JSON.stringify(status).includes("conta@privado.test"), false);
});

test("sem chave nenhuma requisição é feita", async () => {
  const calls: Call[] = [];
  const status = await brevoProviderStatus(settings, transport({}, calls), {});
  assert.equal(status.configured, false);
  assert.equal(calls.length, 0);
  assert.deepEqual(await brevoSend(settings, { to: "a@b.test", toName: "", subject: "s", html: "h", text: "t", scheduledAt: null, batchId: crypto.randomUUID(), tag: "x" }, transport({}, calls), {}), { state: "failed", code: "credential_missing" });
  assert.equal(calls.length, 0);
});

test("chave recusada não consulta remetentes", async () => {
  const calls: Call[] = [];
  const status = await brevoProviderStatus(settings, transport({ "GET /v3/account": () => json(401, { code: "unauthorized", message: "Key not found" }) }, calls), env);
  assert.equal(calls.length, 1);
  assert.equal(status.checks.find(c => c.id === "account")?.state, "error");
});

test("envio monta remetente, agendamento e lote; redirecionamento e rede viram desconhecido", async () => {
  const calls: Call[] = [];
  const batchId = crypto.randomUUID();
  const msg = { to: "lead@example.test", toName: "Lead", subject: "Assunto", html: "<p>x</p>", text: "x", scheduledAt: "2026-11-04T12:00:00.000Z", batchId, tag: "crm-campaign-1" };
  const accepted = await brevoSend({ ...settings, reply_to: "resp@gravon.com.br" }, msg, transport({ "POST /v3/smtp/email": () => json(201, { messageId: "<id@smtp-relay>" }) }, calls), env);
  assert.deepEqual(accepted, { state: "accepted", messageId: "<id@smtp-relay>" });
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.sender, { email: settings.sender_email, name: "Gravon" });
  assert.equal(body.scheduledAt, msg.scheduledAt);
  assert.equal(body.batchId, batchId);
  assert.deepEqual(body.replyTo, { email: "resp@gravon.com.br" });
  assert.match(body.headers["List-Unsubscribe"], /mailto:resp@gravon.com.br/);
  assert.equal((await brevoSend(settings, msg, transport({ "POST /v3/smtp/email": () => new Response(null, { status: 302, headers: { location: "https://x.test" } }) }), env)).state, "unknown");
  assert.equal((await brevoSend(settings, msg, transport({ "POST /v3/smtp/email": () => { throw new TypeError("network"); } }), env)).state, "unknown");
  assert.equal((await brevoSend(settings, msg, transport({ "POST /v3/smtp/email": () => json(400, { code: "invalid_parameter" }) }), env)).state, "failed");
  const immediate: Call[] = [];
  await brevoSend(settings, { ...msg, scheduledAt: null }, transport({ "POST /v3/smtp/email": () => json(201, { messageId: "<a>" }) }, immediate), env);
  const plain = JSON.parse(String(immediate[0].init.body));
  assert.equal("scheduledAt" in plain || "batchId" in plain || "replyTo" in plain, false);
});

test("cancelamento só confirma com 2xx", async () => {
  assert.equal(await brevoCancelScheduled("b1", transport({ "DELETE /v3/smtp/email/b1": () => new Response(null, { status: 204 }) }), env), true);
  assert.equal(await brevoCancelScheduled("b1", transport({ "DELETE /v3/smtp/email/b1": () => json(404, { code: "not_found" }) }), env), false);
  assert.equal(await brevoCancelScheduled("b1", transport({ "DELETE /v3/smtp/email/b1": () => { throw new Error("x"); } }), env), false);
});
