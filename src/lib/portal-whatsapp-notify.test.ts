import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { handlePortalNotification, type NotifyDependencies } from "./portal-whatsapp-notify-handler.server";
import { approvalNotificationText, PORTAL_NOTIFY_PATH } from "./portal-whatsapp-notify";

const now = Date.parse("2026-10-30T16:00:00Z");
const config = { token: "fake-token-for-tests-only", signingSecret: "fake-signing-secret-for-tests", approvalOrigin: "https://portal.example", enabled: true };
const payload = { project_id: "11111111-1111-4111-8111-111111111111", notification_id: "22222222-2222-4222-8222-222222222222", art_version_id: "33333333-3333-4333-8333-333333333333", client_name: "Ana", client_phone: "5551999990000", project_name: "Projeto Teste", art_title: "Arte 1", approval_url: "https://portal.example/aprovar/fake-approval-token", consent: { granted: true, purpose: "art_approval_whatsapp", phone: "5551999990000", recorded_at: "2026-10-30T15:00:00Z", evidence_id: "consent-test", policy_version: "v1" } };
async function signed(body: unknown, requestId = crypto.randomUUID(), token = config.token, secret = config.signingSecret) {
  const raw = JSON.stringify(body); const ts = String(now);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}\n${requestId}\nPOST\n${PORTAL_NOTIFY_PATH}\n${raw}`)));
  return new Request("https://crm.example/api", { method: "POST", body: raw, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-gravon-timestamp": ts, "x-gravon-request-id": requestId, "x-gravon-signature": Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("") } });
}
function mock() {
  const seen = new Map<string, string>(); const sent: string[] = []; const finished: string[] = [];
  const deps: NotifyDependencies = {
    claim: async (i, f) => { const old = seen.get(i.notification_id); if (old) return old === f ? { code: "duplicate", state: "accepted" } : { code: "conflict" }; seen.set(i.notification_id, f); return { code: "claimed" }; },
    send: async (i) => { sent.push(approvalNotificationText(i)); return { state: "accepted", providerId: "simulated", remoteJid: `${i.client_phone}@s.whatsapp.net` }; },
    finish: async (_i, _r, o) => { finished.push(o.state); },
  };
  return { deps, sent, finished };
}
test("simulated Evolution, authentication, validation, consent and duplicate protection", async () => {
  const m = mock(); const load = async () => m.deps;
  const first = await handlePortalNotification(await signed(payload), config, load, now);
  assert.equal(first.status, 200); assert.deepEqual(await first.json(), { code: "processed", state: "accepted", delivery_confirmed: false });
  assert.equal(m.sent.length, 1); assert.equal(m.sent[0], "Olá, Ana!\n\nUma nova arte do projeto Projeto Teste está aguardando sua aprovação.\n\nAcesse o link abaixo para visualizar a arte, conferir a legenda e aprovar ou solicitar alterações.\n\nhttps://portal.example/aprovar/fake-approval-token\n\nGravon Company");
  assert.equal((await handlePortalNotification(await signed(payload), config, load, now)).status, 200); assert.equal(m.sent.length, 1);
  assert.equal((await handlePortalNotification(await signed({ ...payload, art_title: "Outra" }), config, load, now)).status, 409);
  assert.equal((await handlePortalNotification(await signed(payload, undefined, "wrong"), config, load, now)).status, 401);
  assert.equal((await handlePortalNotification(await signed(payload, undefined, config.token, "wrong-secret"), config, load, now)).status, 401);
  assert.equal((await handlePortalNotification(await signed({ ...payload, consent: { ...payload.consent, granted: false } }), config, load, now)).status, 400);
  assert.equal((await handlePortalNotification(await signed({ ...payload, approval_url: "https://evil.example/a" }), config, load, now)).status, 400);
  assert.equal((await handlePortalNotification(await signed(payload), { ...config, enabled: false }, load, now)).status, 503);
  assert.equal(m.sent.length, 1);
});
test("database dedup, replay, consent, private access and acceptance versus delivery", async () => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$; CREATE TABLE public.analysis_delivery_receipts(instance text,message_id text,remote_jid text,state text,received_at timestamptz);`);
  await db.exec(await readFile("drizzle/migrations/0053_portal_art_whatsapp_notifications.sql", "utf8"));
  const q = async (sql: string, p: unknown[] = []) => (await db.query<{ v: any }>(sql, p)).rows[0]?.v;
  const args = [payload.notification_id, payload.project_id, payload.art_version_id, payload.client_phone, "a".repeat(64), "44444444-4444-4444-8444-444444444444", payload.consent.recorded_at, "e", "v1"];
  const claim = `SELECT claim_portal_whatsapp_notification($1,$2,$3,$4,$5,$6,$7,$8,$9) AS v`;
  assert.equal((await q(claim, args)).code, "claimed");
  assert.equal((await q(claim, args)).code, "duplicate");
  assert.equal((await q(claim, [payload.notification_id, ...args.slice(1, 4), "b".repeat(64), ...args.slice(5)])).code, "conflict");
  assert.equal((await q(claim, ["55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666", ...args.slice(2, 5), args[5], ...args.slice(6)])).code, "replay");
  await assert.rejects(db.query(claim, ["77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888", ...args.slice(2, 5), "99999999-9999-4999-8999-999999999999", "2099-01-01T00:00:00Z", "e", "v1"]), /invalid_consent/);
  assert.equal(await q(`SELECT bind_portal_whatsapp_notification($1,$2,'simulated') AS v`, [args[0], args[5]]), true);
  assert.equal(await q(`SELECT finish_portal_whatsapp_notification($1,$2,'accepted','provider','5551999990000@s.whatsapp.net') AS v`, [args[0], args[5]]), true);
  assert.equal(await q(`SELECT state AS v FROM portal_whatsapp_notifications`), "accepted");
  await db.exec(`INSERT INTO analysis_delivery_receipts VALUES('simulated','provider','5551999990000@s.whatsapp.net','DELIVERY_ACK',now())`);
  assert.equal(await q(`SELECT state AS v FROM portal_whatsapp_notifications`), "delivered");
  assert.equal(await q(`SELECT has_table_privilege('anon','portal_whatsapp_notifications','SELECT') AS v`), false);
  assert.equal(await q(`SELECT has_function_privilege('authenticated','claim_portal_whatsapp_notification(uuid,uuid,uuid,text,text,uuid,timestamptz,text,text)','EXECUTE') AS v`), false);
  await db.close();
});
test("approval links: only official Portal https, no external redirects", async () => {
  const { validApprovalUrl, PORTAL_APPROVAL_ORIGIN: o } = await import("./portal-whatsapp-notify");
  assert.equal(o, "https://portal.gravoncompany.com");
  assert.equal(validApprovalUrl("https://portal.gravoncompany.com/aprovar/abc", o), true);
  assert.equal(validApprovalUrl("http://portal.gravoncompany.com/aprovar/abc", o), false);
  assert.equal(validApprovalUrl("https://portal.gravoncompany.com.evil.com/a", o), false);
  assert.equal(validApprovalUrl("https://evil.com/aprovar", o), false);
  assert.equal(validApprovalUrl("https://portal.gravoncompany.com/", o), false);
  assert.equal(validApprovalUrl("https://portal.gravoncompany.com/a?next=https://evil.com", o), false);
  assert.equal(validApprovalUrl("https://portal.gravoncompany.com/a?r=//evil.com", o), false);
  assert.equal(validApprovalUrl("https://portal.gravoncompany.com//evil.com", o), false);
});
