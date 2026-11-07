import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
const close = (a: number | null, b: number, d = 2) => assert.ok(a != null && Math.abs(a - b) < 10 ** -d / 2, `${a} ≈ ${b}`);
import { contractResult, duplicateGoal, goalData, initialScenario, projections, realizedServiceTotal, resolveFunnel, funnelRates, emptyGoal } from "./commercial-goals";

describe("metas comerciais", () => {
  const p = projections(initialScenario().goals);
  it("cenário inicial: 57,14 leads qualificados sem arredondar", () => close(p.qualified, 57.142857, 5));
  it("conversão necessária 5,25%", () => close(p.conversion! * 100, 5.25, 2));
  it("valor vendido R$14.400", () => assert.equal(p.contractsTotal, 14400));
  it("equivalente mensal R$1.600", () => assert.equal(p.monthlyPerClient, 1600));
  it("mídia por venda R$1.333,33", () => close(p.mediaPerSale, 1333.33, 2));
  it("atendimento: 3 clientes × R$500 = R$1.500 no contrato, sem multiplicar pelos 3 meses", () => { assert.equal(p.serviceTotal, 1500); assert.equal(p.serviceMonthly, 500); });
  it("saldo projetado R$8.000 com R$13.500 contratados, R$4.000 de anúncios e R$1.500 de atendimento", () => {
    const g = initialScenario().goals; g.contract = 4500;
    const q = projections(g);
    assert.equal(q.contractsTotal, 13500); assert.equal(q.serviceTotal, 1500);
    const r = contractResult({ contracts: q.contractsTotal, media: g.budget, extraCommercial: null, serviceTotal: q.serviceTotal, taxes: null, fees: null, clients: 3 });
    assert.equal(r.balance, 8000); assert.equal(r.missing.length, 3); assert.equal(r.cacPartial, true);
  });
  it("atendimento realizado conta uma vez por cliente fechado", () => assert.equal(realizedServiceTotal(3, 500), 1500));
  it("divisão por zero é não calculável", () => assert.equal(projections({ ...initialScenario().goals, cplQ: 0 }).qualified, null));
  it("rejeita negativos e duração inválida", () => {
    const g = initialScenario(); g.goals.budget = -1; assert.equal(goalData.safeParse(g).success, false);
    const h = initialScenario(); h.goals.duration = 0; assert.equal(goalData.safeParse(h).success, false);
  });
  it("duplicar não copia realizados", () => {
    const g = initialScenario(); g.actual.adSpend = 3900; g.funnel.manual.meetings = 4; g.cash.received = 1000;
    const d = duplicateGoal(g);
    assert.equal(d.actual.adSpend, null); assert.equal(d.funnel.manual.meetings, null); assert.equal(d.cash.received, null); assert.equal(d.goals.budget, 4000);
  });
  it("cenário inicial deixa realizados não informados", () => assert.equal(initialScenario().actual.taxes, null));
  it("não soma CRM e manual no mesmo indicador", () => {
    const g = emptyGoal(); g.funnel.manual.leads = 10;
    assert.equal(resolveFunnel(g, { leads: 7 }).value.leads, 7);
    g.funnel.source.leads = "manual";
    assert.equal(resolveFunnel(g, { leads: 7 }).value.leads, 10);
  });
  it("conversão de qualificados usa base de qualificados", () => {
    const r = funnelRates({ leads: 100, qualified: 50, meetings: null, proposals: null, clients: 5 }, 4000);
    assert.equal(r.qualifiedToSale, 0.1); assert.equal(r.proposalToSale, null); assert.equal(r.cpl, 40);
  });
});
