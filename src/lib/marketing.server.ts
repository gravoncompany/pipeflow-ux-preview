import { funnelMetrics } from "./funnel-metrics";
import { buildFindings, dailySeries, summarizeLeads, summarizeSources, type Finding, type MarketingLead, type PlatformMetrics, type SourceSummary } from "./marketing";

type Db = Awaited<ReturnType<typeof adminDb>>;
async function adminDb() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------- Leads ------------------------------- */

async function leadsForMarketing(db: Db, from: string, to: string): Promise<MarketingLead[]> {
  // Janela ampla: vendas contam pela data de fechamento, então incluímos entradas anteriores.
  const out: MarketingLead[] = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await db.from("leads")
      .select("id,entry_date,stage,pipeline_id,closed_at,closed_value,closed_value_confirmed_at,source,utm_source,utm_medium")
      .order("id").range(offset, offset + 999);
    if (error) throw new Error("Não foi possível ler os leads.");
    for (const l of data ?? []) {
      out.push({
        id: String(l.id), entryDate: String(l.entry_date ?? "").slice(0, 10), stage: String(l.stage ?? ""),
        pipelineId: l.pipeline_id ? String(l.pipeline_id) : null,
        closedAt: l.closed_at ? String(l.closed_at) : null,
        closedValue: l.closed_value === null || l.closed_value === undefined ? null : Number(l.closed_value),
        closedValueConfirmed: Boolean(l.closed_value_confirmed_at),
        source: String(l.source ?? ""), utmSource: String(l.utm_source ?? ""), utmMedium: String(l.utm_medium ?? ""),
      });
    }
    if (!data || data.length < 1000) break;
  }
  return out.filter((l) => l.entryDate);
}

/* --------------------------- Integrações --------------------------- */

export type MarketingIntegration = { id: string; platform: "meta" | "google"; accountId: string; accountName: string; active: boolean };

export async function listIntegrations(db: Db, companyKey = "crm:1"): Promise<MarketingIntegration[]> {
  const { data } = await db.from("marketing_integrations").select("id,platform,account_id,account_name,active").eq("company_key", companyKey).order("created_at");
  return (data ?? []).map((r) => ({ id: String(r.id), platform: r.platform as "meta" | "google", accountId: String(r.account_id), accountName: String(r.account_name ?? ""), active: Boolean(r.active) }));
}

export async function setIntegration(db: Db, input: { platform: "meta" | "google"; accountId: string; accountName: string; active: boolean }, companyKey = "crm:1") {
  const idOk = input.platform === "meta" ? /^act_\d{5,25}$/.test(input.accountId) : /^\d{6,12}$/.test(input.accountId.replace(/-/g, ""));
  if (!idOk) throw new Error("Conta inválida para a plataforma.");
  const { error } = await db.from("marketing_integrations").upsert({
    company_key: companyKey, platform: input.platform, account_id: input.accountId,
    account_name: input.accountName.slice(0, 200), active: input.active, updated_at: new Date().toISOString(),
  }, { onConflict: "company_key,platform,account_id" });
  if (error) throw new Error("Não foi possível salvar a conta.");
}

/** Contas descobertas nas conexões existentes, marcando as já habilitadas no Marketing. */
export async function discoverIntegrations(db: Db, companyKey = "crm:1") {
  const m = await import("./ads-platforms.server");
  const [meta, google, saved] = await Promise.all([m.metaDiscoverAccounts(), m.googleStatus(), listIntegrations(db, companyKey)]);
  const enabled = new Set(saved.filter((s) => s.active).map((s) => `${s.platform}:${s.accountId}`));
  return {
    meta: meta.ok ? meta.accounts.map((a) => ({ id: a.id, name: a.name, enabled: enabled.has(`meta:${a.id}`) })) : [],
    metaError: meta.ok ? null : meta.error,
    google: google.connected ? google.accounts.filter((a) => !a.manager && a.readable).map((a) => ({ id: a.id, name: a.name, enabled: enabled.has(`google:${a.id}`) })) : [],
    googleError: google.connected ? null : google.error,
  };
}

/* ------------------------------ Métricas ------------------------------ */

const metricsCache = new Map<string, { at: number; value: { meta: PlatformMetrics[]; google: PlatformMetrics[] } }>();
const CACHE_MS = 60_000;

