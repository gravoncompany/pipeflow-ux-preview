import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitEconomics } from './dashboard-unit-economics';
import type { OverviewRow } from './bank-overview';

let n = 0;
const row = (kind: string, category: string | null, cents: number, direction: 'CREDITO' | 'DEBITO', day = '2026-10-10', status = 'confirmado'): OverviewRow => ({
  transactionId: String(++n), transactionAt: `${day}T15:00:00Z`, amountCents: cents, currency: 'BRL', direction, description: '', counterparty: '',
  cls: { kind, category } as never, status: status as never, reconciled: false,
});
const sale = (k: string, d = '2026-10-15') => ({ customerKey: k, saleType: 'novo', firstAcquisition: true, closedOn: d });
const base = (o: Partial<Parameters<typeof unitEconomics>[0]> = {}) => unitEconomics({
  rows: [row('receita_operacional', null, 1_000_000, 'CREDITO'), row('despesa_operacional', 'fornecedores', 200_000, 'DEBITO'), row('despesa_operacional', 'impostos', 100_000, 'DEBITO'), row('despesa_operacional', 'publicidade_marketing', 200_000, 'DEBITO'), row('transferencia_interna', null, 900_000, 'CREDITO')],
  receipts: [], sales: [sale('a'), sale('b')], pendingSales: () => 0, from: '2026-10-01', to: '2026-10-31', arpa: 2000, churnPct: 10, ...o,
});

test('margem de contribuição = (receita − custos variáveis) ÷ receita; transferências não são receita', () => {
  assert.equal(base().metrics.margin.value, 70);
});
test('retorno sobre gastos operacionais = (10000 − 5000) ÷ 5000 = 100%; margem operacional 50%', () => {
  assert.equal(base().metrics.opReturn.value, 100);
  assert.equal(base().metrics.opMargin.value, 50);
});
test('outubro/2026 de referência: R$17.316 e R$6.353 dão ~172,6% e ~63,3%', () => {
  const u = base({ rows: [row('receita_operacional', null, 1_731_600, 'CREDITO'), row('despesa_operacional', 'publicidade_marketing', 300_000, 'DEBITO'), row('despesa_operacional', 'outras_despesas', 335_300, 'DEBITO')] });
  assert.equal(Math.round(u.metrics.opReturn.value! * 10) / 10, 172.6);
  assert.equal(Math.round(u.metrics.opMargin.value! * 10) / 10, 63.3);
});
test('ROI de Marketing sem receita atribuível fica indisponível', () => {
  assert.equal(base().metrics.roi.value, null);
});
test('CAC = marketing ÷ clientes novos', () => {
  assert.equal(base().metrics.cac.value, 1000);
});
test('LTV = ticket × permanência (1 ÷ churn mensal) e ajustado pela margem; LTV/CAC', () => {
  const u = base();
  assert.ok(Math.abs((u.metrics.ltvRevenue.value ?? 0) - 2000 / (0.1 / (31 / (365.2425 / 12)))) < 0.01);
  assert.ok(Math.abs((u.metrics.ltv.value ?? 0) - (u.metrics.ltvRevenue.value ?? 0) * 0.7) < 0.01);
  assert.ok(Math.abs((u.metrics.ltvCac.value ?? 0) - (u.metrics.ltv.value ?? 0) / 1000) < 0.0001);
});
test('sem cancelamentos o LTV fica como Dados insuficientes', () => {
  const u = base({ churnPct: 0 });
  assert.equal(u.metrics.ltv.value, null);
  assert.match(u.metrics.ltv.note ?? '', /permanência/);
});
test('vendas sem classificação bloqueiam o CAC', () => {
  assert.equal(base({ pendingSales: () => 2 }).metrics.cac.value, null);
});
test('despesas pendentes de revisão não entram nos cálculos', () => {
  const u = base({ rows: [row('receita_operacional', null, 1_000_000, 'CREDITO'), row('despesa_operacional', 'publicidade_marketing', 200_000, 'DEBITO', '2026-10-10', 'pendente')] });
  assert.equal(u.metrics.roi.value, null);
  assert.equal(u.metrics.margin.value, 100);
});
