import type { AdsRow } from "./portal-ads";

// Indicadores de campanhas de UM cliente, a partir das contas de anúncio vinculadas a ele.
// Fonte única por plataforma: a API da Meta (quando a conta Meta está vinculada ao cliente) tem preferência
// sobre a planilha do Portal para Meta Ads; Google Ads vem do Portal. Nunca soma as duas fontes da mesma plataforma.

export type BoundAccount = { platform: "meta_ads" | "google_ads"; account_id: string };
export type MetaRow = { ad_account_id: string; spend_date: string; spend_cents: number; currency: string };
export type PlatformMetrics = {
  platform: "meta_ads" | "google_ads"; source: "portal" | "meta_api" | "none";
  today: number | null; last30: number | null; currency: string; unknownDays: number; lastDate: string | null;
};
export type ClientMetrics = {
  platforms: PlatformMetrics[];
  investment30: number | null; investmentToday: number | null; currency: string;
  /** O Portal ainda não informa leads por empresa: nunca estimamos. */
  leadsToday: number | null; leads30: number | null; costPerLead: number | null;
  lastUpdate: string | null; accounts: number;
};

const norm = (id: string) => id.replace(/^act_/, "").replace(/\D/g, "") || id;

export function clientCampaignMetrics(input: {
  bound: BoundAccount[]; portalRows: AdsRow[]; portalUpdatedAt: string | null;
  metaRows: MetaRow[]; metaAccounts: string[]; metaUpdatedAt: string | null;
  today: string; from: string; leadsToday?: number | null; leads30?: number | null;
}): ClientMetrics {
  const platforms: PlatformMetrics[] = [];
  const lastUpdates: string[] = [];
  for (const platform of ["meta_ads", "google_ads"] as const) {
    const useMeta = platform === "meta_ads" && input.metaAccounts.length > 0;
    if (useMeta) {
      const ids = new Set(input.metaAccounts.map(norm));
      const rows = input.metaRows.filter(r => ids.has(norm(r.ad_account_id)) && r.spend_date >= input.from && r.spend_date <= input.today);
      const sum = (pred: (r: MetaRow) => boolean) => rows.filter(pred).reduce((a, r) => a + r.spend_cents, 0) / 100;
      platforms.push({ platform, source: "meta_api", today: sum(r => r.spend_date === input.today), last30: sum(() => true), currency: rows[0]?.currency ?? "BRL", unknownDays: 0, lastDate: rows.map(r => r.spend_date).sort().at(-1) ?? null });
      if (input.metaUpdatedAt) lastUpdates.push(input.metaUpdatedAt);
      continue;
    }
    const ids = new Set(input.bound.filter(b => b.platform === platform).map(b => norm(b.account_id)));
    if (!ids.size) { platforms.push({ platform, source: "none", today: null, last30: null, currency: "BRL", unknownDays: 0, lastDate: null }); continue; }
    const rows = input.portalRows.filter(r => r.platform === platform && ids.has(norm(r.account_id)) && r.date >= input.from && r.date <= input.today);
    let unknown = 0;
    const total = (pred: (r: AdsRow) => boolean) => {
      let s: number | null = null;
      for (const r of rows.filter(pred)) { if (r.spend === null) unknown++; else s = (s ?? 0) + r.spend; }
      return s;
    };
    const last30 = total(() => true); const before = unknown;
    const today = total(r => r.date === input.today); unknown = before;
    platforms.push({ platform, source: "portal", today: today ?? (rows.length ? null : 0), last30: last30 ?? (rows.length ? null : 0), currency: rows[0]?.currency ?? "BRL", unknownDays: unknown, lastDate: rows.map(r => r.date).sort().at(-1) ?? null });
    const synced = rows.map(r => r.synced_at).sort().at(-1) ?? input.portalUpdatedAt;
    if (synced) lastUpdates.push(synced);
  }
  const active = platforms.filter(p => p.source !== "none");
  const add = (k: "today" | "last30") => active.length && active.every(p => p[k] !== null) ? active.reduce((a, p) => a + (p[k] as number), 0) : null;
  const investment30 = add("last30"), investmentToday = add("today");
  const leads30 = input.leads30 ?? null;
  return {
    platforms, investment30, investmentToday, currency: active[0]?.currency ?? "BRL",
    leadsToday: input.leadsToday ?? null, leads30,
    costPerLead: investment30 !== null && leads30 ? investment30 / leads30 : null,
    lastUpdate: lastUpdates.sort().at(-1) ?? null, accounts: input.bound.length + input.metaAccounts.length,
  };
}

export const PROJECT_STATUS = { planejado: "Planejado", em_andamento: "Em andamento", pausado: "Pausado", concluido: "Concluído", cancelado: "Cancelado" } as const;
export type ProjectStatus = keyof typeof PROJECT_STATUS;

/** Base de conhecimento do cliente organizada por seção (preparada para uso futuro pela Gravon IA no WhatsApp). */
export function clientKnowledgeSections(d: {
  client: Record<string, unknown>; projects: { name: string; service: string; status: string; objectives: string; strategic_plan: string }[];
  documents: { name: string; category: string; ai_authorized: boolean }[]; plans: { title: string; status: string }[];
  records: { kind: string; description: string; created_at: string }[]; knowledge: { kind: string; title: string; text: string }[];
  metrics: ClientMetrics | null;
}) {
  const c = d.client as Record<string, string>;
  return [
    { key: "cadastro", title: "Dados cadastrais", items: [c.trade_name, c.legal_name, c.cnpj && `CNPJ ${c.cnpj}`, c.address, c.email, c.phone || c.whatsapp, c.website].filter(Boolean) as string[] },
    { key: "projetos", title: "Projetos", items: d.projects.map(p => `${p.name} — ${p.service || "serviço não informado"} (${PROJECT_STATUS[p.status as ProjectStatus] ?? p.status})`) },
    { key: "planejamento", title: "Planejamento estratégico", items: [...d.projects.filter(p => p.strategic_plan.trim()).map(p => `${p.name}: ${p.strategic_plan.slice(0, 160)}`), ...d.plans.map(p => `${p.title} (${p.status})`)] },
    { key: "documentos", title: "Documentos", items: d.documents.map(x => `${x.name} (${x.category})${x.ai_authorized ? " · liberado para a IA" : ""}`) },
    { key: "historico", title: "Histórico comercial", items: d.records.slice(0, 20).map(r => `${r.created_at.slice(0, 10)} · ${r.kind}: ${r.description.slice(0, 160)}`) },
    { key: "campanhas", title: "Campanhas", items: d.metrics ? d.metrics.platforms.filter(p => p.source !== "none").map(p => `${p.platform === "meta_ads" ? "Meta Ads" : "Google Ads"}: ${p.last30 === null ? "sem valor" : p.last30.toFixed(2)} ${p.currency} em 30 dias`) : [] },
  ];
}
