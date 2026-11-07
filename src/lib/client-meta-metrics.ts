/** Client "Campanhas" cards read straight from the client's linked Meta ad accounts. Values the API does not return stay null (shown as unavailable). */
export const META_CARD_METRICS = [
  { key: "spend", label: "Investimento", kind: "money" },
  { key: "conversations", label: "Conversas por mensagem iniciadas", kind: "int" },
  { key: "costPerConversation", label: "Custo por conversa iniciada", kind: "money" },
  { key: "leads", label: "Leads", kind: "int" },
  { key: "costPerLead", label: "Custo por lead", kind: "money" },
  { key: "results", label: "Resultados", kind: "int" },
  { key: "costPerResult", label: "Custo por resultado", kind: "money" },
  { key: "reach", label: "Alcance", kind: "int" },
  { key: "impressions", label: "Impressões", kind: "int" },
  { key: "linkClicks", label: "Cliques no link", kind: "int" },
  { key: "cpc", label: "CPC", kind: "money" },
  { key: "ctr", label: "CTR", kind: "pct" },
] as const;
export type MetaCardKey = typeof META_CARD_METRICS[number]["key"];
export const DEFAULT_CARD_METRICS: MetaCardKey[] = ["spend", "leads", "costPerLead", "reach"];
export const isCardKey = (k: string): k is MetaCardKey => META_CARD_METRICS.some(m => m.key === k);

export type MetaInsightRow = { spend?: string; reach?: string; impressions?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[]; results?: { indicator?: string; values?: { value: string }[] }[] };
const CONV = "onsite_conversion.messaging_conversation_started_7d";
const LEAD = "lead";

/** Sums rows of several accounts. Reach is not additive across accounts, so it is only reported for a single account. */
export function aggregateMetaInsights(rows: (MetaInsightRow | null)[], accountsQueried: number) {
  const ok = rows.filter((r): r is MetaInsightRow => r !== null);
  if (!ok.length) return null;
  const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));
  const sum = (pick: (r: MetaInsightRow) => number | null) => { let any = false, t = 0; for (const r of ok) { const v = pick(r); if (v !== null && Number.isFinite(v)) { any = true; t += v; } } return any ? t : null; };
  const action = (type: string) => (r: MetaInsightRow) => { const a = r.actions?.find(x => x.action_type === type); return a ? Number(a.value) : r.actions ? 0 : null; };
  const spend = sum(r => num(r.spend) ?? 0);
  const impressions = sum(r => num(r.impressions));
  const linkClicks = sum(r => num(r.inline_link_clicks) ?? (r.impressions ? 0 : null));
  const conversations = sum(action(CONV));
  const leads = sum(action(LEAD));
  const resultsOk = ok.every(r => Array.isArray(r.results));
  const results = resultsOk ? sum(r => (r.results ?? []).reduce((t, x) => t + (x.values ?? []).reduce((s, v) => s + Number(v.value || 0), 0), 0)) : null;
  const per = (n: number | null) => (spend !== null && n ? spend / n : null);
  return {
    spend, impressions, linkClicks, conversations, leads, results,
    reach: accountsQueried === 1 && ok.length === 1 ? num(ok[0].reach) : null,
    costPerConversation: per(conversations), costPerLead: per(leads), costPerResult: per(results),
    cpc: per(linkClicks), ctr: impressions && linkClicks !== null ? (linkClicks / impressions) * 100 : null,
  } satisfies Record<MetaCardKey, number | null>;
}

export type PeriodPreset = "today" | "yesterday" | "last_7d" | "last_30d" | "this_month" | "custom";
/** Dates in São Paulo time. last_7d/last_30d include today, matching the previous "Últimos 30 dias" panel. */
export function periodRange(preset: PeriodPreset, now = new Date(), custom?: { since: string; until: string }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  switch (preset) {
    case "today": return { since: today, until: today };
    case "yesterday": { const y = shift(today, -1); return { since: y, until: y }; }
    case "last_7d": return { since: shift(today, -6), until: today };
    case "this_month": return { since: `${today.slice(0, 8)}01`, until: today };
    case "custom": return custom ?? { since: shift(today, -29), until: today };
    default: return { since: shift(today, -29), until: today };
  }
}

/** Period of the same length immediately before `range` (for comparisons). */
export function previousRange(range: { since: string; until: string }) {
  const d = (s: string) => new Date(`${s}T12:00:00Z`).getTime();
  const days = Math.round((d(range.until) - d(range.since)) / 86_400_000) + 1;
  const shift = (s: string, n: number) => { const x = new Date(`${s}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  return { since: shift(range.since, -days), until: shift(range.since, -1) };
}
