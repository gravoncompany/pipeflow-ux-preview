import { b2bDb } from "./b2b-prospecting.server";
import { receitaRow, type ReceitaRow, type ReceitaSearch } from "./receita-federal";

const BASE = "https://cnpj.gravoncompany.com";
const ENDPOINT = "/estabelecimentos_sc";
const COLUMNS = "cnpj,razao_social,nome_fantasia,cnae_principal,situacao_cadastral,municipio_codigo,municipio,uf,endereco,cep,telefone,email,porte,data_abertura";

/** Basic Auth credential of the saved custom integration "Receita Federal - CNPJ"; never leaves the server. */
async function authorization(): Promise<string> {
  const db = await b2bDb();
  const { data, error } = await db.from("crm_external_integrations")
    .select("id,base_url,auth_method,status,encrypted_credentials")
    .eq("provider", "custom").ilike("name", "Receita Federal - CNPJ").maybeSingle();
  if (error || !data) throw new Error("Integração “Receita Federal - CNPJ” não encontrada em Integrações → APIs Externas.");
  if (data.status !== "ativa") throw new Error("A integração Receita Federal está desativada em Integrações → APIs Externas.");
  if (data.auth_method !== "basic" || !data.encrypted_credentials || String(data.base_url ?? "").replace(/\/+$/, "") !== BASE)
    throw new Error("A integração Receita Federal precisa de Basic Auth e da URL https://cnpj.gravoncompany.com.");
  const key = process.env["INTEGRATIONS_ENCRYPTION_KEY"];
  if (!key) throw new Error("Chave de proteção das credenciais ausente no servidor.");
  const { decryptInstagramToken } = await import("./instagram-oauth-crypto.server");
  const cred = await decryptInstagramToken(String(data.encrypted_credentials), key, `external-integration:custom:${data.id}`);
  return `Basic ${btoa(cred)}`;
}

const like = (v: string) => `ilike.*${v.replace(/[*,()"\\]/g, " ").trim()}*`;

/** PostgREST query params for one bounded page. Exported for tests. */
export function receitaParams(q: ReceitaSearch): URLSearchParams {
  const p = new URLSearchParams();
  p.set("select", COLUMNS);
  p.set("uf", "eq.SC");
  if (q.cnpj) p.set("cnpj", `eq.${q.cnpj}`);
  // CNAEs selecionados na busca inteligente + código/prefixo digitado diretamente: condição OR válida.
  const cnaes = [...new Set(q.cnaes)];
  const cnae = q.cnae.replace(/\D/g, "");
  if (cnae.length === 7 && !cnaes.includes(cnae)) cnaes.push(cnae);
  const segment = q.segment.replace(/\D/g, "");
  const prefixes = [segment, ...(cnae && cnae.length !== 7 ? [cnae] : [])].filter(v => v.length >= 2);
  if (cnaes.length && prefixes.length)
    p.set("or", `(${[`cnae_principal.in.(${cnaes.join(",")})`, ...prefixes.map(s => `cnae_principal.like.${s}*`)].join(",")})`);
  else if (cnaes.length > 1) p.set("cnae_principal", `in.(${cnaes.join(",")})`);
  else if (cnaes.length === 1) p.set("cnae_principal", `eq.${cnaes[0]}`);
  else for (const s of prefixes) p.append("cnae_principal", `like.${s}*`);
  const city = q.municipality.trim();
  if (/^\d{1,5}$/.test(city)) p.set("municipio_codigo", `eq.${city.padStart(4, "0")}`);
  else if (city) p.set("municipio", like(city));
  if (q.tradeName) p.set("nome_fantasia", like(q.tradeName));
  if (q.legalName) p.set("razao_social", like(q.legalName));
  if (q.status) p.set("situacao_cadastral", `eq.${q.status}`);
  // not.is.null sozinho deixa passar texto vazio; neq. exclui "" gravado na base.
  if (q.hasPhone) { p.set("telefone", "not.is.null"); p.append("telefone", "neq."); }
  if (q.hasEmail) { p.set("email", "not.is.null"); p.append("email", "neq."); }
  p.set("order", "cnpj.asc");
  p.set("limit", String(q.pageSize));
  p.set("offset", String((q.page - 1) * q.pageSize));
  return p;
}

async function get(params: URLSearchParams, count: boolean) {
  const auth = await authorization();
  let res: Response;
  try {
    res = await fetch(`${BASE}${ENDPOINT}?${params}`, {
      headers: { Authorization: auth, Accept: "application/json", ...(count ? { Prefer: "count=estimated" } : {}) },
      redirect: "manual", signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(e instanceof Error && e.name === "TimeoutError" ? "A API da Receita demorou demais para responder. Refine os filtros e tente novamente." : "Não foi possível alcançar a API da Receita na VPS.");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 401 || res.status === 403) throw new Error("A API da Receita recusou a credencial salva na integração.");
    throw new Error(`A API da Receita recusou a consulta (HTTP ${res.status}).`);
  }
  const text = await res.text();
  if (text.length > 1_500_000) throw new Error("Resposta da Receita maior que o permitido.");
  const total = Number(res.headers.get("content-range")?.split("/")[1]);
  return { rows: JSON.parse(text) as unknown, total: Number.isFinite(total) ? total : null };
}

export function normalizeReceitaRow(raw: Record<string, unknown>): ReceitaRow {
  const pick: Record<string, unknown> = {};
  for (const k of COLUMNS.split(",")) { const v = raw[k]; pick[k] = typeof v === "string" && v.trim() ? v.trim() : null; }
  return receitaRow.parse(pick);
}

export async function receitaPing() {
  const p = new URLSearchParams({ select: "cnpj", limit: "1" });
  await get(p, false);
  return { connected: true as const };
}

export async function receitaQuery(q: ReceitaSearch) {
  const { rows, total } = await get(receitaParams(q), true);
  if (!Array.isArray(rows) || rows.length > q.pageSize) throw new Error("Resposta inesperada da API da Receita.");
  const parsed = rows.map(r => normalizeReceitaRow(r as Record<string, unknown>));
  return { rows: parsed, total: total ?? (q.page - 1) * q.pageSize + parsed.length, page: q.page, pageSize: q.pageSize, competence: null, updatedAt: new Date().toISOString() };
}
