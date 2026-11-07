import { test } from "node:test";
import assert from "node:assert/strict";
import { b2bConfig, makeCursor, readCursor } from "./b2b-prospecting.server";
import { assertCrmAdmin } from "./crm-leads-access";

test("activation is default-off, secrets are not exposed and only contracted datasets are enabled", () => {
  assert.equal(b2bConfig({}).enabled, false);
  const env = {
    B2B_ENABLED: "true",
    B2B_GOOGLE_PLACES_API_KEY: "test-key",
    B2B_DESKDATA_TOKEN: "test-token",
    B2B_TERMS_URL: "https://example.test/terms",
    B2B_PRIVACY_URL: "https://example.test/privacy",
    B2B_DESKDATA_DATASETS: "basic,emails",
    B2B_GOOGLE_DAILY_LIMIT: "999999",
  };
  const config = b2bConfig(env);
  assert.equal(config.googleReady, true);
  assert.equal(config.googleKeyConfigured, true);
  assert.equal(config.deskReady, true);
  assert.equal(config.googleDailyLimit, 50);
  assert.equal(JSON.stringify(config).includes("test-key"), false);
  assert.equal(JSON.stringify(config).includes("test-token"), false);
  assert.equal(
    b2bConfig({ ...env, B2B_DESKDATA_DATASETS: "basic,unknown" }).deskReady,
    false,
  );
  assert.equal(b2bConfig({ ...env, B2B_PRIVACY_URL: "" }).googleReady, false);
  assert.equal(b2bConfig({ ...env, B2B_GOOGLE_PLACES_API_KEY: "  " }).googleReady, false);
  assert.equal(b2bConfig({ ...env, B2B_ENABLED: "false" }).googleKeyConfigured, true);
  assert.equal(b2bConfig({ ...env, B2B_ENABLED: "false" }).googleReady, false);
  assert.throws(() => assertCrmAdmin("limited"));
  assert.throws(() => assertCrmAdmin(null));
  assert.doesNotThrow(() => assertCrmAdmin("full"));
});
test("pagination is signed, query-bound and expires instead of silently changing the search", async () => {
  const input = { segment: "facilities", city: "Curitiba", state: "PR" as const };
  const cursor = await makeCursor(input, "next-page", "test-secret", 1000);
  assert.equal(await readCursor({ ...input, cursor }, "test-secret", 2000), "next-page");
  await assert.rejects(readCursor({ ...input, cursor }, "other-secret", 2000));
  await assert.rejects(readCursor({ ...input, cursor, city: "Londrina" }, "test-secret", 2000));
  await assert.rejects(readCursor({ ...input, cursor }, "test-secret", 901000));
  const envelope = JSON.parse(cursor);
  envelope.payload = envelope.payload.replace("next-page", "stolen-page");
  await assert.rejects(
    readCursor({ ...input, cursor: JSON.stringify(envelope) }, "test-secret", 2000),
  );
});
test("partner datasets require explicit configuration and phones require relationships", () => {
  const base = { B2B_ENABLED: "true", B2B_DESKDATA_TOKEN: "fake" };
  assert.deepEqual(b2bConfig(base).datasets, ["basic"]);
  assert.equal(b2bConfig({ ...base, B2B_DESKDATA_DATASETS: "basic,relationships,relationships_phones" }).deskReady, true);
  assert.equal(b2bConfig({ ...base, B2B_DESKDATA_DATASETS: "basic,relationships_phones" }).deskReady, false);
});
