import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImportRows, parseCsvText, parseFrequency, parseMoneyBR, parseDateBR } from "./receipt-import";

test("CSV com ponto e vírgula, aspas e valores em reais", () => {
 const matrix = parseCsvText('Cliente;Valor semanal;Frequência;Vencimento\n"Cliente A; Filial";R$ 350,00;semanal;10\nCliente B;1400.50;mensal;5');
 assert.equal(matrix.length, 3);
 assert.equal(matrix[1][0], "Cliente A; Filial");
 const { rows } = buildImportRows(matrix, 2026);
 assert.equal(rows.length, 2);
 assert.equal(rows[0].valor, 35000);
 assert.equal(rows[0].frequencia, "semanal");
 assert.equal(rows[1].valor, 140050);
 assert.equal(rows[1].frequencia, "mensal");
});

test("valores brasileiros e inválidos", () => {
 assert.equal(parseMoneyBR("R$ 1.400,50"), 140050);
 assert.equal(parseMoneyBR("350"), 35000);
 assert.equal(parseMoneyBR(""), 0);
 assert.equal(parseMoneyBR("abc"), 0);
 assert.equal(parseMoneyBR("-50"), 0);
});

test("frequência e datas reconhecidas sem inventar", () => {
 assert.equal(parseFrequency("Quinzenal"), "quinzenal");
 assert.equal(parseFrequency("mensalidade"), "mensal");
 assert.equal(parseFrequency("anual"), "");
 assert.equal(parseDateBR("05/01/2026"), "2026-01-05");
 assert.equal(parseDateBR("2026-01-05"), "2026-01-05");
 assert.equal(parseDateBR("janeiro"), "");
});

test("duas datas de vencimento implicam quinzenal; linhas incompletas são sinalizadas", () => {
 const { rows } = buildImportRows([["Cliente", "Valor", "Vencimento"], ["Cliente C", "R$ 800", "10 e 25"], ["", "R$ 100", ""]], 2026);
 assert.equal(rows[0].frequencia, "quinzenal");
 assert.equal(rows[0].dia, 10);
 assert.equal(rows[0].dia2, 25);
 assert.deepEqual(rows[0].problemas, []);
 assert.ok(rows[1].problemas.includes("Cliente não identificado"));
 assert.ok(rows[1].problemas.includes("Frequência não reconhecida"));
});
