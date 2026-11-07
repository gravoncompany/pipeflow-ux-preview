// Servidor da busca de e-mails públicos: lê só páginas públicas (home + contato/sobre + equipe),
// respeita robots.txt, reutiliza o cache privado de 24 h e o e-mail do cadastro público do CNPJ.
// Nenhuma consulta paga é feita aqui; nada é gravado no CRM.

import { extractEmails, contactLinks, robotsAllows } from "./b2b-public-enrichment";
import { cachedPublicCompany, fetchText, safeSiteUrl } from "./b2b-public-enrichment.server";
import { b2bDb } from "./b2b-prospecting.server";
import { lookupKey } from "./b2b-hybrid.server";
import {
  bestContact, classifyEmail, summarizeEmailSearch, teamLinks,
  type SiteEmailContact, type SiteEmailResult, type SiteEmailSummary,
} from "./b2b-site-emails";

export type PlaceEmailInput = { key: string; name: string; website: string; cnpj?: string };

type CacheDeps = {
  get: (host: string) => Promise<SiteEmailResult | null>;
  set: (host: string, result: SiteEmailResult) => Promise<void>;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cacheKey = (host: string) => lookupKey("site_email", "host", host, []);

/** Cache privado de 24 h por domínio, na mesma tabela das consultas públicas já existentes. */
const dbCache: CacheDeps = {
  async get(host) {
    const key = await cacheKey(host);
    const { data, error } = await (await b2bDb())
      .from("b2b_lookup_cache").select("profile,state,valid_until").eq("query_key", key).maybeSingle();
    if (error || !data || data.state !== "success" || Date.parse(data.valid_until) <= Date.now()) return null;
    const r = data.profile as SiteEmailResult | null;
    return r && Array.isArray(r.contacts) ? { ...r, fromCache: true } : null;
  },
  async set(host, result) {
    const key = await cacheKey(host);
    await (await b2bDb()).from("b2b_lookup_cache").upsert({
      query_key: key, provider: "site_email", state: "success",
      profile: { ...result, fromCache: false },
      checked_at: new Date().toISOString(), valid_until: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    });
  },
};

/** Lê a home e até 5 páginas públicas (contato/sobre/equipe), devolvendo cada e-mail com a página de origem. */
export async function scanSiteEmails(
  website: string,
  transport: typeof fetch = fetch,
): Promise<{ contacts: SiteEmailContact[]; blocked: boolean; pages: number } | null> {
  const start = safeSiteUrl(website);
  if (!start) return null;
  const origin = `${start.protocol}//${start.host}`;
  let robots = "";
  try { robots = (await fetchText(`${origin}/robots.txt`, transport, 50_000))?.text ?? ""; } catch { robots = ""; }
  const allowed = (u: string) => { try { return robotsAllows(robots, new URL(u).pathname || "/"); } catch { return false; } };
  if (!allowed(start.href)) return { contacts: [], blocked: true, pages: 0 };
  const home = await fetchText(start.href, transport).catch(() => null);
  if (!home) return null;
  const host = new URL(home.url).hostname;
  const pages = [home], seen = new Set([home.url]);
  const extra = [...contactLinks(home.text, home.url)];
  for (const link of teamLinks(home.text, home.url)) if (!extra.includes(link)) extra.push(link);
  for (const link of extra.slice(0, 5)) {
    if (seen.has(link) || !allowed(link)) continue;
    const page = await fetchText(link, transport).catch(() => null);
    if (page && !seen.has(page.url)) { seen.add(page.url); pages.push(page); }
  }
  const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  const contacts: SiteEmailContact[] = [];
  for (const p of pages) {
    for (const email of extractEmails(visible(p.text), host)) {
      if (!contacts.some(c => c.email === email)) contacts.push({ email, kind: classifyEmail(email), page: p.url, source: "site" });
    }
  }
  return { contacts: contacts.slice(0, 8), blocked: false, pages: pages.length };
}

async function fiscalEmail(cnpj: string): Promise<{ email: string; website: string } | null> {
  if (!cnpj) return null;
  try {
    const company = await cachedPublicCompany(cnpj);
    return { email: company.emails[0] ?? "", website: company.website ?? "" };
  } catch { return null; }
}

/** Pesquisa os e-mails de uma empresa do Maps. Reutiliza cache por domínio e o cadastro público do CNPJ. */
export async function searchPlaceEmails(
  place: PlaceEmailInput,
  deps: { scan?: typeof scanSiteEmails; cache?: CacheDeps; fiscal?: typeof fiscalEmail } = {},
): Promise<SiteEmailResult> {
  const scan = deps.scan ?? scanSiteEmails;
  const cache = deps.cache ?? dbCache;
  const fiscal = deps.fiscal ?? fiscalEmail;
  const base: Omit<SiteEmailResult, "status" | "note" | "contacts"> = {
    key: place.key, name: place.name.slice(0, 300), cnpj: place.cnpj ?? "",
    site: "", checkedAt: new Date().toISOString(), fromCache: false,
  };
  const fiscalData = await fiscal(place.cnpj ?? "");
  let site = safeSiteUrl(place.website)?.href ?? "";
  if (!site && fiscalData?.website) site = safeSiteUrl(fiscalData.website)?.href ?? "";
  const host = site ? new URL(site).hostname : "";

  let result: SiteEmailResult;
  if (!site) {
    result = { ...base, contacts: [], status: "sem_site", note: "A empresa não tem site oficial identificado para pesquisar." };
  } else {
    const cached = await cache.get(host).catch(() => null);
    if (cached) {
      result = { ...cached, key: place.key, name: base.name, cnpj: base.cnpj, fromCache: true };
    } else {
      const scanOut = await scan(site).catch(() => null);
      if (!scanOut) {
        result = { ...base, site, contacts: [], status: "erro", note: "O site não respondeu à leitura pública." };
      } else if (scanOut.blocked) {
        result = { ...base, site, contacts: [], status: "site_bloqueado", note: "O site não permite leitura automática (robots.txt)." };
      } else if (!scanOut.contacts.length) {
        result = { ...base, site, contacts: [], status: "nao_encontrado", note: `${scanOut.pages} página(s) pública(s) lida(s), sem e-mail publicado.` };
      } else {
        result = { ...base, site, contacts: scanOut.contacts, status: "encontrado", note: "" };
      }
      await cache.set(host, result).catch(() => undefined);
    }
  }
  // Complemento do cadastro público do CNPJ: entra como "geral" quando o site não trouxe esse endereço.
  if (fiscalData?.email && !result.contacts.some(c => c.email === fiscalData.email)) {
    result = {
      ...result,
      contacts: [...result.contacts, { email: fiscalData.email, kind: "geral" as const, page: "", source: "fiscal" as const }].slice(0, 8),
      status: "encontrado",
      note: result.note ? `${result.note} E-mail do cadastro fiscal incluído (pode ser do contador).` : "E-mail do cadastro fiscal incluído (pode ser do contador).",
    };
  }
  return result;
}

/** Pesquisa em sequência (sem sobrecarregar os sites); cada empresa tem seu próprio resultado. */
export async function searchPlacesEmails(
  places: PlaceEmailInput[],
  deps: Parameters<typeof searchPlaceEmails>[1] = {},
): Promise<SiteEmailResult[]> {
  const out: SiteEmailResult[] = [];
  for (const p of places) {
    try { out.push(await searchPlaceEmails(p, deps)); }
    catch {
      out.push({
        key: p.key, name: p.name.slice(0, 300), cnpj: p.cnpj ?? "", site: "",
        contacts: [], status: "erro", note: "Falha inesperada na pesquisa desta empresa.",
        checkedAt: new Date().toISOString(), fromCache: false,
      });
    }
  }
  return out;
}

export { bestContact, summarizeEmailSearch };
export type { SiteEmailSummary };
