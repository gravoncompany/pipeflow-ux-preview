import { test } from "node:test";
import assert from "node:assert/strict";
import { b2bTableStatus, b2bUncheckedTables } from "./b2b-readiness";

test("B2B readiness distinguishes missing schema, denied access and unknown failures", () => {
  assert.equal(b2bTableStatus(null), "ready");
  for (const code of ["42P01", "42703", "PGRST204", "PGRST205"])
    assert.equal(b2bTableStatus({ code }), "missing_schema");
  for (const code of ["42501", "PGRST301", "PGRST302", "PGRST303"])
    assert.equal(b2bTableStatus({ code }), "permission_denied");
  for (const code of ["", "PGRST000", "08006", "XX000"])
    assert.equal(b2bTableStatus({ code }), "unavailable");
  // Even provider prose suggesting a missing table must not turn a network
  // failure into a migration diagnosis or expose that prose to the browser.
  const error = { code: "", message: "secret: missing table", details: "private data" };
  assert.equal(b2bTableStatus(error), "unavailable");
});

test("disabled or unreachable B2B never reports tables as ready", () => {
  assert.equal(b2bUncheckedTables().length, 4);
  assert.ok(b2bUncheckedTables().every((check) => check.status === "not_checked"));
  assert.ok(b2bUncheckedTables("unavailable").every((check) => check.status === "unavailable"));
});
