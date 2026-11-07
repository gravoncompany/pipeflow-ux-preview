import { test } from "node:test";
import assert from "node:assert/strict";
import { crmSessionCookieOptions } from "./crm-session-cookie";

const preview = "https://35f32e53-6c82-48bf-beea-4b5125aef274.lovableproject.com";
test("HTTPS embedded preview uses a secure HttpOnly partitioned session", () => {
  assert.deepEqual(crmSessionCookieOptions(new Request(preview), false), {
    httpOnly: true, secure: true, sameSite: "none", partitioned: true, path: "/",
  });
});
test("local preview proxy recognizes only the HTTPS platform preview origin", () => {
  const options = crmSessionCookieOptions(new Request("http://localhost:8080", { headers: { origin: preview } }), false);
  assert.equal(options.sameSite, "none");
  assert.equal(options.secure, true);
  assert.equal("partitioned" in options && options.partitioned, true);
});
test("development proxy forwarding the preview host over HTTP keeps the embedded session", () => {
  const options = crmSessionCookieOptions(new Request("http://35f32e53-6c82-48bf-beea-4b5125aef274.lovableproject.com/_serverFn/x"), false);
  assert.equal(options.sameSite, "none");
  assert.equal(options.secure, true);
  assert.equal("partitioned" in options && options.partitioned, true);
  assert.equal(crmSessionCookieOptions(new Request("http://35f32e53-6c82-48bf-beea-4b5125aef274.lovableproject.com"), true).sameSite, "strict");
});
test("published Pipeflow keeps Strict and Secure sessions", () => {
  assert.deepEqual(crmSessionCookieOptions(new Request("https://crm.gravoncompany.com"), true), {
    httpOnly: true, secure: true, sameSite: "strict", path: "/",
  });
});
test("untrusted origins and forwarded headers cannot relax production cookie policy", () => {
  for (const origin of ["https://attacker.invalid", `${preview}.attacker.invalid`, "http://35f32e53-6c82-48bf-beea-4b5125aef274.lovableproject.com"]) {
    const request = new Request("https://crm.gravoncompany.com", { headers: { origin, "x-forwarded-host": new URL(preview).host } });
    assert.equal(crmSessionCookieOptions(request, true).sameSite, "strict");
    assert.equal("partitioned" in crmSessionCookieOptions(request, true), false);
    assert.equal(crmSessionCookieOptions(new Request("http://localhost:8080", { headers: { origin } }), false).sameSite, "strict");
  }
});
test("ordinary local development retains its compatible Strict session", () => {
  assert.deepEqual(crmSessionCookieOptions(new Request("http://localhost:8080"), false), {
    httpOnly: true, secure: false, sameSite: "strict", path: "/",
  });
});test("the preview session header is never accepted on the published site", async () => {
  const { allowsPreviewSessionHeader } = await import("./crm-session-cookie");
  assert.equal(allowsPreviewSessionHeader(new Request("https://crm.gravoncompany.com"), true), false);
  assert.equal(allowsPreviewSessionHeader(new Request("https://boardly-leads.lovable.app", { headers: { origin: preview } }), true), false);
  assert.equal(allowsPreviewSessionHeader(new Request("https://id-preview--35f32e53-6c82-48bf-beea-4b5125aef274.lovable.app"), true), true);
  assert.equal(allowsPreviewSessionHeader(new Request("http://localhost:8080"), false), true);
});