/** Métricas agregadas por plataforma das contas habilitadas; cache de 60 s por empresa+período. */
export async function platformMetrics(db: Db, from: string, to: string, companyKey = "crm:1") {
  const key = `${companyKey}:${from}:${to}`;
  const hit = metricsCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const m = await import("./ads-platforms.server");
  const accounts = (await listIntegrations(db, companyKey)).filter((a) => a.active);
  const toMetrics = (r: { metrics: import("./ads-metrics").AdsMetrics | null; error: string | null }): PlatformMetrics =>
    r.metrics ? { spend: r.metrics.spend, currency: r.metrics.currency, impressions: r.metrics.impressions, clicks: r.metrics.clicks, cpc: r.metrics.cpc, ctr: r.metrics.ctr, results: r.metrics.results, costPerResult: r.metrics.costPerResult, available: true, error: null }
      : { spend: 0, currency: "", impressions: 0, clicks: 0, cpc: null, ctr: null, results: 0, costPerResult: null, available: false, error: r.error };
  const meta = await Promise.all(accounts.filter((a) => a.platform === "meta").map((a) => m.metaMetrics(a.accountId, from, to).then(toMetrics)));
  const google = await Promise.all(accounts.filter((a) => a.platform === "google").map((a) => m.googleMetrics(a.accountId, from, to).then(toMetrics)));
  const value = { meta, google };
  metricsCache.set(key, { at: Date.now(), value });
  return value;
}

const sumPlatform = (rows: PlatformMetrics[]): PlatformMetrics => {
  const ok = rows.filter((r) => r.available);
  const spend = ok.reduce((n, r) => n + r.spend, 0), impressions = ok.reduce((n, r) => n + r.impressions, 0), clicks = ok.reduce((n, r) => n + r.clicks, 0), results = ok.reduce((n, r) => n + r.results, 0);
  return { spend, currency: ok[0]?.currency ?? "BRL", impressions, clicks, cpc: clicks ? spend / clicks : null, ctr: impressions ? (clicks / impressions) * 100 : null, results, costPerResult: results ? spend / results : null, available: ok.length > 0, error: ok.length ? null : (rows[0]?.error ?? null) };
};

/* ------------------------------- Páginas ------------------------------- */

export async function marketingOverview(db: Db, from: string, to: string, companyKey = "crm:1") {
  const [leads, platforms, integrations] = await Promise.all([leadsForMarketing(db, from, to), platformMetrics(db, from, to, companyKey), listIntegrations(db, companyKey)]);
  const summary = summarizeLeads(leads, from, to);
  const meta = platforms.meta.length ? sumPlatform(platforms.meta) : null;
  const google = platforms.google.length ? sumPlatform(platforms.google) : null;
  const spend = (meta?.spend ?? 0) + (google?.spend ?? 0);
  return {
    summary, meta, google,
    totalSpend: spend,
    costPerLead: summary.leads && spend ? spend / summary.leads : null,
    costPerQualified: summary.qualified && spend ? spend / summary.qualified : null,
    series: dailySeries(leads, from, to),
    configuredAccounts: integrations.filter((i) => i.active).length,
  };
}

export async function marketingCampaigns(db: Db, from: string, to: string, companyKey = "crm:1") {
  const m = await import("./ads-platforms.server");
  const accounts = (await listIntegrations(db, companyKey)).filter((a) => a.active);
  const meta = await Promise.all(accounts.filter((a) => a.platform === "meta").map(async (a) => {
    const r = await m.metaCampaignRows(a.accountId, from, to);
    return { account: a.accountName || a.accountId, rows: r.rows, error: r.error };
  }));
  const google = await Promise.all(accounts.filter((a) => a.platform === "google").map(async (a) => {
    const r = await m.googleCampaignRows(a.accountId, from, to);
    return { account: a.accountName || a.accountId, rows: r.rows, currency: r.currency, error: r.error };
  }));
  return { meta, google, configured: accounts.length };
}

export async function marketingSources(db: Db, from: string, to: string): Promise<SourceSummary[]> {
  return summarizeSources(await leadsForMarketing(db, from, to), from, to);
}

export async function marketingFunnel(db: Db, from: string, to: string) {
  const leads = await leadsForMarketing(db, from, to);
  const entered = leads.filter((l) => l.entryDate >= from && l.entryDate <= to);
  const stages = new Map<string, number>();
  for (const l of entered) stages.set(l.stage, (stages.get(l.stage) ?? 0) + 1);
  const steps = funnelMetrics(entered.length, [...stages.entries()].map(([stage, count]) => ({ stage, count })));
  const lost = stages.get("perda") ?? 0;
  const bySource = summarizeSources(leads, from, to).map((s) => ({ origin: s.origin, leads: s.leads, clients: s.clients, conversion: s.leads ? (s.clients / s.leads) * 100 : 0 }));
  return { steps, lost, bySource, total: entered.length };
}

/* ------------------------ Eventos e conversões ------------------------ */

export type EventMapping = { id: string; crmStage: string; metaEvent: string; googleAction: string; active: boolean };

export async function listEventMappings(db: Db, companyKey = "crm:1"): Promise<EventMapping[]> {
  const { data } = await db.from("marketing_event_mappings").select("id,crm_stage,meta_event,google_action,active").eq("company_key", companyKey).order("created_at");
  return (data ?? []).map((r) => ({ id: String(r.id), crmStage: String(r.crm_stage), metaEvent: String(r.meta_event ?? ""), googleAction: String(r.google_action ?? ""), active: Boolean(r.active) }));
}

