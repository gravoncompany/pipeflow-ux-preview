import { test } from "node:test";
import assert from "node:assert/strict";
import { bankRevenue, overviewTotals, yearEvolution, yearlyRevenueStats, categoryBreakdown, type OverviewRow } from "./bank-overview";
import { sanitizeAiItem } from "./ai/bank-classification-ai.server";

const row = (p: Partial<OverviewRow> & { kind: OverviewRow["cls"]["kind"] }): OverviewRow => ({
  transactionId: p.transactionId ?? Math.random().toString(36), transactionAt: p.transactionAt ?? "2026-10-10T15:00:00Z", amountCents: p.amountCents ?? 10000,
  currency: "BRL", direction: p.direction ?? "DEBITO", description: null, counterparty: null,
  cls: { kind: p.kind, category: p.cls?.category ?? null, vendor: null, source: "manual" }, status: p.status ?? "confirmado", reconciled: p.reconciled ?? false,
});

test("valor e data próximos não eliminam pagamentos diferentes sem vínculo persistente", () => {
  const rows = [row({ kind: "receita_operacional", direction: "CREDITO", amountCents: 150000, transactionAt: "2026-10-05T15:00:00Z" }),
    row({ kind: "receita_operacional", direction: "CREDITO", amountCents: 80000 }),
    row({ kind: "receita_operacional", direction: "CREDITO", amountCents: 99900, status: "pendente" })];
  const t = overviewTotals(rows, [{ amountCents: 150000, date: "2026-10-07" }]);
  assert.equal(t.revenueCents, 150000 + 150000 + 80000);
  assert.equal(t.possibleDuplicates, 1);
  assert.equal(bankRevenue(rows, []).counted.length, 2);
});

test("entradas bancárias não são faturamento; reconciliadas já estão no Financeiro", () => {
  const rows = [row({ kind: "resgate", direction: "CREDITO", amountCents: 500000 }), row({ kind: "receita_operacional", direction: "CREDITO", amountCents: 20000, reconciled: true })];
  const t = overviewTotals(rows, [{ amountCents: 20000, date: "2026-10-10" }]);
  assert.equal(t.bankInCents, 520000);
  assert.equal(t.revenueCents, 20000);
});

test("despesas pessoais ficam fora do resultado operacional; pendentes não entram", () => {
  const rows = [row({ kind: "despesa_operacional", amountCents: 30000, cls: { kind: "despesa_operacional", category: "publicidade_marketing", vendor: null, source: "manual" } }),
    row({ kind: "despesa_pessoal", amountCents: 4500, cls: { kind: "despesa_pessoal", category: "alimentacao", vendor: null, source: "manual" } }),
    row({ kind: "despesa_operacional", amountCents: 99999, status: "pendente" })];
  const t = overviewTotals(rows, [{ amountCents: 100000, date: "2026-10-01" }]);
  assert.equal(t.opExpenseCents, 30000);
  assert.equal(t.personalCents, 4500);
  assert.equal(t.opResultCents, 70000);
  assert.equal(t.pendingCount, 1);
  assert.equal(t.resultProvisional, true);
  assert.equal(categoryBreakdown(rows, "despesa_pessoal")[0]!.label, "Alimentação");
});

test("meses sem movimentação ficam sem dados, nunca zero", () => {
  const ev = yearEvolution([row({ kind: "despesa_operacional", transactionAt: "2026-03-10T15:00:00Z" })], [], 2026, "2026-11-03T12:00:00Z");
  assert.equal(ev[0]!.opExpenseCents, null);
  assert.equal(ev[2]!.opExpenseCents, 10000);
  assert.equal(ev[11]!.empty, true);
  assert.equal(ev[10]!.incomplete, true);
});

test("indicadores anuais: acumulado, melhor mês e média dos meses transcorridos", () => {
  const rows = [
    row({ kind: "receita_operacional", direction: "CREDITO", amountCents: 100000, transactionAt: "2026-01-10T15:00:00Z" }),
    row({ kind: "receita_operacional", direction: "CREDITO", amountCents: 300000, transactionAt: "2026-03-10T15:00:00Z" }),
    row({ kind: "receita_operacional", direction: "CREDITO", amountCents: 200000, transactionAt: "2026-03-20T15:00:00Z" }),
  ];
  const ev = yearEvolution(rows, [], 2026, "2026-11-03T12:00:00Z");
  const s = yearlyRevenueStats(ev, 2026, "2026-11-03T12:00:00Z");
  assert.equal(s.accumulated, 600000);
  assert.deepEqual(s.best, { month: "2026-03", amount: 500000 });
  assert.equal(s.elapsedMonths, 11);
  assert.equal(s.average, Math.round(600000 / 11));
});

test("média anual: ano passado divide por 12; ano futuro não tem média", () => {
  const rows = [row({ kind: "receita_operacional", direction: "CREDITO", amountCents: 120000, transactionAt: "2025-06-10T15:00:00Z" })];
  const past = yearlyRevenueStats(yearEvolution(rows, [], 2025, "2026-11-03T12:00:00Z"), 2025, "2026-11-03T12:00:00Z");
  assert.equal(past.elapsedMonths, 12);
  assert.equal(past.average, 10000);
  const future = yearlyRevenueStats(yearEvolution([], [], 2027, "2026-11-03T12:00:00Z"), 2027, "2026-11-03T12:00:00Z");
  assert.equal(future.elapsedMonths, 0);
  assert.equal(future.average, null);
  assert.equal(future.best, null);
});

test("evolução anual exclui RDB, transferências internas e despesas pessoais do faturamento", () => {
  const rows = [
    row({ kind: "resgate", direction: "CREDITO", amountCents: 900000, transactionAt: "2026-05-10T15:00:00Z" }),
    row({ kind: "transferencia_interna", direction: "CREDITO", amountCents: 400000, transactionAt: "2026-05-11T15:00:00Z" }),
    row({ kind: "despesa_pessoal", direction: "DEBITO", amountCents: 50000, transactionAt: "2026-05-12T15:00:00Z" }),
    row({ kind: "receita_operacional", direction: "CREDITO", amountCents: 80000, transactionAt: "2026-05-15T15:00:00Z" }),
  ];
  const ev = yearEvolution(rows, [], 2026, "2026-11-03T12:00:00Z");
  assert.equal(ev[4]!.revenueCents, 80000);
  assert.equal(ev[4]!.opExpenseCents, 0);
  assert.equal(ev[4]!.personalCents, 50000);
});

test("sugestão da IA incompatível vira não classificado e itens ambíguos não têm confiança alta", () => {
  const base = { ref: "0", amountCents: 1, day: null, description: null, counterparty: null, type: null, hint: null };
  assert.equal(sanitizeAiItem({ ...base, direction: "DEBITO" }, { kind: "receita_operacional", category: null, confidence: "alta", reason: "x" }).kind, "nao_classificado");
  assert.equal(sanitizeAiItem({ ...base, direction: "DEBITO" }, { kind: "despesa_pessoal", category: "publicidade_marketing", confidence: "alta", reason: "x" }).kind, "nao_classificado");
  assert.equal(sanitizeAiItem({ ...base, direction: "DEBITO", hint: "Energia" }, { kind: "despesa_operacional", category: "despesas_administrativas", confidence: "alta", reason: "x" }).confidence, "media");
});
