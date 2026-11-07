import { DEFAULT_STAGES } from "./crm-types";

/** Fontes de aquisição exibidas no módulo Marketing, na ordem do painel. */
export const ORIGINS = [
  "Google Ads", "Meta Ads", "Instagram", "Facebook", "Google Maps",
  "Prospecção B2B", "E-mail", "WhatsApp", "Indicações", "Outras origens", "Não identificada",
] as const;
export type Origin = (typeof ORIGINS)[number];

const norm = (v: string) => v.trim().toLowerCase();
const PAID_MEDIUM = /cpc|ppc|paid|paidsocial|anuncio|anúncio|ads/;

/**
 * Classifica a origem de um lead a partir da origem registrada e das UTMs preservadas.
 * Nunca atribui uma campanha quando a origem não pode ser determinada: cai em "Não identificada".
 */
export function classifyOrigin(source: string, utmSource: string, utmMedium: string): Origin {
  const s = norm(source), u = norm(utmSource), m = norm(utmMedium);
  const paid = PAID_MEDIUM.test(m);
  // Prospecção B2B tem origens próprias registradas no Pipeflow e vence as UTMs.
  if (s.includes("maps")) return "Google Maps";
  if (s.includes("apify") || s.includes("receita") || s.includes("b2b") || s.includes("prospec") || s.includes("outbound")) return "Prospecção B2B";
  if (u.includes("google") && paid) return "Google Ads";
  if ((u.includes("facebook") || u.includes("instagram") || u.includes("meta") || u === "fb") && paid) return "Meta Ads";
  if (u.includes("instagram")) return "Instagram";
  if (u.includes("facebook") || u === "fb") return "Facebook";
  if (u.includes("whatsapp") || s.includes("whatsapp")) return "WhatsApp";
  if (m.includes("email") || u.includes("email") || u.includes("e-mail") || u.includes("newsletter") || s.includes("e-mail") || s.includes("email")) return "E-mail";
  if (s.includes("indica")) return "Indicações";
  if (u.includes("google")) return "Outras origens"; // Google orgânico: não é anúncio.
  if (s || u) return "Outras origens";
  return "Não identificada";
}

export type MarketingLead = {
  id: string;
  entryDate: string; // YYYY-MM-DD
  stage: string;
  closedAt: string | null;
  closedValue: number | null;
  closedValueConfirmed: boolean;
  source: string;
  utmSource: string;
  utmMedium: string;
  pipelineId: string | null;
};

const stageIndex = (stage: string) => DEFAULT_STAGES.findIndex((s) => s.id === stage);
const QUALIFIED_FROM = stageIndex("qualificacao");
const MEETING_FROM = stageIndex("reuniao-agendada");

export const isQualifiedStage = (stage: string) => { const i = stageIndex(stage); return i >= QUALIFIED_FROM && stage !== "perda"; };
export const isMeetingStage = (stage: string) => { const i = stageIndex(stage); return i >= MEETING_FROM && stage !== "perda"; };

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

/** Resumo do período: entradas pela data de entrada; vendas pela data de fechamento. */
export function summarizeLeads(leads: MarketingLead[], from: string, to: string) {
  const entered = leads.filter((l) => inRange(l.entryDate, from, to));
  const sales = leads.filter((l) => l.stage === "fechado" && inRange((l.closedAt ?? l.entryDate).slice(0, 10), from, to));
  const revenue = sales.filter((l) => l.closedValueConfirmed).reduce((n, l) => n + (l.closedValue ?? 0), 0);
  const hasUnconfirmedSaleValue = sales.some((l) => !l.closedValueConfirmed);
  return {
    leads: entered.length,
    qualified: entered.filter((l) => isQualifiedStage(l.stage)).length,
    meetings: entered.filter((l) => isMeetingStage(l.stage)).length,
    lost: entered.filter((l) => l.stage === "perda").length,
    sales: sales.length,
    revenue,
    hasUnconfirmedSaleValue,
  };
}

