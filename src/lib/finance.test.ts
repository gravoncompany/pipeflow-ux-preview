import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { FINANCE_MONTH_RANGE, FINANCE_REVENUE_RANGE, mapFinanceMonths } from "./finance";

const labels = ["Janeiro", "Fevereiro ", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto ", "Setembro", "Outubro", "Novembro", "Dezembro"];
describe("Receita da planilha", () => {
  it("lê meses D1:O1 e receita D52:O52 conforme confirmado", () => {
    assert.equal(FINANCE_MONTH_RANGE, "'2026'!D1:O1");
    assert.equal(FINANCE_REVENUE_RANGE, "'2026'!D52:O52");
    const result = mapFinanceMonths(labels, [18334, 19045, 20787, 20292, 19935, 20349, 16149, 17871, 18174, 7520]);
    assert.equal(result[0].month, "Janeiro");
    assert.equal(result[0].cell, "D52");
    assert.equal(result[0].value, 18334);
    assert.equal(result[9].cell, "M52");
    assert.equal(result[9].value, 7520);
    assert.equal(result.reduce((sum, m) => sum + (m.value ?? 0), 0), 178456);
  });
  it("não transforma erro da planilha em zero", () => {
    const result = mapFinanceMonths(labels, [...Array(10).fill(1), "#REF!"]);
    assert.equal(result[10].cell, "N52");
    assert.equal(result[10].status, "error");
    assert.equal(result[10].value, null);
  });
  it("preserva mês vazio sem confundir com receita zero", () => {
    const result = mapFinanceMonths(labels, [0]);
    assert.equal(result[0].status, "value");
    assert.equal(result[0].value, 0);
    assert.equal(result[11].cell, "O52");
    assert.equal(result[11].status, "empty");
    assert.equal(result[11].value, null);
  });
});