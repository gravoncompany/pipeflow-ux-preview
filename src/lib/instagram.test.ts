import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInstagramEvent, eligibleFirstGreeting, eventFromGraphMessage, instagramCandidate, instagramSettings, instagramWebhook, payloadShape, verificationChallenge, verifyInstagramSignature } from "./instagram";
const now = Date.parse("2026-10-28T02:31:00Z");
const inbound = { sender: { id: "222" }, recipient: { id: "111" }, timestamp: now, message: { mid: "mid.1", text: "Olá" } };
test("incoming sender remains Instagram-scoped; no phone/email guessed", () => {
  assert.deepEqual(classifyInstagramEvent("111", inbound, now), { sender: "222", mid: "mid.1", inbound: true, body: "Olá", kind: "text", sentAt: new Date(now).toISOString() });
});
test("messages to another account are rejected", () => { assert.equal(classifyInstagramEvent("999", inbound, now), null); });
test("own messages are outbound, never greeting candidates", () => { assert.equal(classifyInstagramEvent("111", { ...inbound, sender: { id: "111" }, recipient: { id: "222" }, message: { ...inbound.message, is_echo: true } }, now)?.inbound, false); });
test("contradictory inbound echo rejected", () => { assert.equal(classifyInstagramEvent("111", { ...inbound, message: { ...inbound.message, is_echo: true } }, now), null); });
test("self to self ignored", () => { assert.equal(classifyInstagramEvent("111", { ...inbound, sender: { id: "111" } }, now), null); });
test("greeting only first contact and received message", () => {
  assert.equal(eligibleFirstGreeting(true, true, true, now, now), true);
  assert.equal(eligibleFirstGreeting(false, true, true, now, now), false);
  assert.equal(eligibleFirstGreeting(true, true, false, now, now), false);
  assert.equal(eligibleFirstGreeting(true, false, true, now, now), false);
});
test("old and future events do not authorize greeting", () => {
  assert.equal(eligibleFirstGreeting(true, true, true, now - 86400001, now), false);
  assert.equal(eligibleFirstGreeting(true, true, true, now + 300001, now), false);
});
test("non message events not treated as directs", () => { assert.equal(classifyInstagramEvent("111", { sender: { id: "222" }, recipient: { id: "111" }, timestamp: now }, now), null); });
test("deleted content never reconstructed", () => { assert.equal(classifyInstagramEvent("111", { ...inbound, message: { ...inbound.message, is_deleted: true } }, now)?.body, null); });
test("envelope and settings validated; greeting has no default invention", () => {
  assert.equal(instagramWebhook.safeParse({ object: "page", entry: [] }).success, false);
  assert.equal(instagramSettings.safeParse({ greetingEnabled: true, greeting: "" }).success, false);
  assert.equal(instagramSettings.safeParse({ greetingEnabled: false, greeting: "" }).success, true);
});
test("Meta verification challenge requires exact token and subscribe mode", () => {
  assert.equal(verificationChallenge(new URL("https://test.invalid?hub.mode=subscribe&hub.verify_token=test-only&hub.challenge=123456"), "test-only"), "123456");
  assert.equal(verificationChallenge(new URL("https://test.invalid?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123456"), "test-only"), null);
});
test("raw-byte HMAC rejects invalid signature and altered payload", async () => {
  const secret = "test-only-not-a-real-secret"; const body = new TextEncoder().encode('{"entry":[]}');
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = "sha256=" + Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, body)), b => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyInstagramSignature(body, signature, secret), true);
  assert.equal(await verifyInstagramSignature(new TextEncoder().encode('{"entry":[1]}'), signature, secret), false);
  assert.equal(await verifyInstagramSignature(body, null, secret), false);
});
test("official envelope batches preserve exact account and message identifiers", () => {
  const parsed = instagramWebhook.parse([{ object: "instagram", entry: [{ id: "111", messaging: [inbound] }] }]);
  assert.equal(parsed.entry[0]?.id, "111");
  const first = parsed.entry[0]?.candidates[0];
  assert.ok(first && "event" in first); assert.equal(first.event.message?.mid, "mid.1");
  assert.equal(instagramWebhook.safeParse([{ object: "instagram", entry: [] }, { object: "page", entry: [] }]).success, false);
});
test("Meta self test never becomes a customer message or greeting", () => {
  assert.equal(classifyInstagramEvent("111", { ...inbound, message: { ...inbound.message, is_self: true } }, now), null);
});
test("numeric identities are not rounded or implicitly bound", () => {
  const parsed = instagramWebhook.parse({ object: "instagram", entry: [{ id: 17841460671590416, messaging: [inbound] }] });
  assert.equal(parsed.entry.length, 0); assert.equal(parsed.rejected.length, 1);
});
test("batch validation remains bounded", () => {
  assert.equal(instagramWebhook.safeParse(Array.from({ length: 101 }, () => ({ object: "instagram", entry: [] }))).success, false);
});
test("bounded mixed batches do not drop messages announced after 100 messaging items", () => {
  const parsed = instagramWebhook.parse({ object: "instagram", entry: [{
    id: "111",
    messaging: Array.from({ length: 100 }, () => ({ read: { mid: "read-only" } })),
    changes: [{ field: "messages", value: inbound }],
  }] });
  const candidates = parsed.entry[0]?.candidates ?? [];
  assert.equal(candidates.length, 101);
  const last = candidates[100];
  assert.ok(last && "event" in last);
  assert.equal(classifyInstagramEvent("111", last.event, now)?.mid, "mid.1");
});
test("a real direct survives next to an unknown item in the same signed batch", () => {
  const parsed = instagramWebhook.parse({ object: "instagram", entry: [{ id: "111", time: 1, messaging: [{ sender: { id: "222" }, recipient: { id: "111" }, timestamp: now, read: { mid: "x" } }, { foo: 1 }, inbound] }] });
  const kinds = parsed.entry[0]!.candidates.map(c => Object.keys(c)[0]);
  assert.deepEqual(kinds, ["skip", "skip", "event"]);
});
test("Meta 'changes' format with field messages is extracted", () => {
  const parsed = instagramWebhook.parse({ object: "instagram", entry: [{ id: "111", time: 1, changes: [{ field: "messages", value: inbound }, { field: "comments", value: {} }] }] });
  assert.equal(parsed.entry[0]!.candidates.length, 1); assert.ok("event" in parsed.entry[0]!.candidates[0]!);
});
test("new direct announced as message_edit num_edit 0 is resolved by mid; real edits are skipped", () => {
  assert.deepEqual(instagramCandidate({ message_edit: { mid: "mid.9", num_edit: 0 } }), { lookup: "mid.9" });
  assert.deepEqual(instagramCandidate({ sender: { id: "222" }, recipient: { id: "111" }, timestamp: 1, message_edit: { mid: "mid.9", num_edit: 2 } }), { skip: "message_edited" });
  const full = instagramCandidate({ sender: { id: "222" }, recipient: { id: "111" }, timestamp: 1700000000, message_edit: { mid: "mid.9", text: "Oi", num_edit: 0 } });
  assert.ok("event" in full); assert.equal(full.event.message?.text, "Oi"); assert.equal(full.event.timestamp, 1700000000000);
});
test("message missing sender/recipient is resolved by mid instead of dropped", () => {
  assert.deepEqual(instagramCandidate({ timestamp: now, message: { mid: "mid.7", text: "Oi" } }), { lookup: "mid.7" });
  assert.deepEqual(instagramCandidate({ message: { mid: "mid.7", is_self: true } }), { skip: "meta_self_test" });
});
test("Graph API message lookup must match the notified mid", () => {
  const node = { id: "mid.7", created_time: "2026-10-30T20:41:00+0000", from: { id: "222", username: "p" }, to: { data: [{ id: "111", username: "g" }] }, message: "Oi" };
  const ev = eventFromGraphMessage("mid.7", node)!;
  assert.equal(classifyInstagramEvent("111", ev, Date.parse("2026-10-30T20:42:00Z"))?.body, "Oi");
  assert.equal(ev.timestamp, Date.parse("2026-10-30T20:41:00Z"));
  assert.equal(eventFromGraphMessage("mid.other", node), null);
});
test("diagnostic shape never contains values", () => {
  const shape = JSON.stringify(payloadShape({ object: "instagram", entry: [{ id: "111", messaging: [{ message: { mid: "secret-mid", text: "segredo do cliente" } }] }] }));
  assert.ok(!shape.includes("segredo") && !shape.includes("secret-mid") && !shape.includes("111")); assert.ok(shape.includes("text"));
});
test("non-Instagram envelopes are still refused", () => { assert.equal(instagramWebhook.safeParse({ object: "page", entry: [] }).success, false); });
