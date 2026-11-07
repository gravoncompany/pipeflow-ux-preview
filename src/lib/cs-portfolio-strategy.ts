// Análise estratégica da carteira: regras puras sobre dados já registrados (contratos, financeiro, pontuação e avaliação do gestor).
// Recomendações são sugestões para revisão humana; nada aqui altera contratos, finanças ou situação do cliente.
import { z } from "zod";

export const RELATIONSHIP = { boa: "Boa", regular: "Regular", dificil: "Difícil" } as const;
export const LEVEL = { baixo: "Baixo", medio: "Médio", alto: "Alto" } as const;
export const strategicSchema = z.object({
  relationship: z.enum(["boa", "regular", "dificil"]).nullable().default(null),
  demand: z.enum(["baixo", "medio", "alto"]).nullable().default(null),
  expansion: z.enum(["baixo", "medio", "alto"]).nullable().default(null),
  note: z.string().trim().max(2000).default(""),
  /** Custo mensal direto do atendimento informado pelo gestor (não é lançamento financeiro). */
  directCostCents: z.number().int().min(0).max(1000000000).nullable().default(null),
  evaluatedAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export type Strategic = z.infer<typeof strategicSchema>;

export const RECOMMENDATION = { manter: "Manter", expandir: "Expandir", renegociar: "Renegociar", avaliar_encerramento: "Avaliar encerramento" } as const;
export type Recommendation = keyof typeof RECOMMENDATION;
export const PROFITABILITY = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;
export const RELATIONSHIP_VIEW = { saudavel: "Saudável", regular: "Regular", desgastante: "Desgastante" } as const;

export type StrategyInput = {
  id: string; name: string; mrrCents: number; overdueCents: number; confirmedCents: number;
  health: "saudavel" | "atencao" | "em_risco" | null; commercialStatus: string | null; strategic: Strategic | null;
};
export type Strategy = ReturnType<typeof clientStrategy>;

export function clientStrategy(c: StrategyInput, avgTicketCents: number | null) {
  const s = c.strategic;
  const reasons: string[] = [];
  const money = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  // Rentabilidade só com custo individualizado; ticket baixo nunca implica rentabilidade baixa.
  const marginPct = s?.directCostCents != null && c.mrrCents > 0 ? (c.mrrCents - s.directCostCents) / c.mrrCents * 100 : null;
  const profitability = marginPct === null ? null : marginPct >= 50 ? "alta" as const : marginPct >= 20 ? "media" as const : "baixa" as const;
  const relationship = s?.relationship === "boa" ? "saudavel" as const : s?.relationship === "regular" ? "regular" as const : s?.relationship === "dificil" ? "desgastante" as const
    : c.health === "saudavel" ? "saudavel" as const : c.health === "atencao" ? "regular" as const : c.health === "em_risco" ? "desgastante" as const : null;
  const relationshipSource = s?.relationship ? "avaliação do gestor" : c.health ? "pontuação de saúde" : null;
  const ticketVsAvg = avgTicketCents && c.mrrCents > 0 ? c.mrrCents / avgTicketCents * 100 : null;
  if (c.mrrCents > 0) reasons.push(`Receita mensal recorrente registrada: ${money(c.mrrCents)}${ticketVsAvg !== null ? ` (${Math.round(ticketVsAvg)}% do ticket médio)` : ""}.`);
  if (marginPct !== null) reasons.push(`Margem individual ${Math.round(marginPct)}% (custo direto informado ${money(s!.directCostCents!)}).`);
  if (relationship) reasons.push(`Relacionamento ${RELATIONSHIP_VIEW[relationship].toLowerCase()} pela ${relationshipSource}.`);
  if (s?.demand) reasons.push(`Nível de demanda ${LEVEL[s.demand].toLowerCase()}.`);
  if (c.overdueCents > 0) reasons.push(`Saldo em atraso ${money(c.overdueCents)}.`);
  const expansionSignal = s?.expansion === "alto" || s?.expansion === "medio" || ["upsell", "cross_sell", "crescimento"].includes(c.commercialStatus ?? "");
  if (expansionSignal) reasons.push(s?.expansion ? `Potencial de expansão ${LEVEL[s.expansion].toLowerCase()} (gestor).` : "Status comercial indica oportunidade de crescimento.");

  let recommendation: Recommendation | null = null;
  if (profitability === "baixa" && relationship === "desgastante") recommendation = "avaliar_encerramento";
  else if (profitability === "baixa" || (s?.demand === "alto" && ticketVsAvg !== null && ticketVsAvg < 100) || relationship === "desgastante") recommendation = "renegociar";
  else if (expansionSignal && c.overdueCents === 0) recommendation = "expandir";
  else if (relationship === "saudavel" && c.overdueCents === 0 && profitability !== null) recommendation = "manter";
  else if (relationship === "saudavel" && c.overdueCents === 0 && s?.relationship === "boa") recommendation = "manter";
  if (!recommendation) reasons.push("Dados insuficientes para recomendar: registre a avaliação do gestor e o custo direto.");
  return { id: c.id, name: c.name, mrrCents: c.mrrCents, ticketVsAvg, profitability, marginPct, relationship, recommendation, reasons, demand: s?.demand ?? null, expansion: s?.expansion ?? null };
}

export function portfolioStrategy(clients: StrategyInput[]) {
  const paying = clients.filter(c => c.mrrCents > 0);
  const avg = paying.length ? paying.reduce((n, c) => n + c.mrrCents, 0) / paying.length : null;
  const rows = clients.map(c => clientStrategy(c, avg));
  const group = (f: (r: Strategy) => boolean) => { const g = rows.filter(f); return { count: g.length, mrrCents: g.reduce((n, r) => n + r.mrrCents, 0) }; };
  return {
    avgTicketCents: avg, rows,
    summary: {
      expansion: group(r => r.recommendation === "expandir"),
      renegotiate: group(r => r.recommendation === "renegociar" || r.recommendation === "avaliar_encerramento"),
      healthy: group(r => r.relationship === "saudavel"),
      lowProfit: group(r => r.profitability === "baixa"),
      insufficient: group(r => r.recommendation === null),
    },
  };
}
