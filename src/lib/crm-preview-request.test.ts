import test from "node:test";
import assert from "node:assert/strict";
import { previewTokenFor, rememberPreviewToken } from "./crm-preview-request.server";

test("preview payload token is bound only to the request that carried it", () => {
  const a = new Request("http://localhost/_serverFn/x");
  const b = new Request("http://localhost/_serverFn/x");
  rememberPreviewToken(a, "full:123:sig");
  assert.equal(previewTokenFor(a), "full:123:sig");
  assert.equal(previewTokenFor(b), undefined);
});

test("preview payload token ignores non-string or oversized values", () => {
  const r = new Request("http://localhost/");
  rememberPreviewToken(r, { forged: true });
  rememberPreviewToken(r, "x".repeat(600));
  assert.equal(previewTokenFor(r), undefined);
});
