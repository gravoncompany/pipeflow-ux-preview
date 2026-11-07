import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pipelineTotals } from "./pipeline-totals";

const lead = (stage: string, potentialValue: number, closedValue: number | null = null) => ({ stage, potentialValue, closedValue });

describe("pipelineTotals", () => {
  it("Potencial soma só negociações em aberto", () => {
    assert.equal(pipelineTotals([lead("lead-novo", 1000), lead("sql", 500), lead("fechado", 600, 600), lead("perda", 900)]).potential, 1500);
  });
  it("Valor fechado soma só valores confirmados em Fechado", () => {
    const t = pipelineTotals([lead("fechado", 800, 600), lead("fechado", 300), lead("sql", 200, 999)]);
    assert.equal(t.closedValue, 600);
    assert.equal(t.closed, 2);
    assert.equal(t.pendingClosedValue, 1);
  });
  it("respeita o recorte recebido (filtros)", () => {
    const all = [lead("fechado", 600, 600), lead("fechado", 1000, 1200), lead("sql", 400)];
    assert.equal(pipelineTotals(all).closedValue, 1800);
    assert.equal(pipelineTotals(all.slice(0, 1)).closedValue, 600);
    assert.equal(pipelineTotals(all.slice(0, 1)).totalLeads, 1);
  });
});
