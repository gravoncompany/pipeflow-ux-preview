import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guessColumns, parseDelimited, rowsFromTable, toCompanyInput, validateRows } from "./b2b-email-list";
import { importInput } from "./b2b-prospecting";

const csv = 'Empresa;E-mail;Telefone;Responsável\n"Clínica Sorriso";contato@sorriso.com.br, vendas@sorriso.com.br;41999990000;Ana\nSem Email;;;\nclinica sorriso;outro@x.com;;\nTeste;email-invalido;;';
describe("b2b email list", () => {
  const t = parseDelimited(csv), g = guessColumns(t), rows = rowsFromTable(t, g.map, g.hasHeader), st = validateRows(rows);
  it("maps columns from header and keeps several e-mails on one company", () => {
    assert.equal(g.map.name, 0); assert.equal(g.map.email, 1); assert.equal(g.map.contactName, 3);
    assert.deepEqual(rows[0].emails, ["contato@sorriso.com.br", "vendas@sorriso.com.br"]);
  });
  it("flags missing e-mail, invalid e-mail and duplicate company name", () => {
    assert.ok(st[rows[0].key].ok);
    assert.ok(st[rows[1].key].issues.includes("Falta o e-mail"));
    assert.equal(st[rows[2].key].duplicateOf, rows[0].key);
    assert.match(st[rows[3].key].issues.join(), /E-mail inválido/);
  });
  it("accepts a list company without CNPJ or Maps id for CRM import", () => {
    assert.ok(importInput.safeParse({ pipelineId: null, confirmed: true, companies: [toCompanyInput(rows[0], "a.csv")] }).success);
  });
  it("still rejects a company with neither CNPJ, Maps id nor e-mail", () => {
    const c = { ...toCompanyInput(rows[0], "a.csv"), emails: [] };
    assert.equal(importInput.safeParse({ pipelineId: null, confirmed: true, companies: [c] }).success, false);
  });
});
