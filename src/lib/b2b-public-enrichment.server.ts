import { companyFields, cnpjInput, type CompanyData } from "./b2b-prospecting";
import { b2bDb } from "./b2b-prospecting.server";
import { lookupKey, cachedLookup } from "./b2b-hybrid.server";
import { lookupPublicCompany } from "./b2b-public.server";
import { B2bProviderError } from "./b2b-providers.server";
import { matchPublicCompanyNames } from "./b2b-hybrid";
import { FirecrawlError, firecrawlConfigured, firecrawlSearch } from "./firecrawl.server";
import {
  buildFindings, contactLinks, extractCnpjs, extractEmails, extractJsonLdAddresses, extractPhones, extractWhatsApp, mergeProfile, reliableCandidates, robotsAllows,
  type CandidateHow, type EnrichTarget, type PublicEnrichResult, type SiteScan,
} from "./b2b-public-enrichment";

const UA = "PipeflowCRM-ConsultaPublica/1.0 (+https://crm.gravoncompany.com)";
const profileSchema = companyFields.omit({ identityConfirmed: true, storageAuthorized: true });
const SOCIAL = /(^|\.)(instagram\.com|facebook\.com|fb\.com|linktr\.ee|wa\.me|whatsapp\.com|tiktok\.com|youtube\.com|linkedin\.com|google\.com|goo\.gl|g\.page)$/i;

/** Só sites HTTPS públicos com domínio (sem IP, localhost ou redes internas). */
export function safeSiteUrl(value: string): URL | null {
  try {
    const u = new URL(value.trim());
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password || u.port && u.port !== "443") return null;
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
    if (SOCIAL.test(host)) return null;
    return u;
  } catch { return null; }
}

export async function fetchText(url: string, transport: typeof fetch, maxBytes = 600_000): Promise<{ url: string; text: string } | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const safe = safeSiteUrl(current);
    if (!safe) return null;
    const res = await transport(safe.href, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,text/plain" }, signal: AbortSignal.timeout(6000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location"); await res.body?.cancel().catch(() => undefined);
      if (!loc) return null; current = new URL(loc, safe).href; continue;
    }
    if (!res.ok || !res.body) { await res.body?.cancel().catch(() => undefined); return null; }
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/(html|plain)|xhtml/i.test(type)) { await res.body.cancel().catch(() => undefined); return null; }
    const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (size < maxBytes) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; }
    await reader.cancel().catch(() => undefined);
    const all = new Uint8Array(Math.min(size, maxBytes)); let off = 0;
    for (const c of chunks) { const part = c.subarray(0, Math.max(0, all.length - off)); all.set(part, off); off += part.length; if (off >= all.length) break; }
    return { url: safe.href, text: new TextDecoder("utf-8", { fatal: false }).decode(all) };
  }
  return null;
}

/** Lê a página inicial e até 3 páginas de contato/sobre do site oficial, respeitando o robots.txt. */
export async function scanOfficialSite(website: string, transport: typeof fetch = fetch): Promise<SiteScan | null> {
  const start = safeSiteUrl(website);
  if (!start) return null;
  const origin = `${start.protocol}//${start.host}`;
  let robots = "";
  try { const r = await fetchText(`${origin}/robots.txt`, transport, 50_000); robots = r?.text ?? ""; } catch { robots = ""; }
  const allowed = (u: string) => robotsAllows(robots, new URL(u).pathname || "/");
  const scan: SiteScan = { pages: [], cnpjs: [], emails: [], whatsapp: [], phones: [], addresses: [], blocked: false };
  if (!allowed(start.href)) return { ...scan, blocked: true };
  const home = await fetchText(start.href, transport).catch(() => null);
  if (!home) return scan;
  const pages = [home], seen = new Set([home.url]);
  for (const link of contactLinks(home.text, home.url)) {
    if (seen.has(link) || !allowed(link)) continue;
    const page = await fetchText(link, transport).catch(() => null);
    if (page && !seen.has(page.url)) { seen.add(page.url); pages.push(page); }
  }
  const host = new URL(home.url).hostname;
  const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  scan.pages = pages.map(p => p.url);
  scan.cnpjs = [...new Set(pages.flatMap(p => extractCnpjs(visible(p.text).replace(/<[^>]+>/g, " "))))].slice(0, 5);
  scan.emails = [...new Set(pages.flatMap(p => extractEmails(visible(p.text), host)))].slice(0, 5);
  scan.whatsapp = [...new Set(pages.flatMap(p => extractWhatsApp(p.text)))].slice(0, 3);
  scan.phones = [...new Set(pages.flatMap(p => extractPhones(p.text)))].slice(0, 3);
  scan.addresses = [...new Set(pages.flatMap(p => extractJsonLdAddresses(p.text)))].slice(0, 2);
  return scan;
}

