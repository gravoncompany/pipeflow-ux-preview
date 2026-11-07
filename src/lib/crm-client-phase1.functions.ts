import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Fase 1 — Clientes: projetos, contas de anúncio do Portal, indicadores, relatório da Gravon IA e base de conhecimento.
// Toda leitura/escrita é por client_id, atrás do acesso completo ao CRM; nada de um cliente aparece em outro.
const uuid = z.string().uuid();
const periodInput = z.object({ clientId: uuid, preset: z.enum(["today", "yesterday", "last_7d", "last_30d", "this_month", "custom"]), since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const projectInput = z.object({
  id: uuid.nullable(), clientId: uuid, revision: z.number().int().min(0),
  name: z.string().trim().min(2).max(200), service: z.string().trim().max(300), responsible: z.string().trim().max(160),
  startDate: day, endDate: day, status: z.enum(["planejado", "em_andamento", "pausado", "concluido", "cancelado"]),
  objectives: z.string().trim().max(5000), strategicPlan: z.string().trim().max(20000),
}).strict().refine(v => !v.startDate || !v.endDate || v.endDate >= v.startDate, "A data final deve ser depois da inicial.");

async function session() {
  const { requireClientsSession, CLIENTS_ACTOR } = await import("./crm-clients.server");
  return { db: await requireClientsSession(), actor: CLIENTS_ACTOR };
}
async function clientExists(db: Awaited<ReturnType<typeof session>>["db"], id: string) {
  const r = await db.from("crm_clients").select("id").eq("id", id).maybeSingle();
  if (r.error || !r.data) throw new Error("Cliente indisponível.");
}

/** Dados da empresa já conhecidos no CRM (card + Prospecção B2B) para pré-preencher o cadastro do cliente. */
export const leadClientPrefill = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ leadIds: z.array(uuid).min(1).max(50) }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db } = await session();
    const [b2b, profile, clients] = await Promise.all([
      db.from("b2b_companies").select("lead_id,cnpj,profile").in("lead_id", data.leadIds),
      db.from("crm_profile").select("display_name").eq("company_key", "crm:1").maybeSingle(),
      db.from("crm_clients").select("id,cnpj,trade_name").neq("cnpj", "").limit(2000),
    ]);
    const byCnpj = new Map((clients.data ?? []).map(c => [c.cnpj as string, { id: c.id as string, name: c.trade_name as string }]));
    const out: Record<string, { legalName: string; cnpj: string; phone: string; address: string; email: string; website: string; tradeName: string; existingClient: { id: string; name: string } | null }> = {};
    for (const r of b2b.data ?? []) {
      const p = (r.profile ?? {}) as { legalName?: string; tradeName?: string; phones?: string[]; address?: string; emails?: string[]; website?: string };
      const cnpj = /^\d{14}$/.test(String(r.cnpj ?? "")) ? String(r.cnpj) : "";
      out[r.lead_id as string] = { legalName: p.legalName ?? "", tradeName: p.tradeName ?? "", cnpj, phone: p.phones?.[0] ?? "", address: p.address ?? "", email: p.emails?.[0] ?? "", website: p.website ?? "", existingClient: cnpj ? byCnpj.get(cnpj) ?? null : null };
    }
    return { prefill: out, responsible: String(profile.data?.display_name ?? "") };
  });

export const saveClientProject = createServerFn({ method: "POST" })
  .inputValidator(i => projectInput.parse(i))
  .handler(async ({ data }) => {
    const { db, actor } = await session();
    await clientExists(db, data.clientId);
    const row = { name: data.name, service: data.service, responsible: data.responsible, start_date: data.startDate, end_date: data.endDate, status: data.status, objectives: data.objectives, strategic_plan: data.strategicPlan, updated_at: new Date().toISOString() };
    if (!data.id) {
      const r = await db.from("crm_client_projects").insert({ ...row, client_id: data.clientId, created_by: actor }).select("id").single();
      if (r.error) throw new Error("Não foi possível criar o projeto.");
      await db.from("crm_client_records").insert({ client_id: data.clientId, kind: "observacao", description: `Projeto criado: ${data.name}${data.service ? ` (${data.service})` : ""}.`, author: actor });
      return { id: r.data.id as string };
    }
    const r = await db.from("crm_client_projects").update({ ...row, revision: data.revision + 1 }).eq("id", data.id).eq("client_id", data.clientId).eq("revision", data.revision).select("id");
    if (r.error || !r.data?.length) throw new Error("Este projeto foi alterado em outra tela. Atualize antes de salvar.");
    return { id: data.id };
  });

