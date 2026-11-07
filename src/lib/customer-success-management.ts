import { z } from "zod";
import { strategicSchema } from "./cs-portfolio-strategy";

export const CS_ACCOUNT = { novo: "Novo cliente", onboarding: "Em onboarding", implementacao: "Em implementação", ativo: "Cliente ativo", pausado: "Pausado", inadimplente: "Inadimplente", encerrado: "Encerrado" } as const;
export const CS_COMMERCIAL = { saudavel: "Relacionamento saudável", crescimento: "Potencial de crescimento", upsell: "Oportunidade de upsell", cross_sell: "Oportunidade de cross-sell", revisar: "Revisar relacionamento", recorrencia_queda: "Recorrência em queda", inatividade: "Risco de inatividade", cancelamento: "Risco de cancelamento" } as const;
export const CS_WEIGHTS = { satisfaction: 30, finance: 25, engagement: 20, results: 15, contract: 10 } as const;
export const CS_CRITERIA = { satisfaction: "Satisfação", finance: "Financeiro", engagement: "Engajamento", results: "Resultados", contract: "Contrato" } as const;
export const CS_MIN_COVERAGE = 60;
export const CONTRACT_STATUS = { ativo: "Ativo", pausado: "Pausado", renovado: "Renovado", prorrogado: "Prorrogado", renegociado: "Renegociado", cancelado: "Cancelado", encerrado: "Encerrado" } as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(`${v}T12:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v; }, "Data inválida");
export const criterionSchema = z.object({ value: z.number().min(0).max(100), reason: z.string().trim().min(3).max(1000), source: z.string().trim().min(3).max(500), evaluatedAt: z.string().datetime({ offset: true }) }).strict();
export const AGREEMENT_KIND = { contrato_formal: "Contrato formal", servico_sem_contrato: "Prestação de serviços sem contrato formal", recorrente_indeterminado: "Acordo recorrente por prazo indeterminado", pontual: "Serviço pontual" } as const;
const AGREEMENT_KEYS = ["contrato_formal", "servico_sem_contrato", "recorrente_indeterminado", "pontual"] as const;
export const BILLING = { semanal: "Semanal", quinzenal: "Quinzenal (a cada 15 dias)", bimensal: "Duas vezes por mês (datas fixas)", mensal: "Mensal", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual", personalizada: "Personalizada", unico: "Pagamento único" } as const;
const BILLING_KEYS = ["semanal", "quinzenal", "bimensal", "mensal", "trimestral", "semestral", "anual", "personalizada", "unico"] as const;
export const contractSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(2).max(200), start: day.nullable(), renewal: day.nullable(), termMonths: z.number().int().min(1).max(120).nullable(),
  amountCents: z.number().int().min(0).max(1000000000), billing: z.enum(BILLING_KEYS), billingMonths: z.number().int().min(1).max(120),
  kind: z.enum(AGREEMENT_KEYS).default("contrato_formal"), billingDays: z.number().int().min(1).max(3660).nullable().default(null), indefinite: z.boolean().default(false), nextCharge: day.nullable().default(null),
  status: z.enum(["ativo", "pausado", "renovado", "prorrogado", "renegociado", "cancelado", "encerrado"]), responsible: z.string().trim().max(160), note: z.string().trim().max(2000),
}).strict().refine(v => !v.start || !v.renewal || v.renewal >= v.start, "Renovação anterior ao início");
export const managementSchema = z.object({
  accountStatus: z.enum(["novo", "onboarding", "implementacao", "ativo", "pausado", "inadimplente", "encerrado"]).nullable().default(null),
  commercialStatus: z.enum(["saudavel", "crescimento", "upsell", "cross_sell", "revisar", "recorrencia_queda", "inatividade", "cancelamento"]).nullable().default(null),
  nextFollowup: day.nullable().default(null), contracts: z.array(contractSchema).max(100).default([]),
  strategic: strategicSchema.nullable().optional(),
  criteria: z.object({ satisfaction: criterionSchema.nullable().default(null), finance: criterionSchema.nullable().default(null), engagement: criterionSchema.nullable().default(null), results: criterionSchema.nullable().default(null), contract: criterionSchema.nullable().default(null) }).strict().default({}),
}).strict().refine(v => new Set(v.contracts.map(c => c.id)).size === v.contracts.length, "Contratos duplicados");
export type CsManagement = z.infer<typeof managementSchema>;
export type CriterionKey = keyof typeof CS_WEIGHTS;
export type Criterion = z.infer<typeof criterionSchema>;
export type Criteria = Record<CriterionKey, Criterion | null>;
export function parseManagement(v: unknown): CsManagement { return managementSchema.parse(v ?? {}); }
export const managementUpdateSchema = z.object({ clientId: z.string().uuid(), revision: z.number().int().min(0), eventId: z.string().uuid(), note: z.string().trim().min(3).max(3000), management: managementSchema }).strict();

/** Missing criteria contribute neither a score nor an assumed success/failure. */
export function healthScore(criteria: Criteria, now = Date.now()) {
  let weight = 0, sum = 0;
  const evaluated: Partial<Record<CriterionKey, Criterion>> = {};
  for (const key of Object.keys(CS_WEIGHTS) as CriterionKey[]) {
    const c = criteria[key];
    if (!c || Date.parse(c.evaluatedAt) > now || now - Date.parse(c.evaluatedAt) > 90 * 86400000) continue;
    const parsed = criterionSchema.safeParse(c);
    if (!parsed.success) continue;
    evaluated[key] = c; weight += CS_WEIGHTS[key]; sum += c.value * CS_WEIGHTS[key];
  }
  const score = weight >= CS_MIN_COVERAGE ? Math.round(sum / weight) : null;
  return { score, coverage: weight, health: score === null ? null : score >= 80 ? "saudavel" as const : score >= 60 ? "atencao" as const : "em_risco" as const, evaluated };
}
export function renewalDays(value: string | null, today: string) { return value ? Math.round((Date.parse(`${value}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000) : null; }
export function renewalAlert(value: string | null, today: string) {
  const days = renewalDays(value, today);
  return days === null ? "Não informada" : days < 0 ? "Vencido" : days <= 7 ? "Até 7 dias" : days <= 15 ? "Até 15 dias" : days <= 30 ? "Até 30 dias" : "No prazo";
}
type Contract = CsManagement["contracts"][number];
/** Monthly-normalized recurring amount; one-off payments and point services are never recurring. */
export function monthlyAmount(c: Pick<Contract, "amountCents" | "billing" | "billingMonths" | "billingDays" | "kind">) {
  if (c.billing === "unico" || c.kind === "pontual") return 0;
  switch (c.billing) {
    case "semanal": return c.amountCents * 52 / 12;
    case "quinzenal": return c.amountCents * 365.2425 / 15 / 12;
    case "bimensal": return c.amountCents * 2;
    case "mensal": return c.amountCents;
    case "trimestral": return c.amountCents / 3;
    case "semestral": return c.amountCents / 6;
    case "anual": return c.amountCents / 12;
    case "personalizada": return c.billingDays ? c.amountCents * 365.2425 / c.billingDays / 12 : c.amountCents / c.billingMonths;
  }
}
export function contractActive(c: Contract, today: string) {
  return ["ativo", "renovado", "prorrogado", "renegociado"].includes(c.status) && (!c.start || c.start <= today) && (c.indefinite || c.kind === "recorrente_indeterminado" || !c.renewal || c.renewal >= today);
}
export function contractMrr(contracts: CsManagement["contracts"], today: string) {
  return contracts.filter(c => contractActive(c, today)).reduce((sum, c) => sum + monthlyAmount(c), 0);
}
export type CsCharge = { id: string; amount: number; due_date: string; status: string };
export type CsPayment = { id: string; charge_id: string; amount: number; paid_at: string; confirmed_by: string };
export function clientFinance(charges: CsCharge[], payments: CsPayment[], today: string) {
  const byCharge = new Map<string, number>(); const ids = new Set<string>();
  for (const p of payments) if (!ids.has(p.id) && p.confirmed_by.trim() && Number.isFinite(p.amount) && p.amount > 0 && day.safeParse(p.paid_at).success && p.paid_at <= today && charges.some(c => c.id === p.charge_id && c.status !== "cancelado")) { ids.add(p.id); byCharge.set(p.charge_id, (byCharge.get(p.charge_id) ?? 0) + Math.round(p.amount * 100)); }
  let overdueCents = 0;
  const due = charges.filter(c => c.status !== "cancelado" && c.due_date <= today);
  for (const c of due) if (c.due_date < today) overdueCents += Math.max(0, Math.round(c.amount * 100) - (byCharge.get(c.id) ?? 0));
  const paid = due.filter(c => (byCharge.get(c.id) ?? 0) >= Math.round(c.amount * 100) && c.amount > 0).length;
  const criterion: Criterion | null = due.length ? { value: overdueCents ? Math.round(paid / due.length * 100) : paid === due.length ? 100 : 60, reason: `${paid}/${due.length} cobranças vencidas ou com vencimento hoje têm recebimento confirmado; saldo atrasado R$ ${(overdueCents / 100).toFixed(2)}`, source: "Cobranças e pagamentos confirmados vinculados no Financeiro", evaluatedAt: `${today}T00:00:00-03:00` } : null;
  return { overdueCents, confirmedCents: [...byCharge.values()].reduce((s, v) => s + v, 0), criterion };
}
export function scoreTrend(current: number | null, history: { created_at: string; score: number | null }[], days: number, now = Date.now()) {
  const old = history.filter(h => Date.parse(h.created_at) <= now - days * 86400000 && h.score !== null).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return current === null || !old || old.score === null ? null : current - old.score;
}
export const CS_VIEWS = ["operacional", "saude", "pontuacao", "indicadores", "risco", "renovacoes"] as const;
export type CsView = typeof CS_VIEWS[number];
export const CS_RECOVERY_PREFIX = "Plano de recuperação · ";
export const portfolioDiagnosisSchema = z.object({ summary: z.string().min(3).max(1200), commercialStatus: z.enum(["saudavel", "crescimento", "upsell", "cross_sell", "revisar", "recorrencia_queda", "inatividade", "cancelamento"]).nullable(), health: z.enum(["saudavel", "atencao", "em_risco"]).nullable(), reasons: z.array(z.string().min(3).max(1000)).max(8), evidence: z.array(z.object({ sourceId: z.string().min(1).max(200), quote: z.string().min(3).max(1000) }).strict()).max(12), actions: z.array(z.string().min(3).max(1000)).max(8), opportunities: z.array(z.string().min(3).max(1000)).max(8) }).strict();