/** Cadastro público do CNPJ com o cache privado de 24 h já usado pela Prospecção B2B. Nunca consulta paga. */
export async function cachedPublicCompany(cnpj: string): Promise<CompanyData> {
  const canonical = cnpjInput.parse(cnpj);
  const key = await lookupKey("public", "cnpj", canonical, []);
  const cached = await cachedLookup(key);
  if (cached.company) return cached.company;
  const company = await lookupPublicCompany(canonical);
  await (await b2bDb()).from("b2b_lookup_cache").upsert({ query_key: key, provider: "public", state: "success", profile: company, checked_at: new Date().toISOString(), valid_until: new Date(Date.now() + 86400_000).toISOString() });
  return company;
}

type LeadRow = { id: string; name: string; company: string; email: string; whatsapp: string; website: string };
export async function loadLeadContext(leadId: string) {
  const db = await b2bDb();
  const [lead, comp] = await Promise.all([
    db.from("leads").select("id,name,company,email,whatsapp,website").eq("id", leadId).maybeSingle(),
    db.from("b2b_companies").select("cnpj,profile").eq("lead_id", leadId).maybeSingle(),
  ]);
  if (lead.error || !lead.data) throw new Error("Lead indisponível.");
  const parsed = profileSchema.safeParse(comp.data?.profile);
  return { lead: lead.data as LeadRow, profile: parsed.success ? parsed.data : null, cnpj: (comp.data?.cnpj as string | undefined) ?? "" };
}

export type Deps = {
  site: typeof scanOfficialSite; company: (cnpj: string) => Promise<CompanyData>; history: (name: string) => Promise<CompanyData[]>;
  /** Busca pública na web (nome + cidade + UF); devolve CNPJs citados nos resultados com a página de origem. */
  web?: (query: string) => Promise<{ cnpj: string; url: string; title: string }[]>;
};
async function webCnpjs(query: string) {
  if (!firecrawlConfigured()) return [];
  const rows = await firecrawlSearch(query, 6);
  const out: { cnpj: string; url: string; title: string }[] = [];
  for (const r of rows) for (const cnpj of extractCnpjs(`${r.title} ${r.description} ${r.url}`)) if (!out.some(o => o.cnpj === cnpj)) out.push({ cnpj, url: r.url, title: r.title });
  return out.slice(0, 3);
}
const defaultDeps: Deps = {
  site: scanOfficialSite,
  company: cachedPublicCompany,
  history: async name => {
    const { data, error } = await (await b2bDb()).from("b2b_lookup_cache").select("profile").eq("provider", "public").eq("state", "success").gt("valid_until", new Date().toISOString()).order("checked_at", { ascending: false }).limit(100);
    if (error) return [];
    return matchPublicCompanyNames((data ?? []).flatMap(r => { const p = profileSchema.safeParse(r.profile); return p.success ? [p.data] : []; }), name);
  },
  web: webCnpjs,
};

