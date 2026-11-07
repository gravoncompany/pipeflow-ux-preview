import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWhatsAppTarget as n } from "./phone";
test("adiciona 55 sem duplicar", () => {
  for (const v of ["(47) 99999-8888", "47999998888", "+55 47 99999-8888", "5547999998888"]) assert.equal(n(v).value, "5547999998888");
});
test("grupos e @lid preservados", () => {
  assert.deepEqual(n("120363012345678901@g.us"), { kind: "group", value: "120363012345678901@g.us", reason: "" });
  assert.equal(n("17489593376979@lid").kind, "lid");
});
test("internacional preservado e DDD validado", () => {
  assert.equal(n("+1 415 555 2671").value, "14155552671");
  assert.equal(n("(20) 99999-8888").kind, "invalid");
  assert.equal(n("4799998888").value, "554799998888");
});
