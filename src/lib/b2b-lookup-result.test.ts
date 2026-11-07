import { test } from "node:test";
import assert from "node:assert/strict";
import { b2bLookupResult } from "./b2b-lookup-result";

test("provider HTTP500 becomes a handled failure without retry or leaking response", async () => {
  let calls = 0;
  const result = await b2bLookupResult(async () => {
    calls++;
    throw new Error("private provider body");
  }, () => ({ code: "http_500", message: "A DeskData recusou a consulta (HTTP 500)." }));
  assert.deepEqual(result, { ok: false, code: "http_500", message: "A DeskData recusou a consulta (HTTP 500)." });
  assert.equal(calls, 1);
});
test("unknown errors do not expose provider or database content", async () => {
  const result = await b2bLookupResult(async () => { throw new Error("private customer data"); }, () => null);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
test("empty company is successful absence, not an integration error", async () => {
  assert.deepEqual(await b2bLookupResult(async () => null, () => null), { ok: true, company: null });
});