/** Executa a consulta pública para um lead ou uma empresa do Maps (sem gravar nada no card). */
export async function runPublicEnrichment(ctx: Awaited<ReturnType<typeof loadLeadContext>>, deps: Deps = defaultDeps): Promise<PublicEnrichResult> {
  const { lead, profile } = ctx;
  const target: EnrichTarget = {
    name: lead.name, company: lead.company, tradeName: profile?.tradeName ?? "", legalName: profile?.legalName ?? "",
    city: profile?.city ?? "", state: profile?.state ?? "", address: profile?.address ?? "",
    website: lead.website || profile?.website || "", cnpj: ctx.cnpj || profile?.cnpj || "",
  };
  const sources: PublicEnrichResult["sources"] = [], notes: string[] = [];
  const errors: NonNullable<PublicEnrichResult["errors"]> = {};
  const providerError = (e: unknown) => e instanceof B2bProviderError ? e.message : e instanceof FirecrawlError ? e.message : "Fonte pública indisponível no momento.";

  // 1. Site oficial: e-mails, WhatsApp, telefone e CNPJ publicados na página inicial, de contato e no rodapé.
  let site: SiteScan | null = null;
  const siteUrl = safeSiteUrl(target.website)?.href ?? "";
  if (siteUrl) {
    site = await deps.site(siteUrl).catch(() => null);
    if (!site) errors.site = true;
    sources.push({ name: "Site oficial", url: siteUrl, outcome: !site ? "não respondeu" : site.blocked ? "leitura não permitida pelo site (robots.txt)" : `${site.pages.length} página(s) lida(s)` });
  } else notes.push(target.website ? "O site cadastrado não é um endereço HTTPS público; não foi lido." : "Sem site oficial cadastrado: e-mails do site não puderam ser buscados.");

  // 2. CNPJ: direto, publicado no site, histórico privado ou busca pública pelo nome + cidade + UF (validado por endereço/domínio/nome).
  let company: CompanyData | null = null, how: CandidateHow | null = null, ambiguous = false;
  type Cand = { company: CompanyData; how: CandidateHow; source: string; sourceUrl: string };
  let options: Cand[] = [];
  if (target.cnpj) {
    try { company = await deps.company(target.cnpj); how = "cnpj"; sources.push({ name: "Cadastro público do CNPJ", url: company.sourceReference.split(" · ")[1] ?? "", outcome: "consultado" }); }
    catch (e) { errors.cnpj = true; sources.push({ name: "Cadastro público do CNPJ", url: "", outcome: providerError(e) }); }
  } else {
    const candidates: Cand[] = [];
    const add = async (cnpj: string, h: CandidateHow, source: string, url: string) => {
      if (candidates.some(c => c.company.cnpj === cnpj)) return;
      try { candidates.push({ company: await deps.company(cnpj), how: h, source, sourceUrl: url }); }
      catch (e) { errors.cnpj = true; sources.push({ name: "Cadastro público do CNPJ", url: "", outcome: providerError(e) }); }
    };
    for (const cnpj of site?.cnpjs ?? []) await add(cnpj, "site", "CNPJ publicado no site oficial", site?.pages[0] ?? siteUrl);
    for (const n of [...new Set([target.tradeName, lead.name].filter(v => v.trim().length >= 3))].slice(0, 2)) {
      for (const c of await deps.history(n.slice(0, 150)).catch(() => [])) if (!candidates.some(x => x.company.cnpj === c.cnpj)) candidates.push({ company: c, how: "historico", source: "Histórico de consultas públicas", sourceUrl: "" });
    }
    if (!reliableCandidates(target, candidates).length && deps.web) {
      const name = target.tradeName || lead.name || lead.company;
      const query = `"${name}" ${target.city} ${target.state} CNPJ`.replace(/\s+/g, " ").trim();
      try {
        const found = await deps.web(query);
        sources.push({ name: "Busca pública na web", url: "", outcome: found.length ? `${found.length} CNPJ(s) citados` : "nenhum CNPJ citado" });
        for (const f of found) await add(f.cnpj, "busca", `Busca pública na web (${f.title || new URL(f.url).hostname})`, f.url);
      } catch (e) { errors.cnpj = true; sources.push({ name: "Busca pública na web", url: "", outcome: providerError(e) }); }
    }
    const reliable = reliableCandidates(target, candidates);
    if (reliable.length > 1) { ambiguous = true; options = reliable; notes.push("Mais de uma empresa compatível foi encontrada; nenhum CNPJ foi associado. Escolha a correta."); }
    else if (reliable.length === 1) { company = reliable[0].company; how = reliable[0].how; sources.push({ name: "Cadastro público do CNPJ", url: company.sourceReference.split(" · ")[1] ?? "", outcome: `${reliable[0].source}, conferido com nome/cidade/endereço/domínio` }); }
    else if (candidates.length) { options = candidates.slice(0, 3); notes.push("CNPJs encontrados não correspondem com segurança ao nome/cidade da empresa; confira as opções antes de vincular."); }
    else notes.push("CNPJ não encontrado nas fontes públicas.");
  }

  const sourceName = "Cadastro público do CNPJ (Receita Federal via Minha Receita/BrasilAPI)";
  const sourceUrl = company?.sourceReference.split(" · ")[1] ?? "";
  const findings = buildFindings({ company: lead.company, email: lead.email, whatsapp: lead.whatsapp, website: lead.website, cnpj: target.cnpj }, company, site, site?.pages[0] ?? siteUrl, sourceName, sourceUrl);
  return {
    status: findings.length || (company && !target.cnpj) ? "found" : "no_data",
    identified: company && how ? { cnpj: company.cnpj, how } : null,
    ambiguous, company, findings, sources, notes, checkedAt: new Date().toISOString(),
    candidates: options.length ? options : undefined, site, siteUrl, errors,
  };
}

