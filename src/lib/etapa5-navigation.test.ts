import { describe, test as it } from "node:test";
import assert from "node:assert/strict";
import { financeSection, FINANCE_SECTIONS } from "../components/crm/finance-nav";
import { improvementStatuses, nextStepLabel } from "./pipeflow-improvements";
import { bankCoverage } from "./bank-overview";

describe("Financeiro: telas do submenu", () => {
  it("abre em Visão geral e inclui Controle de Recebimentos", () => {
    assert.equal(financeSection("/financeiro"), "overview");
    assert.deepEqual(FINANCE_SECTIONS.map((s) => s.key), ["overview", "movimentacoes", "recebimentos", "custos", "planejamento", "analise", "pessoal"]);
  });
  it("cada link direto abre a própria tela", () => {
    assert.equal(financeSection("/financeiro/movimentacoes"), "movimentacoes");
    assert.equal(financeSection("/financeiro/recebimentos"), "recebimentos");
    assert.equal(financeSection("/financeiro/custos/"), "custos");
    assert.equal(financeSection("/financeiro/planejamento"), "planejamento");
    assert.equal(financeSection("/financeiro/analise"), "analise");
    assert.equal(financeSection("/financeiro/pessoal"), "pessoal");
  });
  it("Finanças Pessoais tem visão geral, despesas e reserva próprias", () => {
    assert.deepEqual(FINANCE_SECTIONS.find((s) => s.key === "pessoal")!.tabs.map(([v]) => v), ["overview", "expenses", "reserves"]);
  });
  it("Movimentações começa pelo extrato do banco", () => {
    assert.equal(FINANCE_SECTIONS.find((s) => s.key === "movimentacoes")!.tabs[0][0], "bank");
  });
});

describe("Melhorias do Pipeflow", () => {
  it("Pendentes, Em andamento e Concluídas separam os status existentes", () => {
    assert.deepEqual(improvementStatuses("pendentes"), ["planejado", "bloqueado", "em_desenvolvimento", "em_teste"]);
    assert.deepEqual(improvementStatuses("andamento"), ["em_desenvolvimento", "em_teste"]);
    assert.deepEqual(improvementStatuses("concluidas"), ["concluido"]);
  });
  it("próximo passo vazio aparece como A definir", () => {
    assert.equal(nextStepLabel(""), "A definir");
    assert.equal(nextStepLabel("   "), "A definir");
    assert.equal(nextStepLabel("Testar no celular"), "Testar no celular");
  });
});

describe("Cobertura do banco no período", () => {
  it("período inteiro coberto quando há dados antes do início e sincronização no último dia", () => {
    const c = bankCoverage("2026-10-06", "2026-11-04", "2025-11-02T21:12:15Z", "2026-11-04T12:24:10Z");
    assert.equal(c.partial, false);
  });
  it("sinaliza cobertura parcial quando a sincronização parou antes do fim", () => {
    const c = bankCoverage("2026-10-06", "2026-11-04", "2025-11-02T21:12:15Z", "2026-11-02T12:00:00Z");
    assert.equal(c.partial, true);
    assert.equal(c.availableTo, "2026-11-02");
  });
  it("sinaliza cobertura parcial quando os dados começam depois do início", () => {
    const c = bankCoverage("2026-10-06", "2026-11-04", "2026-10-20T15:00:00Z", "2026-11-04T12:00:00Z");
    assert.equal(c.partial, true);
    assert.equal(c.availableFrom, "2026-10-20");
  });
});
