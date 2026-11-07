import { test } from "node:test";
import assert from "node:assert/strict";
import { instagramApi, InstagramApiError, readBounded } from "./instagram-api.server";
test("greeting request uses exact account, scoped recipient and saved text", async () => {
  let calls = 0;
  const result = await instagramApi("111/messages", "test-only", "POST", { recipient: { id: "222" }, message: { text: "Olá, como podemos ajudar?" } }, (async (url, init) => {
    calls++;
    assert.equal(String(url), "https://graph.instagram.com/v25.0/111/messages");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.body, JSON.stringify({ recipient: { id: "222" }, message: { text: "Olá, como podemos ajudar?" } }));
    return Response.json({ recipient_id: "222", message_id: "test-mid" });
  }) as typeof fetch);
  assert.deepEqual(result, { recipient_id: "222", message_id: "test-mid" }); assert.equal(calls, 1);
});
test("failed greeting is not retried and provider details omit raw payload", async () => {
  let calls = 0;
  await assert.rejects(instagramApi("111/messages", "test-only", "POST", {}, (async () => {
    calls++; return Response.json({ error: { code: 190, error_subcode: 463, message: "untrusted sensitive provider text" } }, { status: 401 });
  }) as typeof fetch), error => error instanceof InstagramApiError && error.status === 401 && error.code === 190 && !error.message.includes("sensitive"));
  assert.equal(calls, 1);
});
test("provider redirect rejected without forwarding credentials", async () => {
  let calls = 0;
  await assert.rejects(instagramApi("111/messages", "test-only", "POST", {}, (async () => { calls++; return new Response(null, { status: 302, headers: { Location: "https://elsewhere.invalid" } }); }) as typeof fetch));
  assert.equal(calls, 1);
});
test("oversized replies fail closed", async () => { await assert.rejects(readBounded(new Response("12345"), 4), /instagram_payload_too_large/); });