// Visão Geral do Financeiro a partir das movimentações bancárias já classificadas.
// Mesmas regras de classificação/status do painel bancário (bank-classification). Só valores confirmados entram
// nos cards; pendências ficam separadas. Faturamento = recebimentos confirmados do Financeiro + entradas bancárias que
// o administrador confirmou como receita de clientes, contando uma vez só quando coincidem com um recebimento lançado.
import { CATEGORY_LABEL, type BankKind, type Classification, type CostCategory, type ReviewStatus } from "./bank-classification";

export type OverviewRow = {
  transactionId: string;
  transactionAt: string | null;
  amountCents: number | null;
  currency: string;
  direction: "CREDITO" | "DEBITO" | null;
  description: string | null;
  counterparty: string | null;
  cls: Classification;
  status: ReviewStatus;
  reconciled: boolean;
};
export type SourceReceipt = { amountCents: number; date: string }; // date YYYY-MM-DD (São Paulo)

export type CardKey = "revenue" | "opExpense" | "opResult" | "personal" | "bankIn" | "bankOut";
export type OverviewTotals = {
  revenueCents: number;
  revenueFromFinanceCents: number;
  revenueFromBankCents: number;
  possibleDuplicates: number;
  opExpenseCents: number;
  opResultCents: number;
  personalCents: number;
  bankInCents: number;
  bankOutCents: number;
  pendingCount: number;
  pendingInCents: number;
  pendingOutCents: number;
  /** Pending operational-looking value large enough that the result is not definitive. */
  resultProvisional: boolean;
};

const valid = (r: OverviewRow) =>
  r.amountCents !== null && Number.isSafeInteger(r.amountCents) && r.direction !== null && r.currency === "BRL";
const abs = (r: OverviewRow) => Math.abs(r.amountCents as number);
export const spDay = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);
const confirmed = (s: ReviewStatus) => s !== "pendente";
const NON_OPERATIONAL = new Set<BankKind>(["aplicacao", "resgate", "rendimento", "transferencia_interna", "emprestimo"]);
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400_000;

/**
 * Confirmed bank credits classified as client revenue that are not reconciled. Each is matched against at most one
 * Financeiro receipt with the same amount within 3 days; matched pairs count once (flagged as possible duplicate).
 */
export function bankRevenue(rows: OverviewRow[], receipts: SourceReceipt[]) {
  const pool = receipts.map((r, i) => ({ ...r, i, used: false }));
  const counted: OverviewRow[] = [];
  const duplicates: OverviewRow[] = [];
  for (const r of rows) {
    if (!valid(r) || r.direction !== "CREDITO" || r.cls.kind !== "receita_operacional" || !confirmed(r.status) || r.reconciled || !r.transactionAt) continue;
    const day = spDay(r.transactionAt);
    const match = pool.find((p) => !p.used && p.amountCents === abs(r) && dayDiff(p.date, day) <= 3);
    if (match) { match.used = true; duplicates.push(r); }
    counted.push(r); // Coincidência é apenas aviso; somente vínculo persistente exclui receita duplicada.
  }
  return { counted, duplicates };
}

/** Rows composing each card, so every value can be checked line by line. */
export function cardRows(rows: OverviewRow[], receipts: SourceReceipt[]): Record<Exclude<CardKey, "opResult">, OverviewRow[]> {
  const v = rows.filter(valid);
  return {
    revenue: bankRevenue(v, receipts).counted,
    opExpense: v.filter((r) => r.cls.kind === "despesa_operacional" && confirmed(r.status)),
    personal: v.filter((r) => r.cls.kind === "despesa_pessoal" && confirmed(r.status)),
    bankIn: v.filter((r) => r.direction === "CREDITO"),
    bankOut: v.filter((r) => r.direction === "DEBITO"),
  };
}

const signedExpense = (r: OverviewRow) => (r.direction === "DEBITO" ? abs(r) : -abs(r)); // refunds reduce

export function overviewTotals(rows: OverviewRow[], receipts: SourceReceipt[]): OverviewTotals {
  const v = rows.filter(valid);
  const { counted, duplicates } = bankRevenue(v, receipts);
  const fromFinance = receipts.reduce((t, r) => t + r.amountCents, 0);
  const fromBank = counted.reduce((t, r) => t + abs(r), 0);
  const opExpense = v.filter((r) => r.cls.kind === "despesa_operacional" && confirmed(r.status)).reduce((t, r) => t + signedExpense(r), 0);
  const personal = v.filter((r) => r.cls.kind === "despesa_pessoal" && confirmed(r.status)).reduce((t, r) => t + signedExpense(r), 0);
  const pending = v.filter((r) => r.status === "pendente" && !NON_OPERATIONAL.has(r.cls.kind));
  const pendingIn = pending.filter((r) => r.direction === "CREDITO").reduce((t, r) => t + abs(r), 0);
  const pendingOut = pending.filter((r) => r.direction === "DEBITO").reduce((t, r) => t + abs(r), 0);
  const revenue = fromFinance + fromBank;
  const base = Math.max(revenue, opExpense, 1);
  return {
    revenueCents: revenue,
    revenueFromFinanceCents: fromFinance,
    revenueFromBankCents: fromBank,
    possibleDuplicates: duplicates.length,
    opExpenseCents: opExpense,
    opResultCents: revenue - opExpense,
    personalCents: personal,
    bankInCents: v.filter((r) => r.direction === "CREDITO").reduce((t, r) => t + abs(r), 0),
    bankOutCents: v.filter((r) => r.direction === "DEBITO").reduce((t, r) => t + abs(r), 0),
    pendingCount: pending.length,
    pendingInCents: pendingIn,
    pendingOutCents: pendingOut,
    // Not definitive when pending operational-looking value exceeds 5% of the larger confirmed side.
    resultProvisional: pendingIn + pendingOut > base * 0.05,
  };
}

