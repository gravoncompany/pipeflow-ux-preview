import { test } from "node:test";
import assert from "node:assert/strict";
import { collectEmails, gmailList, collectPhones, toCsv, selectMany, selectedExistingIds, unselectMany, toggleOne, chunk, bulkSummaryText } from "./bulk-actions";

test("e-mails: só válidos, sem vazios e sem duplicados (maiúsculas iguais), formato do Gmail", () => {
  const r = collectEmails(["Contato@Empresa.com.br", "", null, "invalido", ["contato@empresa.com.br", "vendas@empresa.com.br; financeiro@empresa.com.br"], undefined, "x@y"]);
  assert.deepEqual(r.emails, ["contato@empresa.com.br", "vendas@empresa.com.br", "financeiro@empresa.com.br"]);
  assert.equal(r.duplicates, 1); assert.equal(r.invalid, 2);
  assert.equal(gmailList(r.emails), "contato@empresa.com.br, vendas@empresa.com.br, financeiro@empresa.com.br");
  // 60 selecionadas, 48 com e-mail válido → copia apenas 48.
  const sixty = Array.from({ length: 60 }, (_, i) => (i < 48 ? `c${i}@ex.com` : ""));
  assert.equal(collectEmails(sixty).emails.length, 48);
  assert.deepEqual(collectEmails([]).emails, []);
});
test("telefones: normalizados, sem duplicados (com e sem 55), descarta inválidos", () => {
  assert.deepEqual(collectPhones(["(41) 99999-0000", "5541999990000", "4199999000", "123", "00000000000", null]), ["41999990000", "4199999000"]);
});
test("CSV: BOM, separador ';', aspas e proteção contra fórmulas", () => {
  const csv = toCsv(["A", "B"], [["=HYPERLINK(1)", 'x;"y"'], [null, 5]]);
  assert.ok(csv.startsWith("﻿A;B\r\n"));
  assert.ok(csv.includes(`'=HYPERLINK(1);"x;""y"""`));
  assert.ok(csv.endsWith("\r\n;5"));
});
test("seleção: selecionar todos/filtrados sem duplicar, desmarcar, alternar; lotes", () => {
  let sel = selectMany([], ["a", "b"]); sel = selectMany(sel, ["b", "c"]);
  assert.deepEqual(sel, ["a", "b", "c"]);
  assert.deepEqual(unselectMany(sel, ["b"]), ["a", "c"]);
  assert.deepEqual(toggleOne(["a"], "a", true), ["a"]); assert.deepEqual(toggleOne(["a"], "a", false), []);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
test("resumo no formato pedido", () => {
  assert.equal(bulkSummaryText({ selected: 50, done: 45, existing: 3, failed: 2, reasons: ["nome da empresa ausente", "nome da empresa ausente"] }),
    "50 empresa(s) selecionada(s). 45 cadastradas. 3 já existente(s). 2 não cadastradas (nome da empresa ausente).");
});
test("exclusão em massa inclui só cards selecionados do funil aberto, sem duplicar", () => {
  assert.deepEqual(selectedExistingIds(["coluna-a-1", "coluna-a-2", "coluna-a-1", "outro-funil"], ["coluna-a-1", "coluna-a-2", "coluna-b-1"]), ["coluna-a-1", "coluna-a-2"]);
  assert.deepEqual(selectedExistingIds([], ["coluna-a-1"]), []);
});
