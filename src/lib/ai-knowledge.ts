import { z } from "zod";

export const KNOWLEDGE_KINDS = [
  "qualification_pattern",
  "objection",
  "service_failure",
  "winning_practice",
  "sales_frequency",
] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const knowledgeKindLabels: Record<KnowledgeKind, string> = {
  qualification_pattern: "Padrões de qualificação",
  objection: "Objeções frequentes",
  service_failure: "Falhas de atendimento",
  winning_practice: "Práticas que fecham venda",
  sales_frequency: "Frequência de vendas",
};

export const insightSchema = z
  .object({
    kind: z.enum(KNOWLEDGE_KINDS),
    text: z.string().min(10).max(1200),
  })
  .strict();

export const knowledgeGenerationSchema = z
  .object({
    insights: z.array(insightSchema).max(12),
    dataWarning: z.string().max(400),
  })
  .strict();
/** Provider schema stays unconstrained; application validation enforces the persisted limits. */
export const knowledgeOutputSchema = z.object({
  insights: z.array(z.object({ kind: z.enum(KNOWLEDGE_KINDS), text: z.string() }).strict()),
  dataWarning: z.string(),
}).strict();
export type KnowledgeGeneration = z.infer<typeof knowledgeGenerationSchema>;

export type KnowledgeInsight = {
  id: string;
  kind: KnowledgeKind;
  text: string;
  sources: number;
  createdAt: string;
};

/** Sales frequency is derived from leads currently in the closed stage, grouped by entry month — same cohort rule as the funnel. */
export function salesByMonth(
  leads: { stage: string; entryDate: string }[],
  months: number,
): { month: string; count: number }[] {
  const now = new Date();
  const buckets = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, 0);
  }
  for (const lead of leads) {
    if (lead.stage !== "fechado" || !/^\d{4}-\d{2}/.test(lead.entryDate)) continue;
    const key = lead.entryDate.slice(0, 7);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([month, count]) => ({ month, count }));
}

/** Confirmation rate of qualification decisions; null when there is no base. */
export function decisionRate(confirmed: number, cancelled: number): number | null {
  const total = confirmed + cancelled;
  return total > 0 ? (confirmed / total) * 100 : null;
}