/** Projetos da Central de Projetos que podem ser vinculados (somente leitura; o original não muda). */
export const listLinkableProjects = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: uuid }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db } = await session();
    await clientExists(db, data.clientId);
    const [central, linked] = await Promise.all([
      db.from("crm_projects").select("id,name,status,responsible,objective").order("updated_at", { ascending: false }).limit(100),
      db.from("crm_client_projects").select("crm_project_id").eq("client_id", data.clientId).not("crm_project_id", "is", null),
    ]);
    const used = new Set((linked.data ?? []).map(r => r.crm_project_id as string));
    return { projects: (central.data ?? []).filter(p => !used.has(p.id as string)) as { id: string; name: string; status: string; responsible: string; objective: string }[] };
  });

export const linkExistingProject = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: uuid, projectId: uuid }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db, actor } = await session();
    await clientExists(db, data.clientId);
    const p = await db.from("crm_projects").select("id,name,objective,responsible,status").eq("id", data.projectId).maybeSingle();
    if (p.error || !p.data) throw new Error("Projeto indisponível.");
    const status = p.data.status === "concluido" ? "concluido" : p.data.status === "planejado" ? "planejado" : p.data.status === "bloqueado" ? "pausado" : "em_andamento";
    const r = await db.from("crm_client_projects").insert({ client_id: data.clientId, crm_project_id: p.data.id, name: String(p.data.name).slice(0, 200), objectives: String(p.data.objective ?? "").slice(0, 5000), responsible: String(p.data.responsible ?? "").slice(0, 160), status, created_by: actor }).select("id").single();
    if (r.error) throw new Error(r.error.message.includes("crm_client_projects_link") ? "Este projeto já está vinculado a este cliente." : "Não foi possível vincular o projeto.");
    return { id: r.data.id as string };
  });

/** Contas de anúncio vistas pelo Portal (Google Ads e Meta Ads) e a qual cliente cada uma pertence. */
export const listPortalAdAccounts = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: uuid }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db } = await session();
    await clientExists(db, data.clientId);
    const { from, today } = window30();
    const { readAgencyAds } = await import("./portal-ads.server");
    let accounts: { platform: string; account_id: string; account_name: string }[] = [], error: string | null = null;
    try { const v = await readAgencyAds(from, today); accounts = (v.payload?.accounts ?? []).map(a => ({ platform: a.platform, account_id: a.account_id, account_name: a.account_name })); error = v.error; }
    catch (e) { error = e instanceof Error ? e.message : "Portal indisponível."; }
    // Direct platform connections (Meta Ads / Google Ads) are merged with the Portal list; same account id = one row.
    const { metaStatus, googleStatus } = await import("./ads-platforms.server");
    const [meta, google] = await Promise.all([metaStatus().catch(() => null), googleStatus().catch(() => null)]);
    const sources = new Map<string, string[]>();
    for (const a of accounts) sources.set(`${a.platform}:${a.account_id}`, ["Portal"]);
    const add = (platform: string, id: string, name: string) => { const k = `${platform}:${id}`; if (sources.has(k)) sources.get(k)!.push("API"); else { sources.set(k, ["API"]); accounts.push({ platform, account_id: id, account_name: name }); } };
    // Meta: accounts added in Central de Integrações → Meta Ads; falls back to the live list while none were added.
    const reg = await db.from("crm_meta_ad_accounts").select("account_id,account_name,business_name");
    if (reg.data?.length) for (const a of reg.data) add("meta_ads", a.account_id, a.business_name ? `${a.account_name} · ${a.business_name}` : a.account_name);
    else for (const a of meta?.accounts ?? []) add("meta_ads", a.id, a.name);
    for (const a of (google?.accounts ?? []).filter(a => !a.manager)) add("google_ads", a.id, a.name);
    const apiStatus = { meta: meta?.connected ? null : (meta?.error ?? "Meta Ads indisponível."), google: google?.connected ? null : (google?.error ?? "Google Ads indisponível.") };
    const bound = await db.from("crm_client_ad_accounts").select("platform,account_id,client_id");
    const owner = new Map((bound.data ?? []).map(b => [`${b.platform}:${b.account_id}`, b.client_id as string]));
    return { error, apiStatus, accounts: accounts.map(a => ({ ...a, sources: sources.get(`${a.platform}:${a.account_id}`) ?? [], mine: owner.get(`${a.platform}:${a.account_id}`) === data.clientId, takenByOther: Boolean(owner.get(`${a.platform}:${a.account_id}`)) && owner.get(`${a.platform}:${a.account_id}`) !== data.clientId })) };
  });

