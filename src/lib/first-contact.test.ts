import { test } from "node:test";
import assert from "node:assert/strict";
import { commercialFormOrigin, FIRST_CONTACT_MESSAGES, fixedFirstContactText, firstContactConsentSchema, firstContactIdentity, firstContactSettingsSchema, executeFirstContactStep, type FirstContactOutcome } from "./first-contact";

test("João Pedro Silva uses João and Brazilian normalized WhatsApp", () => {
  assert.deepEqual(firstContactIdentity(" João Pedro Silva ", "(11) 98888-7777"), { first: "João", phone: "5511988887777" });
});
test("invalid phone and missing real first name do not authorize a send", () => {
  assert.equal(firstContactIdentity("João", "123"), null); assert.equal(firstContactIdentity("Sem nome", "11988887777"), null);
});
test("only commercial landing origin is eligible, never another implementation site", () => {
  assert.equal(commercialFormOrigin("https://trafego.gravoncompany.com/?utm_source=meta"), "https://trafego.gravoncompany.com");
  assert.equal(commercialFormOrigin("https://implementacao.example.com"), null);
});
test("consent must be literal true with timestamp and evidence version", () => {
  assert.equal(firstContactConsentSchema.safeParse({ granted: "true", at: "2026-10-28T18:00:00Z", version: "v1" }).success, false);
  assert.equal(firstContactConsentSchema.safeParse({ granted: true, at: "2026-10-28T18:00:00Z", version: "v1" }).success, true);
  assert.equal(firstContactConsentSchema.safeParse({ granted: true }).success, false);
});
test("exact four fixed messages without emojis, signatures or AI substitutions", () => {
  assert.equal(FIRST_CONTACT_MESSAGES.length, 4);
  assert.deepEqual([1,2,3,4].map(step => fixedFirstContactText(step, "João")), [
    "Olá, João! Tudo bem?",
    "Vi que você preencheu nosso formulário sobre nossa agência de tráfego pago e marketing digital, onde apresentamos nosso plano atual.",
    "Estamos com um plano de teste disponível para que você possa conhecer nosso serviço de tráfego pago durante 30 dias.",
    "Gostaria de saber se você já investiu em tráfego pago?",
  ]);
});
test("interval is configurable from 5 seconds and enabled must be explicit", () => {
  const s = { enabled: false, interval: 5, instance: "fake", revision: "00000000-0000-4000-8000-000000000001" };
  assert.equal(firstContactSettingsSchema.safeParse(s).success, true);
  assert.equal(firstContactSettingsSchema.safeParse({ ...s, interval: 4 }).success, false);
});
const claim = { id: "00000000-0000-4000-8000-000000000001", step: 1, body: "Olá, João! Tudo bem?", phone: "5511988887777", senderPhone: "5511988889999", instance: "fake" };
test("sequence interval defaults to ten seconds", () => {
  assert.equal(firstContactSettingsSchema.parse({ enabled: false, instance: "fake", revision: claim.id }).interval, 10);
});
test("stop on reply defaults to true and accepts an explicit false", () => {
  const settings = { enabled: false, interval: 10, instance: "fake", revision: claim.id };
  assert.equal(firstContactSettingsSchema.parse(settings).stopOnReply, true);
  assert.equal(firstContactSettingsSchema.parse({ ...settings, stopOnReply: false }).stopOnReply, false);
});
test("disabled or interrupted immediately before send makes zero provider calls", async () => {
  let sends = 0; let outcome: FirstContactOutcome | undefined;
  await executeFirstContactStep(claim, { authorize: async () => false, send: async () => { sends++; return new Response(); }, receipt: async () => null, persist: async o => { outcome = o; } });
  assert.equal(sends, 0); assert.equal(outcome?.state, "failed");
});
test("Evolution rejection and unknown acceptance never retry", async () => {
  for (const response of [new Response("", { status: 400 }), new Response("{}")]) {
    let sends = 0; let outcome: FirstContactOutcome | undefined;
    await executeFirstContactStep(claim, { authorize: async () => true, send: async () => { sends++; return response; }, receipt: async () => null, persist: async o => { outcome = o; } });
    assert.equal(sends, 1); assert.equal(outcome?.state, response.ok ? "unknown" : "failed");
  }
});
test("transport timeout remains unknown and persistence failure never resends", async () => {
  let sends = 0; let state = "";
  await executeFirstContactStep(claim, { authorize: async () => true, send: async () => { sends++; throw new Error("timeout"); }, receipt: async () => null, persist: async o => { state = o.state; } });
  assert.equal(state, "unknown"); assert.equal(sends, 1);
  await assert.rejects(executeFirstContactStep(claim, { authorize: async () => true, send: async () => { sends++; return new Response("{}"); }, receipt: async () => ({ id: "provider-id", at: "2026-10-28T18:00:00Z" }), persist: async () => { throw new Error("db"); } }), /db/);
  assert.equal(sends, 2);
});