/** Consulta pública para empresas do Maps ainda sem card (nada é gravado; o usuário escolhe o que usar). */
export type PlaceInput = { key: string; name: string; address: string; website: string; city: string; state: string; phone: string };
export async function runPlaceLookup(place: PlaceInput, deps: Deps = defaultDeps) {
  const st = /^[A-Z]{2}$/.test(place.state) ? place.state : "";
  return runPublicEnrichment({
    lead: { id: "", name: place.name, company: "", email: "", whatsapp: "", website: place.website },
    profile: { placeId: "", cnpj: "", legalName: "", tradeName: place.name, registrationStatus: "", segment: "", city: place.city, state: st as CompanyData["state"], address: place.address, phones: [], emails: [], website: place.website, instagram: "", source: "manual", sourceReference: "Google Maps" },
    cnpj: "",
  }, deps);
}

/** Grava os campos escolhidos (só vazios, salvo os confirmados em `replace`) e completa o cadastro da empresa. */
export async function applyEnrichment(leadId: string, result: PublicEnrichResult, keys: string[], replace: string[], note: string) {
  const db = await b2bDb();
  const ctx = await loadLeadContext(leadId);
  const chosen = result.findings.filter(f => keys.includes(f.key));
  const fields = Object.fromEntries(chosen.filter(f => f.key !== "cnpj").map(f => [f.key, f.value]));
  const wantCnpj = chosen.some(f => f.key === "cnpj") && result.company ? result.company.cnpj : "";
  const sameCompany = Boolean(result.company && ctx.cnpj && result.company.cnpj === ctx.cnpj);
  // O cadastro da empresa só é completado com o CNPJ escolhido (ou o mesmo já vinculado); nunca com dados de outra empresa.
  const profile = result.company && (wantCnpj || sameCompany) ? mergeProfile(ctx.profile, result.company, ctx.lead.name) : null;
  return applyRpc(db, leadId, fields, replace, wantCnpj, profile, note);
}
async function applyRpc(db: Awaited<ReturnType<typeof b2bDb>>, leadId: string, fields: Record<string, string>, replace: string[], cnpj: string, profile: CompanyData | null, note: string) {
  const { data, error } = await db.rpc("apply_b2b_public_enrichment", { p_lead: leadId, p_fields: fields, p_replace: replace, p_cnpj: cnpj, p_profile: profile, p_note: note });
  if (error) throw new Error("Não foi possível gravar os dados no card. Nada foi alterado.");
  return data as { applied: string[]; skipped: string[]; cnpjConflict: boolean; entry: { id: string; date: string; text: string; source?: string } | null };
}

