import test from "node:test";
import assert from "node:assert/strict";
import { approveMessageInput, nextMessageInput, verifyConversationAnchor, providerConversationVersion, canonicalJson, withinAnalysisPeriod, maySend, type ProviderMessage } from "./analysis-next-message";

const jid = "5511987654321@s.whatsapp.net";
const base: ProviderMessage = { key: { id: "TEST_ID", remoteJid: jid, fromMe: false }, messageTimestamp: 1793100000, message: { conversation: "Tenho interesse" } };
test("approval preserves the exact reviewed content, including whitespace", () => {
  const text = "  Olá!\nPodemos conversar?  ";
  assert.equal(approveMessageInput.parse({ id: "00000000-0000-4000-8000-000000000001", text }).text, text);
});
test("model cannot provide recipient or instance to approval", () => {
  assert.throws(() => approveMessageInput.parse({ id: "00000000-0000-4000-8000-000000000001", text: "Olá", phone: jid }));
});
test("empty approved messages are rejected", () => assert.throws(() => approveMessageInput.parse({ id: "00000000-0000-4000-8000-000000000001", text: " \n " })));
test("impossible period date is rejected", () => assert.throws(() => nextMessageInput.parse({ phone: "5511987654321", start: "2026-02-30", end: "2026-10-27" })));
test("analysis period uses inclusive Brazil boundaries", () => {
  assert.equal(withinAnalysisPeriod("2026-10-27T02:59:59Z", "2026-10-27", "2026-10-27"), false);
  assert.equal(withinAnalysisPeriod("2026-10-27T03:00:00Z", "2026-10-27", "2026-10-27"), true);
  assert.equal(withinAnalysisPeriod("2026-10-28T02:59:59.999Z", "2026-10-27", "2026-10-27"), true);
  assert.equal(withinAnalysisPeriod("2026-10-28T03:00:00Z", "2026-10-27", "2026-10-27"), false);
});
test("anchor requires exact provider id", () => assert.throws(() => verifyConversationAnchor([base], { id: "OTHER", fromMe: false, jid })));
test("anchor requires matching direction", () => assert.throws(() => verifyConversationAnchor([base], { id: "TEST_ID", fromMe: true, jid })));
test("duplicate provider ids fail closed", () => assert.throws(() => verifyConversationAnchor([base, base], { id: "TEST_ID", fromMe: false, jid })));
test("LID needs explicit mode and exact alternative number", () => {
  const lid = { ...base, key: { ...base.key, remoteJid: "1234567890123@lid", remoteJidAlt: jid } };
  assert.throws(() => verifyConversationAnchor([lid], { id: "TEST_ID", fromMe: false, jid }));
  assert.equal(verifyConversationAnchor([{ ...lid, key: { ...lid.key, addressingMode: "lid" } }], { id: "TEST_ID", fromMe: false, jid }).key.remoteJidAlt, jid);
  assert.throws(() => verifyConversationAnchor([{ ...lid, key: { ...lid.key, addressingMode: "lid", remoteJidAlt: "5511987654322@s.whatsapp.net" } }], { id: "TEST_ID", fromMe: false, jid }));
});
test("a new inbound or attendant reply changes the draft version", () => {
  assert.notEqual(providerConversationVersion([base]), providerConversationVersion([base, { ...base, key: { ...base.key, id: "NEW", fromMe: true } }]));
});
test("content changes invalidate draft", () => assert.notEqual(providerConversationVersion([base]), providerConversationVersion([{ ...base, message: { conversation: "Outra mensagem" } }])));
test("equivalent property ordering does not invalidate draft", () => assert.equal(canonicalJson({ b: { y: 2, x: 1 }, a: 0 }), canonicalJson({ a: 0, b: { x: 1, y: 2 } })));
test("accepted unknown failed sending and stale never permit resend", () => {
  assert.equal(maySend("pending"), true);
  for (const state of ["accepted", "unknown", "failed", "sending", "stale"]) assert.equal(maySend(state), false);
});