export function categoryBreakdown(rows: OverviewRow[], kind: "despesa_operacional" | "despesa_pessoal") {
  const map = new Map<CostCategory, { cents: number; rows: OverviewRow[] }>();
  for (const r of rows) {
    if (!valid(r) || r.cls.kind !== kind || !confirmed(r.status)) continue;
    const c = r.cls.category ?? (kind === "despesa_operacional" ? "outras_despesas" : "outras_pessoais");
    const cur = map.get(c) ?? { cents: 0, rows: [] };
    cur.cents += signedExpense(r);
    cur.rows.push(r);
    map.set(c, cur);
  }
  return [...map].map(([category, v]) => ({ category, label: CATEGORY_LABEL[category], cents: v.cents, count: v.rows.length, rows: v.rows }))
    .sort((a, b) => b.cents - a.cents);
}

export type MonthPoint = {
  month: string;
  /** No bank transaction in the month at all. */
  empty: boolean;
  /** Has pending operational-looking value; numbers are partial. */
  incomplete: boolean;
  revenueCents: number | null;
  opExpenseCents: number | null;
  opResultCents: number | null;
  personalCents: number | null;
};

/** January–December of `year`; months without data are null (never zero) and flagged. */
export function yearEvolution(rows: OverviewRow[], receipts: SourceReceipt[], year: number, todayIso = new Date().toISOString()): MonthPoint[] {
  const nowMonth = spDay(todayIso).slice(0, 7);
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const mRows = rows.filter((r) => r.transactionAt && spDay(r.transactionAt).startsWith(month));
    const mReceipts = receipts.filter((r) => r.date.startsWith(month));
    if (month > nowMonth || (!mRows.length && !mReceipts.length))
      return { month, empty: true, incomplete: true, revenueCents: null, opExpenseCents: null, opResultCents: null, personalCents: null };
    const t = overviewTotals(mRows, mReceipts);
    return {
      month,
      empty: false,
      incomplete: t.resultProvisional || month === nowMonth,
      revenueCents: t.revenueCents,
      opExpenseCents: t.opExpenseCents,
      opResultCents: t.opResultCents,
      personalCents: t.personalCents,
    };
  });
}

export type YearlyRevenueStats = {
  /** Soma das receitas confirmadas do ano (centavos). */
  accumulated: number;
  /** Mês de maior faturamento confirmado, ou null quando não há dados. */
  best: { month: string; amount: number } | null;
  /** Média dos meses transcorridos do ano (centavos); null para ano futuro. */
  average: number | null;
  /** Meses transcorridos do ano selecionado: até o mês atual no ano corrente, 12 em anos passados, 0 em anos futuros. */
  elapsedMonths: number;
};

/** Indicadores anuais de faturamento sobre a evolução mensal (meses sem dados nunca viram zero). */
export function yearlyRevenueStats(points: MonthPoint[], year: number, todayIso = new Date().toISOString()): YearlyRevenueStats {
  const now = spDay(todayIso);
  const currentYear = Number(now.slice(0, 4));
  const elapsedMonths = year < currentYear ? 12 : year === currentYear ? Number(now.slice(5, 7)) : 0;
  const values = points.filter((p) => p.revenueCents !== null);
  const accumulated = values.reduce((t, p) => t + (p.revenueCents as number), 0);
  const best = values.reduce<{ month: string; amount: number } | null>((b, p) => (!b || (p.revenueCents as number) > b.amount ? { month: p.month, amount: p.revenueCents as number } : b), null);
  const average = elapsedMonths > 0 ? Math.round(accumulated / elapsedMonths) : null;
  return { accumulated, best, average, elapsedMonths };
}

export function monthlyPersonal(rows: OverviewRow[], months: string[]) {
  return months.map((month) => {
    const list = rows.filter((r) => r.transactionAt && spDay(r.transactionAt).startsWith(month));
    if (!list.length) return { month, cents: null as number | null };
    return { month, cents: categoryBreakdown(list, "despesa_pessoal").reduce((t, c) => t + c.cents, 0) };
  });
}

/** Cobertura dos dados do banco para o período escolhido (dias de São Paulo, inclusivos). */
export type BankCoverage = { firstDay: string | null; syncedUntil: string | null; partial: boolean; availableFrom: string | null; availableTo: string | null };
export function bankCoverage(fromDay: string, toDay: string, firstAt: string | null, syncedUntil: string | null): BankCoverage {
  const firstDay = firstAt ? spDay(firstAt) : null;
  const syncDay = syncedUntil ? spDay(syncedUntil) : null;
  if (!firstDay) return { firstDay: null, syncedUntil, partial: true, availableFrom: null, availableTo: null };
  const availableFrom = firstDay > fromDay ? firstDay : fromDay;
  const availableTo = syncDay && syncDay < toDay ? syncDay : toDay;
  return { firstDay, syncedUntil, partial: firstDay > fromDay || (syncDay !== null && syncDay < toDay), availableFrom, availableTo };
}