/** Processa um lote pequeno da fila do cadastro em massa (preenche só campos vazios com correspondência confiável). */
export async function processPublicQueue(limit = 3) {
  const db = await b2bDb();
  const { data: ids, error } = await db.rpc("claim_b2b_public_enrichment", { p_limit: limit });
  if (error) throw new Error("A fila de consultas públicas está indisponível.");
  let processed = 0;
  for (const leadId of (ids ?? []) as string[]) {
    processed++;
    try {
      const result = await runPublicEnrichment(await loadLeadContext(leadId));
      const auto = result.findings.filter(f => f.autoFill && !f.current).map(f => f.key);
      const applied = auto.length ? await applyEnrichment(leadId, result, auto, [], "Consulta Pública Gratuita (cadastro em massa)") : { applied: [] as string[], skipped: [] as string[], cnpjConflict: false, entry: null };
      if (applied.cnpjConflict) result.notes.push("Este CNPJ já pertence a outro card; não foi associado para evitar duplicidade.");
      await db.from("b2b_public_enrichment_jobs").update({ status: applied.applied.length ? "found" : result.findings.length ? "found" : "no_data", result, applied: applied.applied, outcome_code: applied.cnpjConflict ? "cnpj_conflict" : null, lease_until: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("lead_id", leadId).eq("status", "running");
    } catch (e) {
      const code = e instanceof B2bProviderError ? e.code.slice(0, 60) : "unexpected";
      // 429: devolve à fila para a próxima rodada, sem insistir agora.
      const now = new Date().toISOString();
      if (e instanceof B2bProviderError && e.code === "public_http_429") {
        const back = await db.from("b2b_public_enrichment_jobs").update({ status: "queued", outcome_code: code, lease_until: null, updated_at: now }).eq("lead_id", leadId).eq("status", "running").lt("attempts", 3).select("lead_id");
        if (back.data?.length) break;
      }
      await db.from("b2b_public_enrichment_jobs").update({ status: "error", outcome_code: code, lease_until: null, finished_at: now, updated_at: now }).eq("lead_id", leadId).eq("status", "running");
    }
  }
  const { count } = await db.from("b2b_public_enrichment_jobs").select("lead_id", { count: "exact", head: true }).in("status", ["queued", "running"]);
  return { processed, remaining: count ?? 0 };
}

/** O usuário escolheu um dos candidatos listados: recalcula o que pode ir para o card a partir desse CNPJ. */
export async function chooseCandidate(leadId: string, result: PublicEnrichResult, cnpj: string): Promise<PublicEnrichResult> {
  const pick = result.candidates?.find(c => c.company.cnpj === cnpj);
  if (!pick) throw new Error("Este CNPJ não está entre as opções encontradas. Refaça a consulta.");
  const ctx = await loadLeadContext(leadId);
  const sourceName = "Cadastro público do CNPJ (Receita Federal via Minha Receita/BrasilAPI)";
  const sourceUrl = pick.company.sourceReference.split(" · ")[1] ?? "";
  const findings = buildFindings({ company: ctx.lead.company, email: ctx.lead.email, whatsapp: ctx.lead.whatsapp, website: ctx.lead.website, cnpj: ctx.cnpj }, pick.company, result.site ?? null, result.siteUrl ?? "", sourceName, sourceUrl)
    .map(f => f.key === "cnpj" || f.key === "company" ? { ...f, note: `Escolhido por você entre ${result.candidates?.length ?? 1} opções (${pick.source}).` } : f);
  return { ...result, company: pick.company, identified: { cnpj, how: pick.how }, ambiguous: false, findings, status: "found" };
}
