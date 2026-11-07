// Indicadores estratégicos (ROI, CAC, LTV, LTV/CAC, margem de contribuição). Lógica pura e testável.
// Fontes: receita confirmada pela mesma regra do Financeiro (recebimentos + entradas bancárias confirmadas, uma vez só;
// transferências, aplicações, empréstimos e repasses nunca são receita), despesas bancárias confirmadas por categoria,
// clientes novos das classificações de venda e MRR/churn dos acordos registrados. Nada é estimado como resultado real.
import { overviewTotals, categoryBreakdown, spDay, type OverviewRow, type SourceReceipt } from './bank-overview';
import type { CostCategory } from './bank-classification';
import { ok, unavailable, type Metric } from './dashboard';

/** Investimento em aquisição: marketing/tráfego pago próprio da Gravon pago pela conta bancária. */
export const ACQUISITION_CATEGORIES: readonly CostCategory[] = ['publicidade_marketing'];
/** Custos variáveis diretos dos serviços: terceiros/fornecedores contratados e impostos sobre faturamento. */
export const VARIABLE_CATEGORIES: readonly CostCategory[] = ['fornecedores', 'impostos'];

export type SaleRow = { customerKey: string; saleType: string; firstAcquisition: boolean; closedOn: string };
export type UnitInputs = {
  rows: OverviewRow[]; receipts: SourceReceipt[]; sales: SaleRow[]; pendingSales: (from: string, to: string) => number;
  from: string; to: string;
  /** Receita média mensal recorrente por cliente (ticket médio contratado) e churn do período em %. */
  arpa: number | null; churnPct: number | null;
};

