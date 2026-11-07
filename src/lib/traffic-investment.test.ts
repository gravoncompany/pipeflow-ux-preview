import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { fullMonthKey, mediaCosts, mediaCostLabel } from "./traffic-investment";

const brl = (v: number) => `R$ ${v.toFixed(2)}`;

describe("fullMonthKey", () => {
  it("reconhece um mês completo", () => {
    assert.equal(fullMonthKey("2026-10-01", "2026-10-31"), "2026-10");
    assert.equal(fullMonthKey("2026-02-01", "2026-02-28"), "2026-02");
  });
  it("rejeita períodos parciais ou de vários meses", () => {
    assert.equal(fullMonthKey("2026-09-27", "2026-10-26"), null);
    assert.equal(fullMonthKey("2026-10-01", "2026-10-30"), null);
    assert.equal(fullMonthKey("2026-10-02", "2026-10-31"), null);
    assert.equal(fullMonthKey("2026-10-01", "2026-11-30"), null);
  });
});

describe("mediaCosts", () => {
  it("referência: R$ 3.859 e 6 clientes = R$ 643,17 de mídia por cliente", () => {
    const r = mediaCosts({ investment: 3859, leads: 10, qualified: 8, meetings: 7, clients: 6 });
    assert.deepEqual(r.perClient, { status: "ok", value: 3859 / 6 });
    assert.equal(mediaCostLabel(r.perClient, brl), "R$ 643.17");
  });

  it("denominador zero mostra 'Sem conversões para calcular'", () => {
    const r = mediaCosts({ investment: 3859, leads: 0, qualified: 0, meetings: 0, clients: 0 });
    for (const c of Object.values(r)) {
      assert.equal(c.status, "no-conversions");
      assert.equal(mediaCostLabel(c, brl), "Sem conversões para calcular");
    }
  });

  it("investimento não informado difere de investimento zero", () => {
    const nullR = mediaCosts({ investment: null, leads: 5, qualified: 2, meetings: 1, clients: 1 });
    assert.equal(nullR.perLead.status, "not-informed");
    assert.equal(mediaCostLabel(nullR.perLead, brl), "Investimento não informado");
    const zeroR = mediaCosts({ investment: 0, leads: 5, qualified: 2, meetings: 1, clients: 1 });
    assert.deepEqual(zeroR.perLead, { status: "ok", value: 0 });
    assert.equal(mediaCostLabel(zeroR.perLead, brl), "R$ 0.00");
  });

  it("calcula custo por lead, qualificado e reunião", () => {
    const r = mediaCosts({ investment: 1000, leads: 20, qualified: 10, meetings: 4, clients: 2 });
    assert.equal(r.perLead.value, 50);
    assert.equal(r.perQualified.value, 100);
    assert.equal(r.perMeeting.value, 250);
    assert.equal(r.perClient.value, 500);
  });
});
