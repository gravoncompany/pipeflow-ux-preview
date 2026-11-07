import { test } from "node:test";
import assert from "node:assert/strict";
import { canLookupB2b, lookupInput } from "./b2b-prospecting";

const ready = {
  keyType: "cnpj" as const,
  key: "50.621.449/0001-45",
  confirmed: true,
  deskReady: true,
  databaseReady: true,
  busy: false,
};

test("valid manual CNPJ permits direct lookup without any company-name search", () => {
  assert.equal(canLookupB2b(ready), true);
  assert.equal(canLookupB2b({ ...ready, key: "50621449000145" }), true);
  assert.equal(
    lookupInput.parse({ keyType: "cnpj", key: ready.key, confirmed: true }).keyType,
    "cnpj",
  );
});
test("invalid CNPJ never enables lookup", () => {
  for (const key of ["", "123", "00000000000000", "50621449000144", "50621449000145<script>"])
    assert.equal(canLookupB2b({ ...ready, key }), false);
});
test("paid lookup still requires explicit confirmation", () => {
  assert.equal(canLookupB2b({ ...ready, confirmed: false }), false);
});
test("unavailable DeskData or database and running actions block lookup", () => {
  assert.equal(canLookupB2b({ ...ready, deskReady: false }), false);
  assert.equal(canLookupB2b({ ...ready, databaseReady: false }), false);
  assert.equal(canLookupB2b({ ...ready, busy: true }), false);
});
test("name lookup remains independently validated", () => {
  assert.equal(canLookupB2b({ ...ready, keyType: "name", key: "Empresa teste" }), true);
  assert.equal(canLookupB2b({ ...ready, keyType: "name", key: " " }), false);
});