const confirmed = (r: OverviewRow) => r.status !== 'pendente' && r.amountCents !== null && r.direction !== null && r.currency === 'BRL';
const expense = (r: OverviewRow) => Math.abs(r.amountCents as number) * (r.direction === 'DEBITO' ? 1 : -1); // estornos reduzem
const inDay = (r: OverviewRow, from: string, to: string) => { if (!r.transactionAt) return false; const d = spDay(r.transactionAt); return d >= from && d <= to; };
function sumCategory(rows: OverviewRow[], cats: readonly CostCategory[], from: string, to: string) {
  return rows.filter(r => confirmed(r) && r.cls.kind === 'despesa_operacional' && r.cls.category !== null && cats.includes(r.cls.category) && inDay(r, from, to)).reduce((n, r) => n + expense(r), 0) / 100;
}
export function newCustomers(sales: SaleRow[], from: string, to: string) {
  return new Set(sales.filter(s => s.saleType === 'novo' && s.firstAcquisition && s.closedOn >= from && s.closedOn <= to).map(s => s.customerKey)).size;
}
const monthsBetween = (from: string, to: string) => (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`) + 86400000) / (365.2425 / 12 * 86400000);

function core(i: UnitInputs, from: string, to: string) {
  const inRows = i.rows.filter(r => inDay(r, from, to));
  const receipts = i.receipts.filter(r => r.date >= from && r.date <= to);
  const totals = overviewTotals(inRows, receipts);
  const revenue = totals.revenueCents / 100;
  const variable = sumCategory(i.rows, VARIABLE_CATEGORIES, from, to);
  const acquisition = sumCategory(i.rows, ACQUISITION_CATEGORIES, from, to);
  const pending = i.pendingSales(from, to);
  const customers = pending > 0 ? null : newCustomers(i.sales, from, to);
  const margin = revenue > 0 ? (revenue - variable) / revenue * 100 : null;
  const contribution = revenue - variable; // retorno líquido antes do investimento avaliado
  // ROI de Marketing exige receita atribuída aos investimentos; o Financeiro ainda não vincula receitas a campanhas.
  const roi: number | null = null; void contribution;
  // Mesma soma do Financeiro: todas as despesas operacionais confirmadas (marketing incluído), uma vez só; estornos reduzem.
  const opExpense = totals.opExpenseCents / 100;
  const opResult = revenue - opExpense;
  const opReturn = opExpense > 0 ? opResult / opExpense * 100 : null;
  const opMargin = revenue > 0 ? opResult / revenue * 100 : null;
  const breakdown = categoryBreakdown(inRows, 'despesa_operacional').map(b => ({ label: b.label, value: b.cents / 100, count: b.count })).sort((a, b) => b.value - a.value);
  const revenueParts = { finance: totals.revenueFromFinanceCents / 100, bank: totals.revenueFromBankCents / 100 };
  const cac = acquisition > 0 && customers ? acquisition / customers : null;
  return { revenue, variable, acquisition, customers, pending, margin, roi, cac, opExpense, opResult, opReturn, opMargin, breakdown, revenueParts, provisional: totals.resultProvisional };
}

export function unitEconomics(i: UnitInputs) {
  const c = core(i, i.from, i.to);
  const months = monthsBetween(i.from, i.to);
  const monthlyChurn = i.churnPct !== null && months > 0 ? i.churnPct / 100 / Math.max(months, 1) : null;
  const tenure = monthlyChurn && monthlyChurn > 0 ? 1 / monthlyChurn : null;
  const ltvRevenue = i.arpa !== null && i.arpa > 0 && tenure !== null ? i.arpa * tenure : null;
  const ltvAdjusted = ltvRevenue !== null && c.margin !== null ? ltvRevenue * c.margin / 100 : null;
  const prov = c.provisional ? ' Há movimentações bancárias pendentes de revisão: valor provisório.' : '';
  const missingRevenue = 'Dados insuficientes: falta receita confirmada no período (Financeiro ou banco).';
  const missingInvest = 'Dados insuficientes: nenhuma despesa confirmada como "Marketing e tráfego pago" no período.';
  const missingCustomers = c.pending ? `Dados insuficientes: classifique ${c.pending} venda(s) fechada(s) como cliente novo ou não.` : 'Dados insuficientes: nenhum cliente novo confirmado no período.';
  const missingLtv = i.arpa === null ? 'Dados insuficientes: falta receita recorrente registrada nos acordos dos clientes.'
    : tenure === null ? 'Dados insuficientes: sem cancelamentos registrados não há como medir o tempo médio de permanência.' : missingRevenue;
  const missingCosts = 'Dados insuficientes: nenhuma despesa operacional confirmada no período.';
  const metrics: Record<'opReturn' | 'opMargin' | 'roi' | 'cac' | 'ltv' | 'ltvRevenue' | 'ltvCac' | 'margin', Metric> = {
    opReturn: c.opReturn !== null && c.revenue > 0 ? ok(c.opReturn, `(Faturamento − custos e despesas totais) ÷ custos e despesas totais.${prov}`) : unavailable(c.revenue > 0 ? missingCosts : missingRevenue),
    opMargin: c.opMargin !== null ? ok(c.opMargin, `Resultado operacional ÷ faturamento.${prov}`) : unavailable(missingRevenue),
    roi: unavailable(c.acquisition > 0 ? 'Métrica de aquisição. Dados insuficientes: o Financeiro ainda não vincula receitas às campanhas, então não há receita atribuível ao investimento.' : missingInvest),
    cac: c.cac !== null ? ok(c.cac, `Marketing e tráfego pago (${c.acquisition.toFixed(2)}) ÷ ${c.customers} cliente(s) novo(s).${prov}`) : unavailable(c.acquisition > 0 ? missingCustomers : missingInvest),
    ltvRevenue: ltvRevenue !== null ? ok(ltvRevenue, `Ticket médio recorrente × permanência média estimada pelo churn (${tenure!.toFixed(1)} meses).`) : unavailable(missingLtv),
    ltv: ltvAdjusted !== null ? ok(ltvAdjusted, 'LTV de receita × margem de contribuição média do período.') : unavailable(ltvRevenue === null ? missingLtv : missingRevenue),
    ltvCac: ltvAdjusted !== null && c.cac !== null ? ok(ltvAdjusted / c.cac, 'LTV ajustado pela margem ÷ CAC.') : unavailable(ltvAdjusted === null ? missingLtv : (c.acquisition > 0 ? missingCustomers : missingInvest)),
    margin: c.margin !== null ? ok(c.margin, `(Receita − fornecedores/terceiros e impostos) ÷ receita.${prov}`) : unavailable(missingRevenue),
  };
  const series: { month: string; opReturn: number | null; roi: number | null; cac: number | null; margin: number | null; ltvCac: number | null }[] = [];
  for (let m = i.from.slice(0, 7); m <= i.to.slice(0, 7);) {
    const next = new Date(`${m}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    const last = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    const a = `${m}-01` < i.from ? i.from : `${m}-01`, b = last > i.to ? i.to : last;
    const x = core(i, a, b);
    series.push({ month: m, opReturn: x.opReturn, roi: x.roi, cac: x.cac, margin: x.margin, ltvCac: ltvAdjusted !== null && x.cac ? ltvAdjusted / x.cac : null });
    m = next.toISOString().slice(0, 7);
  }
  const period = `${i.from.split('-').reverse().join('/')} a ${i.to.split('-').reverse().join('/')}`;
  const rev = [{ label: 'Recebimentos confirmados no Financeiro', value: c.revenueParts.finance }, { label: 'Entradas bancárias confirmadas como receita', value: c.revenueParts.bank }];
  const allCosts = c.breakdown.map(b => ({ label: `${b.label} (${b.count})`, value: b.value }));
  const variableCosts = c.breakdown.filter(b => ['Fornecedores', 'Impostos'].some(k => b.label.startsWith(k)));
  type Calc = { formula: string; period: string; revenue: { label: string; value: number }[]; costs: { label: string; value: number }[]; result: string };
  const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const p1 = (v: number | null) => v === null ? 'Dados insuficientes' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const calc: Partial<Record<keyof typeof metrics, Calc>> = {
    opReturn: { formula: '((Faturamento − Custos e despesas totais) ÷ Custos e despesas totais) × 100', period, revenue: rev, costs: allCosts, result: `Resultado operacional ${money(c.opResult)} ÷ ${money(c.opExpense)} = ${p1(metrics.opReturn.value)}` },
    opMargin: { formula: '((Faturamento − Custos e despesas totais) ÷ Faturamento) × 100', period, revenue: rev, costs: allCosts, result: `${money(c.opResult)} ÷ ${money(c.revenue)} = ${p1(metrics.opMargin.value)}` },
    margin: { formula: '((Faturamento − fornecedores/terceiros − impostos) ÷ Faturamento) × 100', period, revenue: rev, costs: variableCosts.map(b => ({ label: b.label, value: b.value })), result: p1(metrics.margin.value) },
    roi: { formula: '((Receita atribuída às campanhas − investimento) ÷ investimento) × 100', period, revenue: [], costs: [{ label: 'Marketing e tráfego pago', value: c.acquisition }], result: metrics.roi.note ?? '' },
    cac: { formula: 'Marketing e tráfego pago ÷ clientes novos', period, revenue: [], costs: [{ label: 'Marketing e tráfego pago', value: c.acquisition }], result: metrics.cac.value === null ? (metrics.cac.note ?? '') : `${money(c.acquisition)} ÷ ${c.customers} = ${money(metrics.cac.value)}` },
  };
  return { metrics, calc, series, sources: { revenue: c.revenue, variableCosts: c.variable, acquisition: c.acquisition, opExpense: c.opExpense, opResult: c.opResult, newCustomers: c.customers, pendingSales: c.pending, tenureMonths: tenure } };
}
export type UnitEconomics = ReturnType<typeof unitEconomics>;
