// Leituras derivadas do Financeiro para as telas redesenhadas. Somente leitura sobre o snapshot existente.
import { addDays, confirmedReceipts, ledger, projection, type FinanceSnapshot } from "./finance-management";
import { daysBetween } from "./ux-format";

export type LedgerRow = ReturnType<typeof ledger>[number];
export type LedgerStatus = "liquidado" | "parcial" | "vencido" | "pendente";
export type LedgerSort = "vencimento" | "valor" | "restante" | "nome";

export function ledgerStatus(r: LedgerRow, asOf: string): LedgerStatus {
  if (!r.remaining) return "liquidado";
  if (r.remaining < r.amount) return "parcial";
  if (r.status === "atrasado_informado" || (!!r.dueDate && r.dueDate < asOf)) return "vencido";
  return "pendente";
}

export function daysOverdue(r: LedgerRow, asOf: string): number {
  return r.remaining > 0 && r.dueDate && r.dueDate < asOf ? daysBetween(r.dueDate, asOf) : 0;
}

export function sortLedger(rows: LedgerRow[], sort: LedgerSort, desc = false): LedgerRow[] {
  const key = (r: LedgerRow): string | number => sort === "valor" ? r.amount : sort === "restante" ? r.remaining : sort === "nome" ? r.name.toLocaleLowerCase() : r.dueDate ?? "9999-12-31";
  const out = [...rows].sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  return desc ? out.reverse() : out;
}

export function ledgerTotals(rows: LedgerRow[]) {
  return { amount: rows.reduce((n, r) => n + r.amount, 0), remaining: rows.reduce((n, r) => n + r.remaining, 0), count: rows.length };
}

/** O que precisa de atenção na Visão geral: contas a pagar na semana e menor saldo projetado em 30 dias. */
export function financeAttention(s: FinanceSnapshot, asOf: string) {
  const rows = ledger(s);
  const week = addDays(asOf, 7);
  const payable = rows.filter((r) => r.direction === "out" && r.remaining > 0 && !!r.dueDate && r.dueDate <= week);
  const overduePayable = payable.filter((r) => r.dueDate! < asOf);
  const cash = projection(s, 30, asOf);
  const lowest = cash.reduce((m, p) => (p.balance < m.balance ? p : m), cash[0] ?? { date: asOf, balance: 0, incoming: 0, outgoing: 0 });
  return {
    payableWeek: payable.reduce((n, r) => n + r.remaining, 0), payableCount: payable.length, overduePayable: overduePayable.length,
    balanceIn30: cash.at(-1)?.balance ?? 0, lowest, negativeOn: cash.find((p) => p.balance < 0)?.date ?? null,
  };
}

/** Concentração de receita: participação dos maiores pagadores nos recebimentos confirmados dos últimos `months` meses. */
export function revenueConcentration(s: FinanceSnapshot, asOf: string, months = 12) {
  const since = addDays(asOf, -Math.round(months * 30.44));
  const byName = new Map<string, number>();
  for (const r of confirmedReceipts(s, asOf)) if (r.date >= since) byName.set(r.name, (byName.get(r.name) ?? 0) + r.amount);
  const ranked = [...byName].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((n, [, v]) => n + v, 0);
  const top3 = ranked.slice(0, 3).reduce((n, [, v]) => n + v, 0);
  return { total, ranked: ranked.slice(0, 10).map(([name, amount]) => ({ name, amount, share: total ? Math.round((amount / total) * 1000) / 10 : 0 })), top3Share: total ? Math.round((top3 / total) * 1000) / 10 : 0 };
}
