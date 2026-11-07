import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { publicCloudDefines, resolvePublicCloudDefines } from "./public-cloud-env";
import { cloudPublicBinding } from "./cloud-public-binding";

const url = "https://cloud.example.test";
const key = "sb_publishable_test_configuration_only";
describe("Public Cloud build configuration", () => {
  it("na versão experimental, sem variáveis de ambiente o build é bloqueado (sem conexão embutida)", () => {
    assert.equal(cloudPublicBinding.VITE_SUPABASE_URL, undefined);
    assert.throws(() => resolvePublicCloudDefines({}, cloudPublicBinding), /configuration is missing/);
  });
  it("keeps explicit VITE configuration ahead of the public fallback", () => {
    const result = resolvePublicCloudDefines({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key }, cloudPublicBinding);
    assert.equal(result["import.meta.env.VITE_SUPABASE_URL"], JSON.stringify(url));
    assert.equal(result["import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY"], JSON.stringify(key));
  });
  it("does not hide incomplete configuration with fallback fields", () => {
    assert.throws(() => resolvePublicCloudDefines({ VITE_SUPABASE_URL: url }, cloudPublicBinding), /configuration is missing/);
    assert.throws(() => resolvePublicCloudDefines({ SUPABASE_PUBLISHABLE_KEY: key }, cloudPublicBinding), /configuration is missing/);
  });
  it("validates fallback keys and addresses instead of bypassing protection", () => {
    assert.throws(() => resolvePublicCloudDefines({}, { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: "sb_secret_private" }), /publishable/);
    assert.throws(() => resolvePublicCloudDefines({}, { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: key }), /address/);
    assert.throws(() => resolvePublicCloudDefines({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_private" }, cloudPublicBinding), /publishable/);
  });
  it("injects public runtime bindings when VITE bindings are absent", () => {
    assert.deepEqual(publicCloudDefines({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key }), {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(key),
    });
  });
  it("preserves browser URL precedence over sandbox server bindings", () => {
    const result = publicCloudDefines({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key,
      SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "sb_secret_do_not_export" });
    assert.equal(result["import.meta.env.VITE_SUPABASE_URL"], JSON.stringify(url));
    assert.equal(result["import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY"], JSON.stringify(key));
  });
  it("blocks incomplete builds instead of publishing a broken client", () => {
    assert.throws(() => publicCloudDefines({}), /configuration is missing/);
    assert.throws(() => publicCloudDefines({ SUPABASE_URL: url }), /configuration is missing/);
  });
  it("rejects privileged keys even in a public variable", () => {
    assert.throws(() => publicCloudDefines({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" }), /publishable/);
    const jwt = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.test`;
    assert.throws(() => publicCloudDefines({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: jwt }), /publishable/);
  });
  it("supports existing anonymous JWT keys without exporting other secrets", () => {
    const jwt = `e30.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.test`;
    const result = publicCloudDefines({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: jwt, SUPABASE_SERVICE_ROLE_KEY: "private" });
    assert.equal(Object.keys(result).length, 2);
    assert.equal(JSON.stringify(result).includes("private"), false);
  });
  it("rejects sandbox-only or malformed addresses", () => {
    for (const address of ["http://127.0.0.1:54321", "invalid", "https://user:pass@cloud.example.test"]) {
      assert.throws(() => publicCloudDefines({ SUPABASE_URL: address, SUPABASE_PUBLISHABLE_KEY: key }), /address/);
    }
  });
});