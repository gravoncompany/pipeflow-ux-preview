import { z } from "zod";
import { BRAZIL_STATES, cnpjInput, type CompanyData } from "./b2b-prospecting";
import { boundedJson, B2bProviderError } from "./b2b-providers.server";
import { fetchWithoutRedirects, UpstreamRedirectError } from "./no-redirect-fetch.server";

const text = z.string().max(2000).nullish();
const schema = z.object({
  cnpj: z.string(), razao_social: z.string().min(2).max(300), nome_fantasia: text,
  descricao_situacao_cadastral: text, data_inicio_atividade: text,
  cnae_fiscal: z.union([z.string(), z.number().int()]).nullish(), cnae_fiscal_descricao: text,
  capital_social: z.number().finite().nonnegative().nullish(), cep: text,
  descricao_tipo_de_logradouro: text, logradouro: text, numero: text, complemento: text,
  bairro: text, municipio: text, uf: text, email: text, ddd_telefone_1: text, ddd_telefone_2: text,
  qsa: z.array(z.object({ nome_socio: text, qualificacao_socio: text })).max(100).optional(),
});
export type PublicProvider = "brasilapi" | "minhareceita";
const providerName = (provider: PublicProvider) => provider === "minhareceita" ? "Minha Receita" : "BrasilAPI / Minha Receita";
const providerUrl = (provider: PublicProvider, cnpj: string) => provider === "minhareceita" ? `https://minhareceita.org/${cnpj}` : `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;
export function parsePublicCompany(raw: unknown, expected: string, now = new Date(), provider: PublicProvider = "brasilapi"): CompanyData {
  const p = schema.parse(raw);
  if (cnpjInput.parse(p.cnpj) !== cnpjInput.parse(expected)) throw new B2bProviderError("identity", "A fonte pública retornou outro CNPJ.");
  const email = p.email?.trim().toLowerCase();
  const phone = (s: string) => { const n = s.replace(/\D/g, ""); return /^\d{10,11}$/.test(n) ? `55${n}` : ""; };
  return {
    placeId: "", cnpj: cnpjInput.parse(p.cnpj), legalName: p.razao_social,
    tradeName: (p.nome_fantasia ?? "").slice(0,300), registrationStatus: (p.descricao_situacao_cadastral ?? "").slice(0,300),
    segment: (p.cnae_fiscal_descricao ?? "").slice(0,300), city: (p.municipio ?? "").slice(0,300),
    state: BRAZIL_STATES.includes(p.uf as CompanyData["state"] & typeof BRAZIL_STATES[number]) ? p.uf as CompanyData["state"] : "",
    address: [p.descricao_tipo_de_logradouro,p.logradouro,p.numero,p.complemento,p.bairro,p.cep].filter(Boolean).join(" ").slice(0,700),
    phones: [...new Set([p.ddd_telefone_1,p.ddd_telefone_2].map(s => phone(s ?? "")).filter(Boolean))],
    emails: email && z.string().email().safeParse(email).success ? [email] : [], website: "", whatsappNumbers: [],
    partners: (p.qsa ?? []).filter(s => s.nome_socio?.trim()).slice(0,10).map(s => ({ name: (s.nome_socio ?? "").slice(0,200), role: (s.qualificacao_socio ?? "").slice(0,200), phones: [] })),
    source: "manual", sourceReference: `${providerName(provider)} · ${providerUrl(provider, expected)}`,
    publicDetails: { openedOn: (p.data_inicio_atividade ?? "").slice(0,30), cnae: String(p.cnae_fiscal ?? "").slice(0,30), postalCode: (p.cep ?? "").slice(0,20), capital: p.capital_social ?? null, revenueEstimate: null, revenueSource: "" },
    evidence: [{ source: providerName(provider), reference: providerUrl(provider, expected), checkedAt: now.toISOString(), kind: "reported", fields: ["legalName","tradeName","registrationStatus","segment","address","city","state","phones","emails","partners","publicDetails"] }],
  };
}
/** Only bounded timing metadata is retained; never log CNPJ, body or headers. */
export function publicRetryAfterSeconds(value: string | null, now: number): number {
  if (!value || value.length > 100) return 60;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.ceil(seconds)) : 60;
}

const rateLimitError = (seconds: number, provider: PublicProvider) => new B2bProviderError(
  "public_http_429",
  `A ${provider === "minhareceita" ? "Minha Receita" : "BrasilAPI"} limitou temporariamente as consultas (HTTP 429). Aguarde ${seconds} segundos antes de tentar novamente. Os dados existentes foram preservados; nenhuma consulta paga foi feita.`,
);

export function createPublicCompanyLookup({ transport = fetch, now = Date.now, provider = "brasilapi", log = (entry: Record<string, string | number>) => console.warn("b2b_public_query_failed", JSON.stringify(entry)) }: { transport?: typeof fetch; now?: () => number; provider?: PublicProvider; log?: (entry: Record<string, string | number>) => void } = {}) {
  // Best-effort per Worker isolate, not a global/distributed limit. Cached successful
  // database reads occur before this guard; no timers or automatic retries are used.
  let blockedUntil = 0;
  const inFlight = new Map<string, Promise<CompanyData>>();
  return async (cnpj: string): Promise<CompanyData> => {
    const canonical = cnpjInput.parse(cnpj);
    if (blockedUntil > now()) throw rateLimitError(Math.ceil((blockedUntil - now()) / 1000), provider);
    const existing = inFlight.get(canonical);
    if (existing) return existing;
    if (inFlight.size >= 20) throw new B2bProviderError("public_busy", "Há consultas públicas em andamento. Aguarde antes de tentar novamente; nenhuma consulta paga foi feita.");
    const request = (async () => {
      try {
        const response = await fetchWithoutRedirects(providerUrl(provider, canonical), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) }, transport);
        if (!response.ok) {
          const seconds = response.status === 429 ? publicRetryAfterSeconds(response.headers.get("retry-after"), now()) : 0;
          if (seconds) blockedUntil = Math.max(blockedUntil, now() + seconds * 1000);
          log({ provider, outcome: response.status === 429 ? "rate_limited" : "http_error", httpStatus: response.status, retryAfterSeconds: seconds });
          await response.body?.cancel().catch(() => undefined);
          if (response.status === 429) throw rateLimitError(seconds, provider);
          throw new B2bProviderError(`public_http_${response.status}`, `A fonte pública não concluiu a consulta (HTTP ${response.status}). Nenhuma consulta paga foi feita.`);
        }
        return parsePublicCompany(await boundedJson(response), canonical, new Date(now()), provider);
      } catch (e) {
        if (e instanceof B2bProviderError) throw e;
        if (e instanceof UpstreamRedirectError) throw new B2bProviderError("public_redirect_rejected", "A fonte pública tentou redirecionar a consulta; os dados existentes foram preservados.");
        if (e instanceof z.ZodError || e instanceof SyntaxError) throw new B2bProviderError("public_response_invalid", "A fonte pública retornou dados que não puderam ser validados. Os dados existentes foram preservados.");
        log({ provider, outcome: "unavailable" });
        throw new B2bProviderError("public_unavailable", "Não foi possível validar os dados públicos. Nenhuma consulta paga foi feita.");
      }
    })();
    inFlight.set(canonical, request);
    try { return await request; } finally { inFlight.delete(canonical); }
  };
}

export function createPublicResearchLookup(options: { transport?: typeof fetch; now?: () => number; log?: (entry: Record<string, string | number>) => void } = {}) {
  const primary = createPublicCompanyLookup({ ...options, provider: "minhareceita" });
  const secondary = createPublicCompanyLookup({ ...options, provider: "brasilapi" });
  const inFlight = new Map<string, Promise<CompanyData>>();
  return async (cnpj: string): Promise<CompanyData> => {
    const key = cnpjInput.parse(cnpj);
    const existing = inFlight.get(key);
    if (existing) return existing;
    if (inFlight.size >= 20) throw new B2bProviderError("public_busy", "Aguarde as consultas públicas em andamento.");
    const request = primary(key).catch(error => {
      // Never bypass rate limits, identity/schema failures, not-found or redirects.
      // BrasilAPI shares Minha Receita upstream: this is bounded transport fallback,
      // not independent redundancy and never a paid provider.
      if (error instanceof B2bProviderError && (error.code === "public_unavailable" || /^public_http_5\d{2}$/.test(error.code))) return secondary(key);
      throw error;
    });
    inFlight.set(key, request);
    try { return await request; } finally { inFlight.delete(key); }
  };
}
const publicLookup = createPublicResearchLookup();
export async function lookupPublicCompany(cnpj: string, transport?: typeof fetch) {
  return transport ? createPublicResearchLookup({ transport })(cnpj) : publicLookup(cnpj);
}