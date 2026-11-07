import { z } from "zod";
import { requireB2bAccess, b2bDb } from "./b2b-prospecting.server";
import {
  applySiteScan,
  dedupeProfiles,
  extractContacts,
  igAiResponse,
  igProfileUrl,
  postAuthor,
  apifyHashtagInput, apifyDatasetSeeds,
  IG_AI_PROMPT,
  type ApifyPost,
  type IgProfileSeed,
  type InstagramProfile,
  type InstagramSearchRow,
  type InstagramSearchInput,
} from "./b2b-instagram";

const ACTOR = "apify~instagram-scraper";
const APIFY_BASE = "https://api.apify.com/v2";
const DAILY_LIMIT = 10;
/** Análise IA em lotes de 10 perfis, no máximo 5 lotes por pesquisa (custo limitado). */
const AI_BATCH = 10;
const AI_MAX_BATCHES = 5;

export class ApifyError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Credencial Bearer da integração custom "Apify - Instagram Scraper"; nunca sai do servidor. */
async function apifyToken(): Promise<string> {
  const db = await b2bDb();
  const { data, error } = await db
    .from("crm_external_integrations")
    .select("id,base_url,auth_method,encrypted_credentials")
    .eq("provider", "custom")
    .ilike("name", "Apify - Instagram Scraper")
    .maybeSingle();
  if (error || !data) throw new ApifyError("not_configured", "Cadastre a integração “Apify - Instagram Scraper” em Configurações → Integrações.");
  if (data.auth_method !== "bearer" || !data.encrypted_credentials)
    throw new ApifyError("not_configured", "A integração Apify precisa de um token Bearer salvo.");
  if (String(data.base_url ?? "").replace(/\/+$/, "") !== APIFY_BASE)
    throw new ApifyError("not_configured", "A URL da integração Apify não é a API oficial esperada.");
  const key = process.env["INTEGRATIONS_ENCRYPTION_KEY"];
  if (!key) throw new ApifyError("not_configured", "Chave de proteção das credenciais ausente no servidor.");
  const { decryptInstagramToken } = await import("./instagram-oauth-crypto.server");
  return decryptInstagramToken(String(data.encrypted_credentials), key, `external-integration:custom:${data.id}`);
}

async function apifyFetch(token: string, path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${APIFY_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ApifyError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network", "A Apify não respondeu a tempo. Tente novamente.");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 401 || res.status === 403) throw new ApifyError(`http_${res.status}`, "O token da Apify foi recusado. Revise a credencial da integração.");
    if (res.status === 402) throw new ApifyError("http_402", "A conta Apify está sem créditos disponíveis.");
    if (res.status === 429) throw new ApifyError("http_429", "A Apify pediu para aguardar. Tente novamente em alguns minutos.");
    throw new ApifyError(`http_${res.status}`, `A Apify recusou a consulta (HTTP ${res.status}).`);
  }
  return res.json();
}

type RunRef = { hashtag: string; runId: string; datasetId: string; status: string };