/** Série diária de leads/qualificados/vendas para os gráficos de evolução. */
export function dailySeries(leads: MarketingLead[], from: string, to: string) {
  const days: string[] = [];
  for (let d = from; d <= to;) {
    days.push(d);
    const next = new Date(`${d}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
    if (days.length > 400) break; // limite de segurança
  }
  const map = new Map(days.map((d) => [d, { date: d, leads: 0, qualificados: 0, vendas: 0 }]));
  for (const l of leads) {
    if (inRange(l.entryDate, from, to)) {
      const row = map.get(l.entryDate);
      if (row) { row.leads++; if (isQualifiedStage(l.stage)) row.qualificados++; }
    }
    if (l.stage === "fechado") {
      const c = (l.closedAt ?? l.entryDate).slice(0, 10);
      const row = map.get(c);
      if (row) row.vendas++;
    }
  }
  return [...map.values()];
}

export type SourceSummary = { origin: Origin; leads: number; qualified: number; meetings: number; clients: number; revenue: number };

/** Funil por fonte: quantos leads cada origem gerou, qualificou, levou a reunião e converteu em cliente. */
export function summarizeSources(leads: MarketingLead[], from: string, to: string): SourceSummary[] {
  const acc = new Map<Origin, SourceSummary>(ORIGINS.map((o) => [o, { origin: o, leads: 0, qualified: 0, meetings: 0, clients: 0, revenue: 0 }]));
  for (const l of leads) {
    const origin = classifyOrigin(l.source, l.utmSource, l.utmMedium);
    const row = acc.get(origin)!;
    if (inRange(l.entryDate, from, to)) {
      row.leads++;
      if (isQualifiedStage(l.stage)) row.qualified++;
      if (isMeetingStage(l.stage)) row.meetings++;
    }
    if (l.stage === "fechado" && inRange((l.closedAt ?? l.entryDate).slice(0, 10), from, to)) {
      row.clients++;
      if (l.closedValueConfirmed) row.revenue += l.closedValue ?? 0;
    }
  }
  return [...acc.values()].filter((r) => r.leads > 0 || r.clients > 0 || ["Google Ads", "Meta Ads", "Não identificada"].includes(r.origin));
}

export type PlatformMetrics = {
  spend: number; currency: string; impressions: number; clicks: number;
  cpc: number | null; ctr: number | null; results: number; costPerResult: number | null;
  available: boolean; error: string | null;
};

export type Finding = { kind: "atencao" | "oportunidade" | "positivo" | "limitacao"; text: string };

/**
 * Achados determinísticos da Pipeflow IA: cada item cita os números que o justificam.
 * Com dados insuficientes, registra a limitação em vez de concluir.
 */
export function buildFindings(input: {
  meta: PlatformMetrics | null;
  google: PlatformMetrics | null;
  leads: ReturnType<typeof summarizeLeads>;
  sources: SourceSummary[];
  funnel: { label: string; ofPrev: number; hasPreviousBase: boolean }[];
  eventErrors: number;
  currency: string;
}): Finding[] {
  const out: Finding[] = [];
  const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: input.currency || "BRL" });
  for (const [name, p] of [["Meta Ads", input.meta], ["Google Ads", input.google]] as const) {
    if (!p) continue;
    if (!p.available) { out.push({ kind: "limitacao", text: `${name}: dados indisponíveis no período (${p.error ?? "não conectado"}). Nenhuma conclusão foi tirada sobre esta plataforma.` }); continue; }
    if (p.spend > 0 && p.results === 0) out.push({ kind: "atencao", text: `${name}: ${money(p.spend)} investidos sem nenhum resultado registrado no período. Revise segmentação, criativos e o acompanhamento de conversões.` });
    if (p.spend > 0 && p.results > 0 && p.costPerResult !== null) out.push({ kind: "positivo", text: `${name}: ${p.results} resultado(s) com ${money(p.spend)} investidos — custo por resultado de ${money(p.costPerResult)}.` });
  }
  if (!input.meta?.available && !input.google?.available) out.push({ kind: "limitacao", text: "Nenhuma conta de anúncios conectada retornou dados no período. As análises de investimento ficam pendentes até a conexão." });
  const withLeads = input.sources.filter((s) => s.leads >= 3);
  if (withLeads.length) {
    const best = [...withLeads].sort((a, b) => b.qualified / b.leads - a.qualified / a.leads)[0];
    if (best.qualified > 0) out.push({ kind: "oportunidade", text: `Fonte com maior proporção de qualificados: ${best.origin} — ${best.qualified} de ${best.leads} leads (${Math.round((best.qualified / best.leads) * 100)}%). Considere reforçar essa origem.` });
  }
  const bottleneck = input.funnel.filter((f) => f.hasPreviousBase).sort((a, b) => a.ofPrev - b.ofPrev)[0];
  if (bottleneck && bottleneck.ofPrev < 100) out.push({ kind: "atencao", text: `Maior gargalo do funil: etapa "${bottleneck.label}" retém apenas ${bottleneck.ofPrev.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da etapa anterior.` });
  if (input.eventErrors > 0) out.push({ kind: "atencao", text: `${input.eventErrors} evento(s) de conversão com erro aguardando reprocessamento. Plataformas podem estar sem receber sinais de otimização.` });
  if (input.leads.leads === 0) out.push({ kind: "limitacao", text: "Nenhum lead novo no período selecionado. Amplie o período ou verifique as capturas antes de concluir sobre a geração de demanda." });
  if (input.leads.hasUnconfirmedSaleValue) out.push({ kind: "limitacao", text: "Há vendas sem valor fechado confirmado; a receita atribuída está subestimada." });
  return out;
}
