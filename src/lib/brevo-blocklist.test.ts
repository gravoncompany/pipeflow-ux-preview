import { test } from "node:test";
import assert from "node:assert/strict";
import { brevoBlockedContacts } from "./brevo.server";

const env = { BREVO_API_KEY: "test-key" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("lista de bloqueio da Brevo retorna só os endereços pedidos, com o motivo, sem enviar nada", async () => {
  const calls: string[] = [];
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    return json({
      count: 3,
      contacts: [
        { email: "Bounce@Example.test", reason: { code: "hardBounce" } },
        { email: "spam@example.test", reason: { code: "contactFlaggedAsSpam" } },
        { email: "outro@example.test", reason: { code: "unsubscribedViaEmail" } },
      ],
    });
  }) as typeof fetch;
  const r = await brevoBlockedContacts(["bounce@example.test", "spam@example.test", "ok@example.test"], transport, env);
  assert.deepEqual(r, { ok: true, blocked: { "bounce@example.test": "hardBounce", "spam@example.test": "contactFlaggedAsSpam" } });
  assert.ok(calls.every((c) => c.startsWith("GET ") && c.includes("/smtp/blockedContacts")));
});

test("falha ou chave ausente na Brevo nunca libera destinatários silenciosamente", async () => {
  const fail = (async () => json({ message: "x" }, 401)) as unknown as typeof fetch;
  assert.deepEqual(await brevoBlockedContacts(["a@example.test"], fail, env), { ok: false, code: "unavailable" });
  assert.deepEqual(await brevoBlockedContacts(["a@example.test"], fail, {}), { ok: false, code: "credential_missing" });
});