const META_EVENTS = ["", "Lead", "QualifiedLead", "Schedule", "Purchase", "Contact", "CompleteRegistration"];

export async function saveEventMapping(db: Db, input: { id: string; metaEvent: string; googleAction: string; active: boolean }, companyKey = "crm:1") {
  if (!META_EVENTS.includes(input.metaEvent)) throw new Error("Evento da Meta inválido.");
  if (input.googleAction && !/^[A-Za-z][A-Za-z0-9_ -]{0,80}$/.test(input.googleAction)) throw new Error("Ação de conversão do Google inválida.");
  const { error } = await db.from("marketing_event_mappings")
    .update({ meta_event: input.metaEvent, google_action: input.googleAction.slice(0, 80), active: input.active, updated_at: new Date().toISOString() })
    .eq("id", input.id).eq("company_key", companyKey);
  if (error) throw new Error("Não foi possível salvar o mapeamento.");
}

export async function marketingEvents(db: Db, from: string, to: string, companyKey = "crm:1") {
  const { listConversions } = await import("./meta-capi-monitor.server");
  const [conversions, mappings] = await Promise.all([listConversions({ companyKey, from, to }), listEventMappings(db, companyKey)]);
  return { conversions, mappings };
}

/* ------------------------------ Análises ------------------------------ */

export async function marketingAnalysis(db: Db, from: string, to: string, companyKey = "crm:1") {
  const [overview, sources, funnel, events] = await Promise.all([
    marketingOverview(db, from, to, companyKey), marketingSources(db, from, to), marketingFunnel(db, from, to),
    listEventMappings(db, companyKey),
  ]);
  const { listConversions } = await import("./meta-capi-monitor.server");
  const conversions = await listConversions({ companyKey, from, to });
  const findings: Finding[] = buildFindings({
    meta: overview.meta, google: overview.google, leads: overview.summary, sources, funnel: funnel.steps,
    eventErrors: conversions.summary.error, currency: overview.meta?.currency || overview.google?.currency || "BRL",
  });
  return { overview, sources, funnel, findings, eventsConfigured: events.filter((e) => e.active).length, eventSummary: conversions.summary };
}

/** Narrativa da Pipeflow IA sobre os achados já calculados; nunca inventa números. */
export async function marketingAiNarrative(payload: unknown) {
  const { generateResponse, GatewayError } = await import("@lovable.dev/ai-gateway");
  try {
    const response = await generateResponse({
      model: "openai/gpt-6-astra",
      instructions: `Você é a Pipeflow IA, analista de marketing e vendas. Escreva em português do Brasil, de forma objetiva.
Use exclusivamente os números do JSON recebido; nunca invente valores, campanhas ou causas.
Itens com kind "limitacao" são dados insuficientes: repita-os em limitations e não conclua sobre eles.
Eventos aceitos pela API não são conversões atribuídas a campanhas. Recomendações são sugestões para uma pessoa decidir; nunca diga que algo foi alterado. Máximo de 5 itens por lista.`,
      input: [{ role: "user", content: `Analise os indicadores de marketing a seguir e responda em JSON.\n${JSON.stringify(payload)}` }],
      text: { format: { type: "json_schema", name: "marketing_analysis", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["summary", "recommendations", "limitations"],
        properties: { summary: { type: "string" }, recommendations: { type: "array", items: { type: "string" } }, limitations: { type: "array", items: { type: "string" } } },
      } } },
    });
    const text = (response as { output?: { type: string; content?: { type: string; text?: string }[] }[] }).output
      ?.flatMap((o) => (o.type === "message" ? o.content ?? [] : [])).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("") ?? "";
    const parsed = JSON.parse(text) as { summary: string; recommendations: string[]; limitations: string[] };
    return { ok: true as const, summary: String(parsed.summary ?? ""), recommendations: (parsed.recommendations ?? []).map(String).slice(0, 5), limitations: (parsed.limitations ?? []).map(String).slice(0, 5) };
  } catch (error) {
    if (error instanceof GatewayError) {
      console.error("marketing_ai_failed", { code: error.code, status: error.httpStatus });
      if (error.httpStatus === 402) return { ok: false as const, error: "Créditos de IA esgotados. Adicione créditos para gerar a análise." };
      if (error.httpStatus === 429) return { ok: false as const, error: "Muitas análises seguidas. Aguarde um minuto e tente de novo." };
    } else console.error("marketing_ai_invalid");
    return { ok: false as const, error: "Não foi possível gerar a análise agora. Os achados determinísticos acima continuam válidos." };
  }
}

export const validMarketingPeriod = (from: string, to: string) => VALID_DATE.test(from) && VALID_DATE.test(to) && from <= to;
