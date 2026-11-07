import { z } from "zod";

/** null = "Não informado" (distinct from a confirmed zero). */
const num = z.number().finite().min(0, "Valores não podem ser negativos.").nullable();
const int = z.number().int("Use um número inteiro.").min(0, "Valores não podem ser negativos.").nullable();

export const FUNNEL_KEYS = ["leads", "qualified", "meetings", "proposals", "clients"] as const;
export type FunnelKey = (typeof FUNNEL_KEYS)[number];
export const FUNNEL_LABELS: Record<FunnelKey, string> = {
  leads: "Leads totais", qualified: "Leads qualificados", meetings: "Reuniões realizadas", proposals: "Propostas enviadas", clients: "Clientes fechados",
};
/** Indicators the CRM can supply for the entry-month cohort (current stages). Meetings held and proposals sent are not recorded in the CRM. */
export const CRM_CAPABLE: FunnelKey[] = ["leads", "qualified", "clients"];

const funnelInts = z.object(Object.fromEntries(FUNNEL_KEYS.map((k) => [k, int])) as Record<FunnelKey, typeof int>);

export const goalData = z.object({
  goals: z.object({
    budget: num, cplQ: num, clients: int, contract: num,
    duration: z.number().int("Duração deve ser um número inteiro de meses.").min(1, "Duração deve ser de pelo menos 1 mês.").nullable(),
    serviceCost: num,
    serviceIncludes: z.object({ direct: z.boolean(), fixed: z.boolean(), team: z.boolean() }),
    serviceValidated: z.boolean(),
  }),
  funnel: z.object({
    target: funnelInts,
    manual: funnelInts,
    source: z.object(Object.fromEntries(FUNNEL_KEYS.map((k) => [k, z.enum(["crm", "manual"])])) as Record<FunnelKey, z.ZodEnum<["crm", "manual"]>>),
    /** Activity in the month (events that happened), always manual. */
    activityMeetings: int, activityClients: int,
  }),
  actual: z.object({ adSpend: num, contractsValue: num, extraCommercial: num, taxes: num, fees: num }),
  cash: z.object({
    received: num, paidOut: num,
    payments: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."), amount: z.number().finite().min(0), method: z.string().max(60), installments: z.number().int().min(1).nullable() })).max(100),
  }),
});
export type GoalData = z.infer<typeof goalData>;
export const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const emptyFunnel = () => Object.fromEntries(FUNNEL_KEYS.map((k) => [k, null])) as Record<FunnelKey, number | null>;
export function emptyGoal(): GoalData {
  return {
    goals: { budget: null, cplQ: null, clients: null, contract: null, duration: null, serviceCost: null, serviceIncludes: { direct: false, fixed: false, team: false }, serviceValidated: false },
    funnel: { target: emptyFunnel(), manual: emptyFunnel(), source: Object.fromEntries(FUNNEL_KEYS.map((k) => [k, CRM_CAPABLE.includes(k) ? "crm" : "manual"])) as GoalData["funnel"]["source"], activityMeetings: null, activityClients: null },
    actual: { adSpend: null, contractsValue: null, extraCommercial: null, taxes: null, fees: null },
    cash: { received: null, paidOut: null, payments: [] },
  };
}

/** Editable starting scenario; realized results, taxes and fees remain "Não informado". */
export function initialScenario(): GoalData {
  const g = emptyGoal();
  g.goals = { budget: 4000, cplQ: 70, clients: 3, contract: 4800, duration: 3, serviceCost: 500, serviceIncludes: { direct: true, fixed: true, team: true }, serviceValidated: false };
  return g;
}

/** Duplicating copies only goals/assumptions and funnel targets, never realized results. */
export function duplicateGoal(src: GoalData): GoalData {
  const g = emptyGoal();
  g.goals = structuredClone(src.goals);
  g.funnel.target = { ...src.funnel.target };
  g.funnel.source = { ...src.funnel.source };
  return g;
}

/** Division that returns null ("Não calculável") for missing values or zero divisor. */
export const div = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : a / b);
const mul = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : a * b);

export function projections(g: GoalData["goals"]) {
  const qualified = div(g.budget, g.cplQ);
  // serviceCost is per client for the whole contract (not per month): count it once.
  const serviceTotal = mul(g.clients, g.serviceCost);
  return {
    qualified,
    conversion: div(g.clients, qualified),
    contractsTotal: mul(g.clients, g.contract),
    monthlyPerClient: div(g.contract, g.duration),
    mediaPerSale: div(g.budget, g.clients),
    serviceMonthly: div(serviceTotal, g.duration),
    serviceTotal,
  };
}

export type FunnelActual = Record<FunnelKey, number | null>;
export function resolveFunnel(d: GoalData, crm: Partial<Record<FunnelKey, number>> | null): { value: FunnelActual; origin: Record<FunnelKey, "CRM" | "Manual"> } {
  const value = {} as FunnelActual; const origin = {} as Record<FunnelKey, "CRM" | "Manual">;
  for (const k of FUNNEL_KEYS) {
    const useCrm = d.funnel.source[k] === "crm" && CRM_CAPABLE.includes(k) && crm?.[k] != null;
    // Exactly one source per indicator: never add CRM and manual values together.
    value[k] = useCrm ? crm![k]! : d.funnel.manual[k];
    origin[k] = useCrm ? "CRM" : "Manual";
  }
  return { value, origin };
}

export function funnelRates(a: FunnelActual, adSpend: number | null) {
  return {
    qualificationRate: div(a.qualified, a.leads),
    qualifiedToSale: div(a.clients, a.qualified),
    proposalToSale: div(a.clients, a.proposals),
    cpl: div(adSpend, a.leads),
    cplQualified: div(adSpend, a.qualified),
    mediaPerSale: div(adSpend, a.clients),
  };
}

/** Acquired-contracts view: deducts each cost once; missing optional costs make the result partial, never zero-confirmed. */
export function contractResult(input: { contracts: number | null; media: number | null; extraCommercial: number | null; serviceTotal: number | null; taxes: number | null; fees: number | null; clients: number | null }) {
  const { contracts, media, extraCommercial, serviceTotal, taxes, fees, clients } = input;
  const balance = contracts == null || media == null || serviceTotal == null ? null
    : contracts - media - (extraCommercial ?? 0) - serviceTotal - (taxes ?? 0) - (fees ?? 0);
  const missing = [extraCommercial == null && "custos comerciais adicionais", taxes == null && "impostos", fees == null && "taxas"].filter(Boolean) as string[];
  return {
    balance, missing,
    perClient: div(balance, clients),
    margin: div(balance, contracts),
    mediaPerSale: div(media, clients),
    cac: media == null ? null : div(media + (extraCommercial ?? 0), clients),
    cacPartial: extraCommercial == null,
  };
}

/** Realized delivery cost: closed clients × per-client contract cost, counted once. */
export const realizedServiceTotal = (clients: number | null, serviceCost: number | null) => mul(clients, serviceCost);

export function cashBalance(received: number | null, paidOut: number | null) {
  return received == null || paidOut == null ? null : received - paidOut;
}

export const brl = (v: number | null | undefined) => v == null ? "Não informado" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const pct = (v: number | null | undefined) => v == null ? "Não calculável" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const dec = (v: number | null | undefined, digits = 2) => v == null ? "Não calculável" : v.toLocaleString("pt-BR", { maximumFractionDigits: digits });
