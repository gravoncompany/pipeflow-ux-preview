import { test } from "node:test";
import assert from "node:assert/strict";
import { adminAccessProblem, crmChannels, isMissingSchema, safeReturnPath } from "./crm-agent-access";
import { phoneDigits } from "./phone";

test("return path after /auth accepts only internal CRM paths", () => {
  assert.equal(safeReturnPath("/configuracoes/whatsapp"), "/configuracoes/whatsapp");
  assert.equal(safeReturnPath("/"), "/");
  for (const bad of ["//evil.com", "https://evil.com", "/x?y=1", "javascript:alert(1)", "", 5, "/a b"]) assert.equal(safeReturnPath(bad), undefined);
});

test("each missing piece of access has its own reason, so the page asks only for it", () => {
  assert.equal(adminAccessProblem(null, { authorized: true })?.reason, "crm_session");
  assert.equal(adminAccessProblem("limited", { authorized: true })?.reason, "crm_session");
  assert.equal(adminAccessProblem("full", null)?.reason, "admin_account");
  assert.match(adminAccessProblem("full", { authorized: false })!.message, /ainda não foi liberada/);
  assert.equal(adminAccessProblem("full", { authorized: true }), null);
});

test("channels of other companies never block; only crm:1 channels are offered", () => {
  const rows = [
    { instance: "gravon", canonical_phone: "51900000000", company_key: "crm:1" },
    { instance: "gravon", canonical_phone: "51900000000", company_key: "crm:1" },
    { instance: "cliente", canonical_phone: "5511900000000", company_key: "company:x" },
  ];
  assert.deepEqual(crmChannels(rows, phoneDigits), [{ instance: "gravon", phone: "5551900000000" }]);
});

test("missing tables or functions are recognised as migrations not applied", () => {
  assert.equal(isMissingSchema({ code: "PGRST205", message: "Could not find the table 'public.crm_reference_messages' in the schema cache" }), true);
  assert.equal(isMissingSchema({ code: "PGRST202", message: "Could not find the function public.capture_crm_reference_message" }), true);
  assert.equal(isMissingSchema({ code: "42P01", message: 'relation "crm_agent_settings" does not exist' }), true);
  assert.equal(isMissingSchema({ code: "42501", message: "permission denied" }), false);
  assert.equal(isMissingSchema(null), false);
});