function mapSearch(row: Record<string, unknown>): InstagramSearchRow {
  return {
    id: String(row.id),
    hashtags: (row.hashtags as string[]) ?? [],
    resultsLimit: Number(row.results_limit),
    status: row.status as InstagramSearchRow["status"],
    stage: (row.stage as InstagramSearchRow["stage"]) ?? "publicacoes",
    runs: z
      .array(z.object({ hashtag: z.string(), runId: z.string(), datasetId: z.string(), status: z.string() }).strict())
      .catch([])
      .parse(row.runs ?? []),
    postsFound: Number(row.posts_found ?? 0),
    profilesFound: Number(row.profiles_found ?? 0),
    error: String(row.error ?? ""),
    createdAt: String(row.created_at),
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

export async function instagramStatus() {
  await requireB2bAccess();
  try {
    await apifyToken();
    return { configured: true };
  } catch (e) {
    if (e instanceof ApifyError && e.code === "not_configured") return { configured: false };
    throw e;
  }
}

export async function listSearches(): Promise<InstagramSearchRow[]> {
  await requireB2bAccess();
  const db = await b2bDb();
  const { data, error } = await db
    .from("b2b_instagram_searches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("O histórico de pesquisas do Instagram ainda não está disponível.");
  return (data ?? []).map((r) => mapSearch(r as Record<string, unknown>));
}

/** Inicia a pesquisa: uma execução do Instagram Scraper por hashtag, com confirmação e limite diário. */
export async function startSearch(input: InstagramSearchInput): Promise<{ searchId: string; reuse?: InstagramSearchRow }> {
  await requireB2bAccess();
  const db = await b2bDb();
  if (!input.forceNew) {
    const day = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: recent } = await db
      .from("b2b_instagram_searches")
      .select("*")
      .eq("status", "succeeded")
      .eq("results_limit", input.resultsLimit)
      .gte("created_at", day)
      .order("created_at", { ascending: false })
      .limit(20);
    const same = (recent ?? []).find(
      (r) => JSON.stringify([...(r.hashtags as string[])].sort()) === JSON.stringify([...input.hashtags].sort()),
    );
    if (same) return { searchId: "", reuse: mapSearch(same as Record<string, unknown>) };
  }
  const { data: running } = await db
    .from("b2b_instagram_searches")
    .select("id,hashtags")
    .eq("status", "running")
    .limit(5);
  const overlap = (running ?? []).find((r) => (r.hashtags as string[]).some((h) => input.hashtags.includes(h)));
  if (overlap) throw new ApifyError("already_running", "Já existe uma pesquisa em andamento com uma dessas hashtags. Aguarde ou cancele.");

  const { metered } = await import("./b2b-prospecting.server");
  const token = await apifyToken();
  const search = await metered("apify", async () => {
    const runs: RunRef[] = [];
    for (const hashtag of input.hashtags) {
      const started = (await apifyFetch(token, `/acts/${ACTOR}/runs`, {
        method: "POST",
        body: JSON.stringify(apifyHashtagInput(hashtag, input.resultsLimit)),
      })) as { data?: { id?: unknown; defaultDatasetId?: unknown; status?: unknown } };
      const runId = String(started.data?.id ?? "");
      const datasetId = String(started.data?.defaultDatasetId ?? "");
      if (!runId || !datasetId) throw new ApifyError("invalid_response", "A Apify não retornou o identificador da execução.");
      runs.push({ hashtag, runId, datasetId, status: String(started.data?.status ?? "RUNNING") });
    }
    const { data, error } = await db
      .from("b2b_instagram_searches")
      .insert({ hashtags: input.hashtags, results_limit: input.resultsLimit, runs, status: "running" })
      .select("id")
      .single();
    if (error || !data) {
      // Sem o registro não há como acompanhar/cancelar: interrompe as execuções iniciadas.
      await Promise.allSettled(runs.map((r) => apifyFetch(token, `/actor-runs/${r.runId}/abort`, { method: "POST" })));
      throw new Error("A pesquisa foi iniciada na Apify, mas o acompanhamento falhou. As execuções foram interrompidas.");
    }
    return { id: data.id as string, runs };
  });
  return { searchId: search.id };
}

const TERMINAL_OK = new Set(["SUCCEEDED"]);
const TERMINAL_FAIL = new Set(["FAILED", "ABORTED", "TIMED-OUT"]);

/** Acompanha as execuções e, quando concluídas, recupera os posts, deduplica perfis e roda a análise IA. */
export async function syncSearch(searchId: string): Promise<InstagramSearchRow> {
  await requireB2bAccess();
  const db = await b2bDb();
  const { data: row, error } = await db.from("b2b_instagram_searches").select("*").eq("id", searchId).maybeSingle();
  if (error || !row) throw new Error("Pesquisa não encontrada.");
  const search = mapSearch(row as Record<string, unknown>);
  if (search.status !== "running") return search;

  const token = await apifyToken();
  const runs: RunRef[] = [];
  for (const run of search.runs) {
    if (TERMINAL_OK.has(run.status) || TERMINAL_FAIL.has(run.status)) {
      runs.push(run);
      continue;
    }
    const info = (await apifyFetch(token, `/actor-runs/${run.runId}`)) as { data?: { status?: unknown } };
    runs.push({ ...run, status: String(info.data?.status ?? run.status) });
  }
  const failed = runs.filter((r) => TERMINAL_FAIL.has(r.status));
  if (failed.length) {
    await finish(db, search.id, { status: "failed", runs, error: `A execução da hashtag #${failed[0].hashtag} não foi concluída pela Apify.` });
    return { ...search, status: "failed", runs };
  }
  if (!runs.every((r) => TERMINAL_OK.has(r.status))) {
    await db.from("b2b_instagram_searches").update({ runs, updated_at: new Date().toISOString() }).eq("id", searchId);
    return { ...search, runs };
  }

  // Todas concluídas: recupera os resultados (leitura do dataset não cobra nova execução).
  const seeds: IgProfileSeed[] = [];
  let posts = 0;
  let datasetFailures = 0, unrecognized = 0;
  for (const run of runs) {
    const items = await apifyFetch(token, `/datasets/${run.datasetId}/items?clean=true&limit=500`);
    const parsed = apifyDatasetSeeds(items, run.hashtag);
    posts += parsed.items; datasetFailures += parsed.failures; unrecognized += parsed.unrecognized;
    seeds.push(...parsed.seeds);
  }
  const unique = dedupeProfiles(seeds);
  if (!unique.length) {
    const error = datasetFailures ? `A Apify retornou ${datasetFailures} item(ns) de erro no dataset; nenhum perfil identificado.` : posts ? `A Apify retornou ${posts} item(ns), mas nenhum autor de publicação válido foi identificado (${unrecognized} não reconhecidos).` : 'A execução terminou sem publicações no dataset para as hashtags escolhidas.';
    const status = posts ? 'failed' as const : 'succeeded' as const;
    await finish(db, search.id, { status, runs, posts_found: posts, profiles_found: 0, error });
    return { ...search, status, runs, postsFound: posts, profilesFound: 0, error, finishedAt: new Date().toISOString() };
  }

  for (const seed of unique) {
    const contacts = extractContacts(seed.captionSample, "");
    const saved = await db.from("b2b_instagram_profiles").upsert(
      {
        search_id: searchId,
        username: seed.username,
        ig_user_id: seed.igUserId,
        full_name: seed.fullName,
        hashtag: seed.hashtag,
        post_url: seed.postUrl,
        city: seed.locationName,
        email: contacts.email,
        phone: contacts.phone,
        whatsapp: contacts.whatsapp,
      },
      { onConflict: "search_id,username" },
    );
    if (saved.error) {
      const error = 'A Apify retornou perfis, mas o Pipeflow não conseguiu armazená-los. Nenhuma nova execução foi iniciada.';
      await finish(db, search.id, { status: 'failed', runs, posts_found: posts, profiles_found: 0, error });
      return { ...search, status: 'failed', runs, postsFound: posts, profilesFound: 0, error };
    }
  }

  await db.from("b2b_instagram_searches").update({ stage: "perfis", updated_at: new Date().toISOString() }).eq("id", searchId);
  await enrichProfiles(db, token, searchId, unique);
  await db.from("b2b_instagram_searches").update({ stage: "sites", updated_at: new Date().toISOString() }).eq("id", searchId);
  await investigateSites(db, searchId);
  await db.from("b2b_instagram_searches").update({ stage: "ia", updated_at: new Date().toISOString() }).eq("id", searchId);
  await analyzeWithAi(db, searchId);
  await finish(db, searchId, { status: "succeeded", stage: "concluido", runs, posts_found: posts, profiles_found: unique.length });
  return { ...search, status: "succeeded", runs, postsFound: posts, profilesFound: unique.length, finishedAt: new Date().toISOString() };
}

async function finish(db: Awaited<ReturnType<typeof b2bDb>>, id: string, patch: Record<string, unknown>) {
  await db
    .from("b2b_instagram_searches")
    .update({ ...patch, updated_at: new Date().toISOString(), finished_at: new Date().toISOString() })
    .eq("id", id);
}

/** Segunda etapa: detalhes dos perfis únicos (biografia, site, categoria) em UMA execução adicional, dentro da reserva diária. */
async function enrichProfiles(db: Awaited<ReturnType<typeof b2bDb>>, token: string, searchId: string, seeds: IgProfileSeed[]) {
  if (!seeds.length) return;
  const directUrls = seeds.map((s) => igProfileUrl(s.username)).filter(Boolean);
  if (!directUrls.length) return;
  try {
    const { metered } = await import("./b2b-prospecting.server");
    const started = await metered("apify", () =>
      apifyFetch(token, `/acts/${ACTOR}/runs`, {
        method: "POST",
        body: JSON.stringify({ directUrls, resultsType: "details", resultsLimit: directUrls.length }),
      }) as Promise<{ data?: { id?: unknown; defaultDatasetId?: unknown } }>,
    );
    const runId = String(started.data?.id ?? "");
    const datasetId = String(started.data?.defaultDatasetId ?? "");
    if (!runId || !datasetId) return;
    // Detalhes levam poucos segundos por perfil; aguarda de forma limitada e desiste sem repetir.
    const deadline = Date.now() + 120_000;
    let status = "RUNNING";
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      const info = (await apifyFetch(token, `/actor-runs/${runId}`)) as { data?: { status?: unknown } };
      status = String(info.data?.status ?? "RUNNING");
      if (TERMINAL_OK.has(status) || TERMINAL_FAIL.has(status)) break;
    }
    if (!TERMINAL_OK.has(status)) return;
    const items = (await apifyFetch(token, `/datasets/${datasetId}/items?clean=true&limit=500`)) as Record<string, unknown>[];
    for (const item of Array.isArray(items) ? items : []) {
      const username = typeof item.username === "string" ? item.username.trim().toLowerCase() : "";
      if (!username) continue;
      const biography = typeof item.biography === "string" ? item.biography.slice(0, 2000) : "";
      const externalUrl = typeof item.externalUrl === "string" ? item.externalUrl : "";
      const contacts = extractContacts(biography, externalUrl);
      await db
        .from("b2b_instagram_profiles")
        .update({
          full_name: typeof item.fullName === "string" ? item.fullName.slice(0, 200) : undefined,
          biography,
          category: typeof item.businessCategoryName === "string" ? item.businessCategoryName.slice(0, 120) : "",
          external_url: contacts.website,
          contact_sources: ["email", "phone", "whatsapp"].flatMap(field => {
            const value = contacts[field as "email" | "phone" | "whatsapp"];
            return value ? [{ field, value, url: field === "whatsapp" && externalUrl ? externalUrl : igProfileUrl(username), method: "instagram" }] : [];
          }),
          email: contacts.email || undefined,
          phone: contacts.phone || undefined,
          whatsapp: contacts.whatsapp || undefined,
          followers: typeof item.followersCount === "number" ? Math.max(0, Math.floor(item.followersCount)) : null,
          is_business: typeof item.isBusinessAccount === "boolean" ? item.isBusinessAccount : null,
          enrichment: "perfil",
        })
        .eq("search_id", searchId)
        .eq("username", username);
    }
  } catch {
    // Enriquecimento é opcional: os perfis dos posts permanecem disponíveis sem biografia.
  }
}

/**
 * Terceira etapa (gratuita, sem Apify): lê as páginas públicas do site declarado no próprio perfil
 * (home + contato/sobre, respeitando robots.txt) e preenche somente campos ainda vazios.
 * O site investigado é sempre o endereço que a própria empresa publicou no perfil — agregadores
 * de links e redes sociais são recusados por safeSiteUrl, então contatos de terceiros não entram.
 */
async function investigateSites(db: Awaited<ReturnType<typeof b2bDb>>, searchId: string) {
  const { data } = await db
    .from("b2b_instagram_profiles")
    .select("id,external_url,email,phone,whatsapp,cnpj,address,enrichment")
    .eq("search_id", searchId)
    .in("enrichment", ["perfil", "pendente"])
    .limit(30);
  const list = (data ?? []) as Record<string, unknown>[];
  if (!list.length) return;
  const { scanOfficialSite } = await import("./b2b-public-enrichment.server");
  for (const profile of list) {
    const site = String(profile.external_url ?? "");
    if (!site) {
      await db.from("b2b_instagram_profiles").update({ enrichment: "concluido" }).eq("id", profile.id as string);
      continue;
    }
    try {
      const scan = await scanOfficialSite(site);
      if (!scan || scan.blocked) {
        await db.from("b2b_instagram_profiles").update({ enrichment: "falhou" }).eq("id", profile.id as string);
        continue;
      }
      const patch = applySiteScan(
        {
          email: String(profile.email ?? ""),
          phone: String(profile.phone ?? ""),
          whatsapp: String(profile.whatsapp ?? ""),
          cnpj: String(profile.cnpj ?? ""),
          address: String(profile.address ?? ""),
        },
        scan,
      );
      await db
        .from("b2b_instagram_profiles")
        .update({ ...patch, enrichment: "site" })
        .eq("id", profile.id as string);
    } catch {
      await db.from("b2b_instagram_profiles").update({ enrichment: "falhou" }).eq("id", profile.id as string);
    }
  }
}

/** Análise Pipeflow IA: classifica segmento, localização, relevância e perfil comercial. Sem inventar dados. */
async function analyzeWithAi(db: Awaited<ReturnType<typeof b2bDb>>, searchId: string) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return;
  const { data: profiles } = await db
    .from("b2b_instagram_profiles")
    .select("id,username,full_name,biography,category,external_url,city,post_url,email,phone,whatsapp,cnpj")
    .eq("search_id", searchId)
    .is("analyzed_at", null)
    .limit(AI_BATCH * AI_MAX_BATCHES);
  const list = (profiles ?? []) as Record<string, unknown>[];
  if (!list.length) return;

  const { createOpenAI } = await import("@ai-sdk/openai");
  const { generateText, Output, jsonSchema } = await import("ai");
  const schema = jsonSchema({
    type: "object",
    properties: {
      profiles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            username: { type: "string" },
            segment: { type: "string" },
            location: { type: "string" },
            country: { type: "string" },
            relevance: { type: "string", enum: ["alta", "media", "baixa"] },
            commercial: { type: "boolean" },
            summary: { type: "string" },
          },
          required: ["username", "segment", "location", "country", "relevance", "commercial", "summary"],
          additionalProperties: false,
        },
      },
    },
    required: ["profiles"],
    additionalProperties: false,
  });
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });

  for (let i = 0; i < list.length; i += AI_BATCH) {
    const batch = list.slice(i, i + AI_BATCH);
    try {
      const result = await generateText({
        model: provider.responses("openai/gpt-6-astra"),
        instructions: IG_AI_PROMPT,
        prompt: JSON.stringify(
          batch.map((p) => ({
            username: p.username,
            nome: p.full_name,
            biografia: String(p.biography ?? "").slice(0, 1000),
            categoria: p.category,
            site: p.external_url,
            localizacaoDoPost: p.city,
            contatosEncontrados: {
              email: Boolean(p.email),
              telefone: Boolean(p.phone),
              whatsapp: Boolean(p.whatsapp),
              cnpj: Boolean(p.cnpj),
            },
          })),
        ),
        output: Output.object({ schema }),
        maxRetries: 0,
      });
      const parsed = igAiResponse.safeParse(result.output);
      if (!parsed.success) continue;
      const byUsername = new Map(parsed.data.profiles.map((p) => [p.username.toLowerCase(), p]));
      for (const profile of batch) {
        const ai = byUsername.get(String(profile.username).toLowerCase());
        if (!ai) continue;
        const location = ai.location.trim();
        const stateMatch = location.match(/\b([A-Z]{2})\b/);
        await db
          .from("b2b_instagram_profiles")
          .update({
            ai_segment: ai.segment.trim().slice(0, 120),
            ai_location: location.slice(0, 120),
            ai_relevance: ai.relevance,
            ai_commercial: ai.commercial,
            ai_summary: ai.summary.trim().slice(0, 400),
            country: ai.country.trim().slice(0, 60),
            city: location ? location.split(/[/-]/)[0]?.trim().slice(0, 100) || String(profile.city ?? "") : String(profile.city ?? ""),
            state: stateMatch && stateMatch[1] ? stateMatch[1] : "",
            analyzed_at: new Date().toISOString(),
          })
          .eq("id", profile.id as string);
      }
    } catch {
      // Falha da IA não derruba a pesquisa: perfis ficam sem análise e podem ser reanalisados depois.
      continue;
    }
  }
}