export const setClientAdAccount = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: uuid, platform: z.enum(["meta_ads", "google_ads"]), accountId: z.string().trim().min(1).max(200), accountName: z.string().max(500), linked: z.boolean() }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db, actor } = await session();
    await clientExists(db, data.clientId);
    if (!data.linked) {
      const r = await db.from("crm_client_ad_accounts").delete().eq("client_id", data.clientId).eq("platform", data.platform).eq("account_id", data.accountId);
      if (r.error) throw new Error("Não foi possível desvincular a conta.");
      return { linked: false };
    }
    const r = await db.from("crm_client_ad_accounts").insert({ client_id: data.clientId, platform: data.platform, account_id: data.accountId, account_name: data.accountName, created_by: actor });
    if (r.error) throw new Error(r.error.code === "23505" ? "Esta conta já pertence a outro cliente." : "Não foi possível vincular a conta.");
    return { linked: true };
  });

function window30(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  return { today, from };
}

async function loadMetrics(db: Awaited<ReturnType<typeof session>>["db"], clientId: string) {
  const { from, today } = window30();
  const { clientCampaignMetrics } = await import("./crm-client-metrics");
  const [bound, metaAcc] = await Promise.all([
    db.from("crm_client_ad_accounts").select("platform,account_id").eq("client_id", clientId),
    db.from("meta_ads_spend_accounts").select("ad_account_id,last_sync_at").eq("owner_kind", "client").eq("client_id", clientId).eq("active", true),
  ]);
  const metaIds = (metaAcc.data ?? []).map(a => a.ad_account_id as string);
  let metaRows: { ad_account_id: string; spend_date: string; spend_cents: number; currency: string }[] = [];
  if (metaIds.length) {
    const r = await db.from("meta_ads_spend_daily").select("ad_account_id,spend_date,spend_cents,currency").in("ad_account_id", metaIds).gte("spend_date", from).lte("spend_date", today).limit(5000);
    metaRows = (r.data ?? []) as typeof metaRows;
  }
  let portalRows: import("./portal-ads").AdsRow[] = [], portalUpdatedAt: string | null = null, portalError: string | null = null;
  if ((bound.data ?? []).length) {
    const { readAgencyAds } = await import("./portal-ads.server");
    try { const v = await readAgencyAds(from, today); portalRows = v.payload?.rows ?? []; portalUpdatedAt = v.succeededAt; portalError = v.error; }
    catch (e) { portalError = e instanceof Error ? e.message : "Portal indisponível."; }
  }
  const metaUpdatedAt = (metaAcc.data ?? []).map(a => a.last_sync_at as string | null).filter(Boolean).sort().at(-1) ?? null;
  const metrics = clientCampaignMetrics({ bound: (bound.data ?? []) as { platform: "meta_ads" | "google_ads"; account_id: string }[], portalRows, portalUpdatedAt, metaRows, metaAccounts: metaIds, metaUpdatedAt, today, from });
  return { metrics, portalError, period: { from, today }, boundAccounts: bound.data ?? [] };
}

/** Indicadores de campanhas do cliente (Portal + API da Meta já existentes, sem nova integração). */
export const getClientCampaignMetrics = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: uuid }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db } = await session();
    await clientExists(db, data.clientId);
    return loadMetrics(db, data.clientId);
  });

