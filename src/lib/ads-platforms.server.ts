import { parseGoogleMetrics, parseMetaMetrics, type AdsMetrics } from "./ads-metrics";

type Res = { ok: true; body: any } | { ok: false; http: number | null; code: string };
const GW = "https://connector-gateway.lovable.dev";

/** Read-only gateway call; 15 s timeout, no redirects, logs only status/code (never bodies or keys). */
async function gw(connector: "meta_ads" | "google_ads", keyName: string, path: string, init: { method?: string; params?: Record<string, string>; body?: unknown } = {}): Promise<Res> {
  const lovable = process.env["LOVABLE_API_KEY"], key = process.env[keyName];
  if (!lovable || !key) return { ok: false, http: null, code: "not_connected" };
  const qs = init.params ? `?${new URLSearchParams(init.params)}` : "";
  let res: Response;
  try {
    res = await fetch(`${GW}/${connector}/${path}${qs}`, { method: init.method ?? "GET", redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": key, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined });
  } catch (e) { return { ok: false, http: null, code: e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network" }; }
  if (res.status >= 300 && res.status < 400) return { ok: false, http: res.status, code: "redirect" };
  let body: any = null; try { body = JSON.parse((await res.text()).slice(0, 2_000_000)); } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = Array.isArray(body) ? body[0]?.error : body?.error;
    const code = connector === "meta_ads" ? String(e?.code ?? "unknown") : String(e?.details?.[0]?.errors?.[0]?.errorCode ? Object.values(e.details[0].errors[0].errorCode)[0] : e?.status ?? "unknown");
    console.error(`${connector} read failed [${res.status}] code=${code}`);
    return { ok: false, http: res.status, code };
  }
  return { ok: true, body };
}

export function adsFailureText(platform: "meta" | "google", r: { http: number | null; code: string }) {
  const name = platform === "meta" ? "Meta" : "Google Ads";
  if (r.code === "not_connected") return `${name} ainda não está conectado ao Pipeflow. É preciso autorizar a conta ${platform === "meta" ? "do Facebook" : "Google"} com acesso às contas de anúncios.`;
  if (r.code === "timeout" || r.code === "network") return `${name} não respondeu. Tente de novo em instantes.`;
  if (r.http === 401 || r.code === "190" || r.code === "UNAUTHENTICATED") return `A autorização de ${name} expirou ou foi revogada. Reconecte a conta.`;
  if (r.http === 403 || ["10", "200", "PERMISSION_DENIED", "USER_PERMISSION_DENIED"].includes(r.code)) return `A conexão não tem permissão para ler essa conta em ${name}.`;
  if (r.http === 429 || ["4", "17", "32", "613", "RESOURCE_EXHAUSTED"].includes(r.code)) return `${name} limitou as consultas por enquanto. Aguarde alguns minutos.`;
  if (r.code === "DEVELOPER_TOKEN_NOT_APPROVED" || r.code === "DEVELOPER_TOKEN_PROHIBITED") return "O acesso à API do Google Ads ainda não foi aprovado para esta conexão.";
  return `${name} recusou a consulta (código ${r.code}).`;
}

/* ------------------------------- Meta Ads ------------------------------- */
type MetaStatus = { connected: boolean; state: "connected" | "disconnected" | "unverified"; error: string | null; accounts: { id: string; name: string; currency: string; active: boolean }[]; user?: string; permissions?: string[]; missing?: string[]; checkedAt?: string };
let metaCache: { at: number; value: MetaStatus } | null = null;
const transient = (r: { http: number | null; code: string }) => r.http === 429 || r.http === null || (r.http ?? 0) >= 500 || ["4", "17", "32", "613", "timeout", "network"].includes(r.code);
const REQUIRED = ["ads_read", "business_management"];

/** Status with a 60 s cache. Rate limits/timeouts never flip the integration to "not connected" (cause of the flapping status). */
export async function metaStatus(force = false): Promise<MetaStatus> {
  if (!force && metaCache && Date.now() - metaCache.at < 60_000) return metaCache.value;
  const me = await gw("meta_ads", "META_ADS_API_KEY", "v26.0/me", { params: { fields: "id,name" } });
  if (!me.ok) {
    if (transient(me) && me.code !== "not_connected") {
      const last = metaCache?.value;
      return { ...(last ?? { accounts: [], connected: false }), state: "unverified", error: `${adsFailureText("meta", me)} Status anterior mantido; nada foi desconectado.` } as MetaStatus;
    }
    const v: MetaStatus = { connected: false, state: "disconnected", error: adsFailureText("meta", me), accounts: [] };
    metaCache = { at: Date.now(), value: v }; return v;
  }
  const perms = await gw("meta_ads", "META_ADS_API_KEY", "v26.0/me/permissions");
  const granted = perms.ok ? ((perms.body?.data ?? []) as { permission: string; status: string }[]).filter(p => p.status === "granted").map(p => p.permission) : (metaCache?.value.permissions ?? []);
  const acc = await gw("meta_ads", "META_ADS_API_KEY", "v26.0/me/adaccounts", { params: { fields: "id,name,currency,account_status", limit: "200" } });
  const accounts = acc.ok ? ((acc.body?.data ?? []) as { id: string; name?: string; currency?: string; account_status?: number }[])
    .filter(a => /^act_\d{5,25}$/.test(a.id)).map(a => ({ id: a.id, name: (a.name ?? "").slice(0, 200), currency: a.currency ?? "", active: a.account_status === 1 })) : (metaCache?.value.accounts ?? []);
  const v: MetaStatus = { connected: true, state: "connected", user: String(me.body?.name ?? ""), permissions: granted, missing: perms.ok ? REQUIRED.filter(r => !granted.includes(r) && !(r === "ads_read" && granted.includes("ads_management"))) : [], accounts, error: acc.ok ? null : adsFailureText("meta", acc), checkedAt: new Date().toISOString() };
  metaCache = { at: Date.now(), value: v }; return v;
}

export async function metaMetrics(accountId: string, since: string, until: string): Promise<{ metrics: AdsMetrics | null; error: string | null }> {
  if (!/^act_\d{5,25}$/.test(accountId)) return { metrics: null, error: "Conta Meta inválida." };
  const [ins, info, camps] = await Promise.all([
    gw("meta_ads", "META_ADS_API_KEY", `v26.0/${accountId}/insights`, { params: { level: "account", fields: "spend,impressions,reach,clicks,actions", time_range: JSON.stringify({ since, until }) } }),
    gw("meta_ads", "META_ADS_API_KEY", `v26.0/${accountId}`, { params: { fields: "currency" } }),
    gw("meta_ads", "META_ADS_API_KEY", `v26.0/${accountId}/campaigns`, { params: { effective_status: JSON.stringify(["ACTIVE"]), summary: "total_count", limit: "1", fields: "id" } }),
  ]);
  if (!ins.ok) return { metrics: null, error: adsFailureText("meta", ins) };
  const active = camps.ok ? Number(camps.body?.summary?.total_count ?? 0) : null;
  return { metrics: parseMetaMetrics(ins.body?.data?.[0], info.ok ? String(info.body?.currency ?? "") : "", active), error: null };
}

/* ------------------------------ Google Ads ------------------------------ */
const gaSearch = (customer: string, query: string) => gw("google_ads", "GOOGLE_ADS_API_KEY", `v25/customers/${customer}/googleAds:search`, { method: "POST", body: { query } });

export async function googleStatus() {
  const list = await gw("google_ads", "GOOGLE_ADS_API_KEY", "v25/customers:listAccessibleCustomers");
  if (!list.ok) return { connected: false as const, error: adsFailureText("google", list), accounts: [] };
  const ids = ((list.body?.resourceNames ?? []) as string[]).map(r => r.split("/")[1]).filter(id => /^\d{6,12}$/.test(id)).slice(0, 50);
  const accounts = await Promise.all(ids.map(async id => {
    const r = await gaSearch(id, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.status FROM customer LIMIT 1");
    const c = r.ok ? r.body?.results?.[0]?.customer : null;
    return { id, name: String(c?.descriptiveName ?? ""), currency: String(c?.currencyCode ?? ""), manager: Boolean(c?.manager), active: c ? c.status === "ENABLED" : false, readable: r.ok };
  }));
  return { connected: true as const, accounts, error: null };
}

export async function googleMetrics(customerId: string, since: string, until: string): Promise<{ metrics: AdsMetrics | null; error: string | null }> {
  const id = customerId.replace(/-/g, "");
  if (!/^\d{6,12}$/.test(id)) return { metrics: null, error: "Conta Google Ads inválida." };
  const [m, c, cur] = await Promise.all([
    gaSearch(id, `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date BETWEEN '${since}' AND '${until}'`),
    gaSearch(id, "SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED'"),
    gaSearch(id, "SELECT customer.currency_code FROM customer LIMIT 1"),
  ]);
  if (!m.ok) return { metrics: null, error: adsFailureText("google", m) };
  const rows = (m.body?.results ?? []) as { metrics?: Record<string, unknown> }[];
  const sum = rows.reduce<Record<string, number>>((a, r) => { for (const k of ["costMicros", "impressions", "clicks", "conversions"]) a[k] = (a[k] ?? 0) + Number(r.metrics?.[k] ?? 0); return a; }, {});
  return { metrics: parseGoogleMetrics({ metrics: sum }, cur.ok ? String(cur.body?.results?.[0]?.customer?.currencyCode ?? "") : "", c.ok ? (c.body?.results ?? []).length : null), error: null };
}

/** Campaign-level rows of one Google Ads account (read-only, top 25 by cost). */
export async function googleCampaignRows(customerId: string, since: string, until: string): Promise<{ rows: { id: string; name: string; status: string; budget: number | null; spend: number; impressions: number; clicks: number; ctr: number | null; cpc: number | null; conversions: number; costPerConversion: number | null }[]; currency: string; error: string | null }> {
  const id = customerId.replace(/-/g, "");
  if (!/^\d{6,12}$/.test(id)) return { rows: [], currency: "", error: "Conta Google Ads inválida." };
  const [r, cur] = await Promise.all([
    gaSearch(id, `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}' AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 25`),
    gaSearch(id, "SELECT customer.currency_code FROM customer LIMIT 1"),
  ]);
  if (!r.ok) return { rows: [], currency: "", error: adsFailureText("google", r) };
  const rows = ((r.body?.results ?? []) as any[]).map((x) => {
    const m = x.metrics ?? {};
    const spend = Number(m.costMicros ?? 0) / 1_000_000, clicks = Number(m.clicks ?? 0), impressions = Number(m.impressions ?? 0), conversions = Number(m.conversions ?? 0);
    const budget = x.campaignBudget?.amountMicros !== undefined ? Number(x.campaignBudget.amountMicros) / 1_000_000 : null;
    return { id: String(x.campaign?.id ?? ""), name: String(x.campaign?.name ?? "").slice(0, 200), status: String(x.campaign?.status ?? ""), budget, spend, impressions, clicks,
      ctr: impressions ? (clicks / impressions) * 100 : null, cpc: clicks ? spend / clicks : null, conversions, costPerConversion: conversions ? spend / conversions : null };
  });
  return { rows, currency: cur.ok ? String(cur.body?.results?.[0]?.customer?.currencyCode ?? "") : "", error: null };
}

/* ---------------- Meta ad account discovery (read-only) ---------------- */
export type DiscoveredMetaAccount = { id: string; name: string; businessId: string; businessName: string; status: number | null };
type RawAcc = { id: string; name?: string; account_status?: number; business?: { id?: string; name?: string } };

async function metaPaged(path: string, params: Record<string, string>, maxPages = 10): Promise<{ rows: RawAcc[]; error: Res | null }> {
  const rows: RawAcc[] = []; let after = "";
  for (let i = 0; i < maxPages; i++) {
    const r = await gw("meta_ads", "META_ADS_API_KEY", path, { params: { ...params, limit: "200", ...(after ? { after } : {}) } });
    if (!r.ok) return { rows, error: r };
    rows.push(...((r.body?.data ?? []) as RawAcc[]));
    after = r.body?.paging?.next ? String(r.body?.paging?.cursors?.after ?? "") : "";
    if (!after) break;
  }
  return { rows, error: null };
}

/** Lists every ad account the connection can read: /me/adaccounts plus owned/client accounts of authorized business portfolios. */
export async function metaDiscoverAccounts() {
  const fields = "id,name,account_status,business{id,name}";
  const me = await metaPaged("v26.0/me/adaccounts", { fields });
  if (me.error && !me.rows.length) return { ok: false as const, error: adsFailureText("meta", me.error as { http: number | null; code: string }), accounts: [], notes: [] as string[] };
  const map = new Map<string, DiscoveredMetaAccount>();
  const put = (a: RawAcc, fb?: { id: string; name: string }) => {
    if (!/^act_\d{5,25}$/.test(a.id)) return;
    const prev = map.get(a.id);
    map.set(a.id, { id: a.id, name: (a.name ?? prev?.name ?? "").slice(0, 500), businessId: a.business?.id ?? prev?.businessId ?? fb?.id ?? "", businessName: (a.business?.name ?? prev?.businessName ?? fb?.name ?? "").slice(0, 500), status: a.account_status ?? prev?.status ?? null });
  };
  me.rows.forEach(a => put(a));
  const notes: string[] = [];
  const perms = await gw("meta_ads", "META_ADS_API_KEY", "v26.0/me/permissions");
  const granted = perms.ok ? ((perms.body?.data ?? []) as { permission: string; status: string }[]).filter(p => p.status === "granted").map(p => p.permission) : [];
  if (perms.ok && !granted.includes("ads_read") && !granted.includes("ads_management")) notes.push("A conexão não tem a permissão ads_read; reconecte e aprove o acesso a anúncios.");
  if (perms.ok && !granted.includes("business_management")) notes.push("Sem business_management, os portfólios empresariais dos clientes não podem ser consultados.");
  const biz = await gw("meta_ads", "META_ADS_API_KEY", "v26.0/me/businesses", { params: { fields: "id,name", limit: "100" } });
  const businesses = biz.ok ? ((biz.body?.data ?? []) as { id: string; name?: string }[]).filter(b => /^\d{5,25}$/.test(b.id)).slice(0, 30) : [];
  for (const b of businesses) {
    for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
      const r = await metaPaged(`v26.0/${b.id}/${edge}`, { fields }, 5);
      r.rows.forEach(a => put(a, { id: b.id, name: b.name ?? "" }));
      if (r.error) notes.push(`Portfólio ${b.name || b.id}: ${adsFailureText("meta", r.error as { http: number | null; code: string })}`);
    }
  }
  if (!businesses.length && new Set([...map.values()].map(a => a.businessId)).size <= 1) notes.push("Nenhum portfólio empresarial foi compartilhado com esta conexão. Contas que a Gravon acessa pelo Gerenciador de Anúncios só aparecem aqui se forem selecionadas ao reconectar a Meta no Pipeflow.");
  if (me.error) notes.push(`Lista parcial: ${adsFailureText("meta", me.error as { http: number | null; code: string })}`);
  return { ok: true as const, error: null, accounts: [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), notes };
}

/** Client cards: raw account-level insight row (null when Meta returned no delivery). "results" is requested separately because older accounts may reject it. */
export async function metaClientInsightRow(accountId: string, since: string, until: string): Promise<{ row: import("./client-meta-metrics").MetaInsightRow | null; error: string | null }> {
  if (!/^act_\d{5,25}$/.test(accountId)) return { row: null, error: "Conta Meta inválida." };
  const time_range = JSON.stringify({ since, until });
  const [ins, res] = await Promise.all([
    gw("meta_ads", "META_ADS_API_KEY", `v26.0/${accountId}/insights`, { params: { level: "account", fields: "spend,reach,impressions,inline_link_clicks,actions", time_range } }),
    gw("meta_ads", "META_ADS_API_KEY", `v26.0/${accountId}/insights`, { params: { level: "account", fields: "results", time_range } }),
  ]);
  if (!ins.ok) return { row: null, error: adsFailureText("meta", ins) };
  const base = ins.body?.data?.[0] ?? { spend: "0", impressions: "0", inline_link_clicks: "0", actions: [] };
  const results = res.ok ? (res.body?.data?.[0]?.results ?? []) : undefined;
  return { row: { ...base, ...(results !== undefined ? { results } : {}) }, error: null };
}

/** Campaign-level spend/results of one Meta account (read-only, top 25 by spend). */
export async function metaCampaignRows(accountId: string, since: string, until: string): Promise<{ rows: { name: string; spend: number; impressions: number; reach: number; linkClicks: number; conversations: number | null; leads: number | null }[]; error: string | null }> {
  if (!/^act_\d{5,25}$/.test(accountId)) return { rows: [], error: "Conta Meta inválida." };
  const r = await gw("meta_ads", "META_ADS_API_KEY", `v26.0/${accountId}/insights`, { params: { level: "campaign", fields: "campaign_name,spend,impressions,reach,inline_link_clicks,actions", time_range: JSON.stringify({ since, until }), limit: "100" } });
  if (!r.ok) return { rows: [], error: adsFailureText("meta", r) };
  const act = (a: { action_type: string; value: string }[] | undefined, t: string) => a ? Number(a.find(x => x.action_type === t)?.value ?? 0) : null;
  const rows = ((r.body?.data ?? []) as any[]).map(x => ({ name: String(x.campaign_name ?? "").slice(0, 200), spend: Number(x.spend ?? 0), impressions: Number(x.impressions ?? 0), reach: Number(x.reach ?? 0), linkClicks: Number(x.inline_link_clicks ?? 0), conversations: act(x.actions, "onsite_conversion.messaging_conversation_started_7d"), leads: act(x.actions, "lead") }));
  return { rows: rows.sort((a, b) => b.spend - a.spend).slice(0, 25), error: null };
}