export async function cancelSearch(searchId: string): Promise<{ ok: true }> {
  await requireB2bAccess();
  const db = await b2bDb();
  const { data: row, error } = await db.from("b2b_instagram_searches").select("*").eq("id", searchId).maybeSingle();
  if (error || !row) throw new Error("Pesquisa não encontrada.");
  const search = mapSearch(row as Record<string, unknown>);
  if (search.status === "running") {
    const token = await apifyToken().catch(() => "");
    if (token) {
      await Promise.allSettled(
        search.runs
          .filter((r) => !TERMINAL_OK.has(r.status) && !TERMINAL_FAIL.has(r.status))
          .map((r) => apifyFetch(token, `/actor-runs/${r.runId}/abort`, { method: "POST" })),
      );
    }
    await finish(db, searchId, { status: "canceled" });
  }
  return { ok: true };
}

export async function listResults(searchId: string): Promise<{ search: InstagramSearchRow; profiles: InstagramProfile[] }> {
  await requireB2bAccess();
  const db = await b2bDb();
  const { data: row, error } = await db.from("b2b_instagram_searches").select("*").eq("id", searchId).maybeSingle();
  if (error || !row) throw new Error("Pesquisa não encontrada.");
  const { data, error: pError } = await db
    .from("b2b_instagram_profiles")
    .select("*")
    .eq("search_id", searchId)
    .order("followers", { ascending: false, nullsFirst: false })
    .limit(500);
  if (pError) throw new Error("Não foi possível ler os resultados.");
  const rows = (data ?? []) as Record<string, unknown>[];

  // Marca perfis já cadastrados no CRM (empresa B2B ou lead com o mesmo Instagram).
  const urls = rows.map((r) => igProfileUrl(String(r.username))).filter(Boolean);
  const [companies, leads] = await Promise.all([
    urls.length
      ? db.from("b2b_companies").select("profile").limit(1000)
      : Promise.resolve({ data: [] as unknown[] }),
    urls.length ? db.from("leads").select("instagram").neq("instagram", "").limit(5000) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const known = new Set<string>();
  for (const c of (companies.data ?? []) as { profile?: unknown }[]) {
    const ig = (c.profile as { instagram?: unknown } | null)?.instagram;
    if (typeof ig === "string") known.add(ig.toLowerCase());
  }
  for (const l of (leads.data ?? []) as { instagram?: unknown }[]) {
    if (typeof l.instagram === "string" && l.instagram) known.add(l.instagram.toLowerCase());
  }

  return {
    search: mapSearch(row as Record<string, unknown>),
    profiles: rows.map((r) => {
      const url = igProfileUrl(String(r.username));
      return {
        id: String(r.id),
        username: String(r.username),
        igUserId: String(r.ig_user_id ?? ""),
        fullName: String(r.full_name ?? ""),
        biography: String(r.biography ?? ""),
        category: String(r.category ?? ""),
        externalUrl: String(r.external_url ?? ""),
        email: String(r.email ?? ""),
        phone: String(r.phone ?? ""),
        whatsapp: String(r.whatsapp ?? ""),
        address: String(r.address ?? ""),
        country: String(r.country ?? ""),
        cnpj: String(r.cnpj ?? ""),
        city: String(r.city ?? ""),
        state: String(r.state ?? ""),
        enrichment: (r.enrichment as InstagramProfile["enrichment"]) ?? "pendente",
        contactSources: Array.isArray(r.contact_sources) ? r.contact_sources : [],
        publicCheckedAt: typeof r.public_checked_at === "string" ? r.public_checked_at : null,
        hashtag: String(r.hashtag ?? ""),
        postUrl: String(r.post_url ?? ""),
        followers: typeof r.followers === "number" ? r.followers : null,
        isBusiness: typeof r.is_business === "boolean" ? r.is_business : null,
        aiSegment: String(r.ai_segment ?? ""),
        aiLocation: String(r.ai_location ?? ""),
        aiRelevance: String(r.ai_relevance ?? ""),
        aiCommercial: typeof r.ai_commercial === "boolean" ? r.ai_commercial : null,
        aiSummary: String(r.ai_summary ?? ""),
        analyzedAt: (r.analyzed_at as string | null) ?? null,
        inCrm: known.has(url.toLowerCase()),
      };
    }),
  };
}