/** Relatório da Gravon IA: analisa só os dados disponíveis e guarda no conhecimento do cliente. */
/** Relatório da Pipeflow IA: mesmos dados e período dos cards de Campanhas (Meta Ads ao vivo das contas do cliente), com comparação ao período anterior. Portal não entra. */
export const generateClientAiReport = createServerFn({ method: "POST" })
  .inputValidator(i => periodInput.parse(i))
  .handler(async ({ data }) => {
    const { db, actor } = await session();
    const c = await db.from("crm_clients").select("trade_name,legal_name,status,services,relationship_start").eq("id", data.clientId).maybeSingle();
    if (!c.data) throw new Error("Cliente indisponível.");
    const { periodRange, previousRange, META_CARD_METRICS } = await import("./client-meta-metrics");
    const range = periodRange(data.preset, new Date(), data.since && data.until ? { since: data.since, until: data.until } : undefined);
    if (range.since > range.until) throw new Error("Período inválido.");
    const prev = previousRange(range);
    const [projects, cur, before] = await Promise.all([
      db.from("crm_client_projects").select("name,service,status,start_date,end_date,objectives").eq("client_id", data.clientId).limit(30),
      loadMetaCards(db, data.clientId, range),
      loadMetaCards(db, data.clientId, prev),
    ]);
    const { metaCampaignRows } = await import("./ads-platforms.server");
    const campaigns = cur.accounts.length && !cur.errors.length ? await Promise.all(cur.accounts.map(a => metaCampaignRows(actId(a.id), range.since, range.until))) : [];
    const label = (k: string) => META_CARD_METRICS.find(m => m.key === k)!;
    const performance = {
      source: "Meta Ads (API, contas vinculadas ao cliente)", fetchedAt: cur.fetchedAt, range, previousRange: prev,
      accounts: cur.accounts, errors: cur.errors, previousErrors: before.errors,
      cards: cur.selected.map(k => ({ key: k, label: label(k).label, kind: label(k).kind, value: cur.metrics?.[k] ?? null, previous: before.metrics?.[k] ?? null })),
    };
    const { generateClientReport } = await import("./ai/client-report.server");
    const report = await generateClientReport({
      cliente: { nome: c.data.trade_name || c.data.legal_name, situacao: c.data.status, servicos_segmento: c.data.services, inicio_relacionamento: c.data.relationship_start },
      projetos: projects.data ?? [],
      periodo: range, periodoAnterior: prev, fonte: performance.source,
      indicadoresSelecionados: performance.cards,
      todasMetricasPeriodo: cur.metrics, todasMetricasPeriodoAnterior: before.metrics,
      campanhas: campaigns.flatMap(r => r.rows), falhasConsulta: [...cur.errors, ...before.errors.map(e => `Período anterior — ${e}`), ...campaigns.flatMap(r => r.error ? [r.error] : [])],
    });
    const text = JSON.stringify({ ...report, performance, client: { name: c.data.trade_name || c.data.legal_name, status: c.data.status, services: c.data.services } });
    await db.from("crm_client_knowledge").insert({ client_id: data.clientId, kind: "relatorio_ia", title: `Relatório da Pipeflow IA — ${range.since} a ${range.until}`, text, source: "Pipeflow IA (Meta Ads ao vivo)", created_by: actor });
    return { report, performance, createdAt: new Date().toISOString() };
  });

/** Base de conhecimento organizada do cliente (para uso futuro pela Gravon IA no WhatsApp; nenhuma resposta automática). */
export const getClientKnowledgeBase = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: uuid }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db } = await session();
    const c = await db.from("crm_clients").select("*").eq("id", data.clientId).maybeSingle();
    if (!c.data) throw new Error("Cliente indisponível.");
    const [projects, documents, plans, records, knowledge] = await Promise.all([
      db.from("crm_client_projects").select("name,service,status,objectives,strategic_plan").eq("client_id", data.clientId).limit(50),
      db.from("crm_client_documents").select("name,category,ai_authorized").eq("client_id", data.clientId).limit(200),
      db.from("crm_client_plans").select("title,status").eq("client_id", data.clientId).limit(20),
      db.from("crm_client_records").select("kind,description,created_at").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(50),
      db.from("crm_client_knowledge").select("kind,title,text").eq("client_id", data.clientId).limit(200),
    ]);
    const m = await loadMetrics(db, data.clientId).catch(() => null);
    const { clientKnowledgeSections } = await import("./crm-client-metrics");
    return { sections: clientKnowledgeSections({ client: c.data, projects: (projects.data ?? []) as never, documents: (documents.data ?? []) as never, plans: (plans.data ?? []) as never, records: (records.data ?? []) as never, knowledge: (knowledge.data ?? []) as never, metrics: m?.metrics ?? null }), whatsappEnabled: false };
  });

