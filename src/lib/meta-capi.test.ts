import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCapiTestEvent, capiFailureText, graphErrorCode, graphFetchInit, validatePixelAccess, pixelIdSchema, testEventCodeSchema } from "./meta-capi";

test("Pixel ID accepts only 6–25 digits", () => {
  assert.equal(pixelIdSchema.safeParse("123456789012345").success, true);
  assert.equal(pixelIdSchema.safeParse("12345").success, false);
  assert.equal(pixelIdSchema.safeParse("act_123456789").success, false);
});

test("test event code must come from Test events (TEST…)", () => {
  assert.equal(testEventCodeSchema.safeParse("TEST12345").success, true);
  assert.equal(testEventCodeSchema.safeParse("12345").success, false);
});

test("test event goes only to Test events, without personal data", async () => {
  const body = await buildCapiTestEvent("TEST999", 1_700_000_000_000, "abc");
  assert.equal(body.test_event_code, "TEST999");
  assert.equal(body.partner_agent, "lovable");
  const event = body.data[0]!;
  assert.equal(event.event_time, 1_700_000_000);
  assert.equal(event.event_id, "pipeflow-test-abc");
  assert.deepEqual(Object.keys(event.user_data), ["external_id"]);
  assert.match(event.user_data.external_id[0]!, /^[0-9a-f]{64}$/);
});

test("Graph errors map to explanations without provider text", () => {
  assert.equal(graphErrorCode({ error: { code: 190, message: "secret detail" } }), "190");
  assert.equal(graphErrorCode({ error: { code: 100, error_subcode: 33 } }), "100:33");
  assert.match(capiFailureText({ http: 400, code: "190" }), /token/);
  assert.match(capiFailureText({ http: 400, code: "100:33" }), /Pixel/);
  assert.doesNotMatch(capiFailureText({ http: 500, code: "unknown" }), /secret/);
});

test("Graph calls never use redirect 'error' (rejected by the live server runtime) and keep the token out of the URL", () => {
  const get = graphFetchInit("tok_abcdefghijklmnopqrstuvwxyz0123456789");
  assert.equal(get.redirect, "manual");
  assert.equal(get.method, "GET");
  assert.equal((get.headers as Record<string, string>).Authorization, "Bearer tok_abcdefghijklmnopqrstuvwxyz0123456789");
  const post = graphFetchInit("tok", { data: [] });
  assert.equal(post.method, "POST");
  assert.equal(post.redirect, "manual");
  assert.equal(capiFailureText({ http: 302, code: "redirect" }).includes("Nada foi alterado"), true);
});

const fake = (replies: Record<string, { ok: true; body: unknown } | { ok: false; http: number; code: string }>) => {
  const calls: string[] = [];
  return { calls, call: async (path: string) => { calls.push(path); return replies[path.split("?")[0]] ?? { ok: false as const, http: 500, code: "unknown" }; } };
};

test("Events Manager token: Pixel read refused (100:33) but token valid → saved as limited, no event sent", async () => {
  const f = fake({ "700246889593303": { ok: false, http: 400, code: "100:33" }, me: { ok: true, body: { id: "1" } } });
  const r = await validatePixelAccess("700246889593303", f.call);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.status, "limited");
  assert.equal(f.calls.some((p) => p.includes("/events")), false);
});

test("Pixel read refused and token expired (190) → rejected as invalid token", async () => {
  const f = fake({ "700246889593303": { ok: false, http: 400, code: "100" }, me: { ok: false, http: 400, code: "190" } });
  const r = await validatePixelAccess("700246889593303", f.call);
  assert.deepEqual(r, { ok: false, http: 400, code: "190" });
});

test("Pixel readable → confirmed with name", async () => {
  const f = fake({ "700246889593303": { ok: true, body: { id: "700246889593303", name: "Gravon" } } });
  const r = await validatePixelAccess("700246889593303", f.call);
  assert.equal(r.ok && r.status, "ok");
  assert.equal(r.ok && r.name, "Gravon");
});

test("permission errors other than 100 are not softened", async () => {
  const f = fake({ "700246889593303": { ok: false, http: 403, code: "200" } });
  const r = await validatePixelAccess("700246889593303", f.call);
  assert.deepEqual(r, { ok: false, http: 403, code: "200" });
  assert.equal(f.calls.length, 1);
});
