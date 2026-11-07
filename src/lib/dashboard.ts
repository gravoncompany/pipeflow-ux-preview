// Dashboard Geral — browser-safe, pure calculations over real CRM rows.
// Every indicator says where it came from; missing sources stay "unavailable"/"integration", never zero-filled.
import { DEFAULT_STAGES } from "./crm-types";

export type PeriodPreset = "today" | "7d" | "30d" | "month" | "prev-month" | "90d" | "custom";
export const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "today", label: "Hoje" }, { id: "7d", label: "Últimos 7 dias" }, { id: "30d", label: "Últimos 30 dias" },
  { id: "month", label: "Mês atual" }, { id: "prev-month", label: "Mês anterior" }, { id: "90d", label: "Últimos 90 dias" },
  { id: "custom", label: "Personalizado" },
];
export type Granularity = "day" | "week" | "month";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const todaySaoPaulo = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);

/** Inclusive date range of a preset, in São Paulo calendar days. */
export function presetRange(p: Exclude<PeriodPreset, "custom">, today: string): { from: string; to: string } {
  if (p === "today") return { from: today, to: today };
  if (p === "7d") return { from: addDays(today, -6), to: today };
  if (p === "30d") return { from: addDays(today, -29), to: today };
  if (p === "90d") return { from: addDays(today, -89), to: today };
  const first = `${today.slice(0, 7)}-01`;
  if (p === "month") return { from: first, to: today };
  const prevLast = addDays(first, -1);
  return { from: `${prevLast.slice(0, 7)}-01`, to: prevLast };
}

/** Bucket key for charts: day, ISO-like week start (Monday) or month. */
export function bucketOf(date: string, g: Granularity) {
  if (g === "day") return date;
  if (g === "month") return date.slice(0, 7);
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(date, -back);
}
export function buckets(from: string, to: string, g: Granularity) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { const b = bucketOf(d, g); if (out.at(-1) !== b) out.push(b); }
  return out;
}

/** Whole calendar months inside [from,to]; monthly-only sources (the Financeiro sheet) can only fill these. */
export function fullMonths(from: string, to: string) {
  const months: string[] = [];
  let m = from.slice(0, 7);
  while (m <= to.slice(0, 7)) {
    const first = `${m}-01`;
    const next = addDays(`${m}-28`, 4).slice(0, 7);
    const last = addDays(`${next}-01`, -1);
    if (first >= from && last <= to) months.push(m);
    m = next;
  }
  return months;
}

const ORDER = DEFAULT_STAGES.map((s) => s.id);
const atOrAfter = (stage: string, threshold: string) => stage !== "perda" && ORDER.indexOf(stage) >= ORDER.indexOf(threshold);
export const isQualified = (stage: string) => atOrAfter(stage, "qualificacao");
export const isContacted = (stage: string) => atOrAfter(stage, "contato-realizado");
export const NEGOTIATION_STAGES = ["sql", "reuniao-agendada", "aguardando-decisao"];

export type DashLead = {
  id: string; entryDate: string; stage: string; pipelineId: string | null; closedAt: string | null;
  source: string; utmSource: string; utmMedium: string; tags: string[];
};
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Origin group; only explicit source/UTM/tag values count, nothing is inferred. */
export function originGroup(l: Pick<DashLead, "source" | "utmSource" | "utmMedium" | "tags" | "pipelineId">, outboundId: string | null): string {
  const src = norm(l.source), utm = norm(l.utmSource), med = norm(l.utmMedium), tags = l.tags.map(norm);
  if (tags.includes("google-ads") || src === "google ads" || utm.includes("google")) return "Google Ads";
  if (tags.includes("meta-ads") || src === "meta ads" || ["facebook", "instagram", "meta", "fb", "ig"].some((k) => utm === k || src === k)) return "Meta Ads";
  if (src.includes("prospec") || src.includes("b2b") || (outboundId !== null && l.pipelineId === outboundId)) return "Prospecção B2B";
  if (med === "email" || med === "e-mail" || src === "e-mail" || src === "email") return "E-mail";
  return l.source.trim() || "Não informada";
}
export const isPaidOrigin = (g: string) => g === "Google Ads" || g === "Meta Ads";

export type Metric = { value: number | null; state: "ok" | "unavailable" | "integration"; note?: string };
export const ok = (value: number, note?: string): Metric => ({ value, state: "ok", note });
export const unavailable = (note: string): Metric => ({ value: null, state: "unavailable", note });
export const integration = (note: string): Metric => ({ value: null, state: "integration", note });
const ratio = (a: number | null, b: number | null, note: string): Metric =>
  a === null || b === null || b <= 0 ? unavailable(note) : ok(a / b);

export const inRange = (date: string | null | undefined, from: string, to: string) => Boolean(date) && date!.slice(0, 10) >= from && date!.slice(0, 10) <= to;

/** Commercial cohort metrics: leads by entry date, current stages; sales by recorded closing date. */
export function commercialMetrics(leads: DashLead[], from: string, to: string) {
  const cohort = leads.filter((l) => inRange(l.entryDate, from, to));
  const sales = leads.filter((l) => l.stage === "fechado" && inRange(l.closedAt ?? l.entryDate, from, to));
  const qualified = cohort.filter((l) => isQualified(l.stage)).length;
  const negotiation = cohort.filter((l) => NEGOTIATION_STAGES.includes(l.stage)).length;
  const closedInCohort = cohort.filter((l) => l.stage === "fechado").length;
  return { received: cohort.length, qualified, negotiation, sales: sales.length, closedInCohort,
    conversion: cohort.length ? (closedInCohort / cohort.length) * 100 : null };
}

export type FinanceInputs = {
  revenue: { total: number | null; source: "crm" | "planilha" | null; note: string };
  expenses: { total: number | null; note: string };
  investment: { total: number | null; source: "portal" | "planilha" | null; note: string };
  newCustomers: number | null; pendingClassifications: number;
};

export function financialMetrics(f: FinanceInputs, paidLeads: number, sales: number) {
  const revenue = f.revenue.total === null ? unavailable(f.revenue.note) : ok(f.revenue.total, f.revenue.note);
  const expenses = f.expenses.total === null ? unavailable(f.expenses.note) : ok(f.expenses.total, f.expenses.note);
  const investment = f.investment.total === null ? integration(f.investment.note) : ok(f.investment.total, f.investment.note);
  const result = revenue.value === null || expenses.value === null
    ? unavailable("Precisa de faturamento confirmado e despesas registradas no mesmo período.")
    : ok(revenue.value - expenses.value, "Faturamento confirmado menos despesas registradas.");
  const roi = revenue.value === null || investment.value === null || investment.value <= 0
    ? unavailable("Precisa de faturamento confirmado e investimento identificado.")
    : ok(((revenue.value - investment.value) / investment.value) * 100, "Retorno sobre o investimento em marketing do período.");
  const customers = f.pendingClassifications > 0 ? null : f.newCustomers;
  const ticket = revenue.value === null ? unavailable("Sem faturamento confirmado.") : ratio(revenue.value, sales, "Sem vendas fechadas no período.");
  const cpl = investment.value === null ? integration(f.investment.note) : ratio(investment.value, paidLeads, "Sem leads atribuídos a Google ou Meta Ads no período.");
  const cac = investment.value === null ? integration(f.investment.note)
    : ratio(investment.value, customers, f.pendingClassifications ? "Classifique as vendas pendentes para calcular." : "Sem clientes novos confirmados no período.");
  return { revenue, investment, expenses, result, roi, ticket, cpl, cac };
}