/** Read-only metrics straight from Meta Ads / Google Ads for one account linked to this client. */
export const getClientAdAccountMetrics = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: uuid, platform: z.enum(["meta_ads", "google_ads"]), accountId: z.string().min(3).max(40), since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db } = await session();
    const link = await db.from("crm_client_ad_accounts").select("id").eq("client_id", data.clientId).eq("platform", data.platform).eq("account_id", data.accountId).maybeSingle();
    if (link.error || !link.data) throw new Error("Esta conta não está vinculada a este cliente.");
    if (data.since > data.until) throw new Error("Período inválido.");
    const m = await import("./ads-platforms.server");
    return data.platform === "meta_ads" ? m.metaMetrics(data.accountId, data.since, data.until) : m.googleMetrics(data.accountId, data.since, data.until);
  });
export const listClientLinkedAdAccounts = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: uuid }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db } = await session();
    const r = await db.from("crm_client_ad_accounts").select("platform,account_id,account_name").eq("client_id", data.clientId).order("platform");
    if (r.error) throw new Error("Não foi possível ler as contas vinculadas.");
    return r.data as { platform: "meta_ads" | "google_ads"; account_id: string; account_name: string }[];
  });

/** Campanhas cards: only the Meta accounts linked to this client, read live from the Meta API (never Portal snapshots). */
type Db = Awaited<ReturnType<typeof session>>["db"];
/** Single source for the client's Campanhas cards and the AI report: live Meta API reads of the accounts linked to this client. */
async function loadMetaCards(db: Db, clientId: string, range: { since: string; until: string }) {
  const { aggregateMetaInsights, DEFAULT_CARD_METRICS, isCardKey } = await import("./client-meta-metrics");
  const [links, prefs] = await Promise.all([
    db.from("crm_client_ad_accounts").select("account_id,account_name").eq("client_id", clientId).eq("platform", "meta_ads"),
    db.from("crm_client_metric_prefs").select("metrics").eq("client_id", clientId).maybeSingle(),
  ]);
  if (links.error) throw new Error("Não foi possível ler as contas vinculadas.");
  const sel = Array.isArray(prefs.data?.metrics) ? (prefs.data!.metrics as string[]).filter(isCardKey) : [];
  const selected = sel.length ? sel : DEFAULT_CARD_METRICS;
  const accounts = (links.data ?? []) as { account_id: string; account_name: string }[];
  if (!accounts.length) return { range, accounts: [] as { id: string; name: string }[], metrics: null, errors: [] as string[], selected, fetchedAt: new Date().toISOString() };
  const { metaClientInsightRow } = await import("./ads-platforms.server");
  const rows = await Promise.all(accounts.map(a => metaClientInsightRow(actId(a.account_id), range.since, range.until)));
  const errors = rows.flatMap((r, i) => r.error ? [`${accounts[i].account_name || accounts[i].account_id}: ${r.error}`] : []);
  // Partial failures leave totals unavailable instead of under-reporting.
  const metrics = errors.length ? null : aggregateMetaInsights(rows.map(r => r.row), accounts.length);
  return { range, accounts: accounts.map(a => ({ id: a.account_id, name: a.account_name })), metrics, errors, selected, fetchedAt: new Date().toISOString() };
}
const actId = (id: string) => id.startsWith("act_") ? id : `act_${id}`;

/** Campanhas cards: only the Meta accounts linked to this client, read live from the Meta API (never Portal snapshots). */
export const getClientMetaCards = createServerFn({ method: "POST" })
  .inputValidator(i => periodInput.parse(i))
  .handler(async ({ data }) => {
    const { db } = await session();
    await clientExists(db, data.clientId);
    const { periodRange } = await import("./client-meta-metrics");
    const range = periodRange(data.preset, new Date(), data.since && data.until ? { since: data.since, until: data.until } : undefined);
    if (range.since > range.until) throw new Error("Período inválido.");
    return loadMetaCards(db, data.clientId, range);
  });
export const saveClientMetaCards = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: uuid, metrics: z.array(z.string()).min(1).max(12) }).strict().parse(i))
  .handler(async ({ data }) => {
    const { db } = await session();
    await clientExists(db, data.clientId);
    const { isCardKey } = await import("./client-meta-metrics");
    const metrics = [...new Set(data.metrics)].filter(isCardKey);
    if (!metrics.length) throw new Error("Escolha ao menos um indicador.");
    const r = await db.from("crm_client_metric_prefs").upsert({ client_id: data.clientId, metrics, updated_at: new Date().toISOString() });
    if (r.error) throw new Error("Não foi possível salvar os indicadores.");
    return { ok: true, metrics };
  });
