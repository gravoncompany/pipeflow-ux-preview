import { b2bDb, requireB2bAccess } from "./b2b-prospecting.server";
import { extractContacts, applySiteScan } from "./b2b-instagram";
import { fetchText, safeSiteUrl, scanOfficialSite } from "./b2b-public-enrichment.server";
import { extractEmails, extractPhones, robotsAllows } from "./b2b-public-enrichment";
import { firecrawlConfigured, firecrawlSearch } from "./firecrawl.server";
import { pageMatchesInstagram, publicLinks, whatsappEvidence, whatsappLink, type ContactEvidence } from "./instagram-public-contacts";

/** Resolve only contact links on the company's own host; never fetch WhatsApp, private hosts or aggregators. */
export async function resolveContactLink(raw: string, owner: string, transport: typeof fetch = fetch): Promise<string> {
  const site = safeSiteUrl(owner);
  if (!site) return "";
  let current = raw;
  for (let hop = 0; hop < 3; hop++) {
    const direct = whatsappLink(current);
    if (direct.isWhatsapp) return direct.phone;
    const safe = safeSiteUrl(current);
    if (!safe || safe.host !== site.host) return "";
    const response = await transport(safe.href, { redirect: "manual", signal: AbortSignal.timeout(4000), headers: { Accept: "text/html" } });
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (response.status < 300 || response.status >= 400 || !location) return "";
    current = new URL(location, safe).href;
  }
  return whatsappLink(current).phone;
}

async function investigate(site: string, username: string, method: "site" | "busca", requireMatch = false) {
  const scan = await scanOfficialSite(site);
  const evidence: ContactEvidence[] = [];
  if (!scan || scan.blocked || !scan.pages.length) return { scan, evidence, matched: false };
  const pages: { url: string; text: string }[] = [];
  for (const url of scan.pages.slice(0, 4)) {
    const page = await fetchText(url, fetch, 300_000).catch(() => null);
    if (page && new URL(page.url).host === new URL(scan.pages[0]).host) pages.push(page);
  }
  const matched = !requireMatch || pages.some(p => pageMatchesInstagram(p.text, username));
  if (!matched) return { scan: null, evidence, matched: false };
  let robots = "";
  try { robots = (await fetchText(new URL("/robots.txt", scan.pages[0]).href, fetch, 50_000))?.text || ""; } catch { /* no rules */ }
  let redirects = 0;
  for (const page of pages) {
    const clean = page.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
    evidence.push(...extractEmails(clean, new URL(page.url).hostname).map(value => ({ field: "email" as const, value, url: page.url, method })));
    evidence.push(...extractPhones(clean).map(value => ({ field: "phone" as const, value, url: page.url, method })));
    evidence.push(...whatsappEvidence(page.text, page.url, method));
    const buttons = new Set([...page.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)].filter(m => /whats|atendimento|or[cç]amento|agend|fale|contato/i.test(m[0])).flatMap(m => publicLinks(`href="${m[1]}"`, page.url)));
    for (const link of publicLinks(page.text, page.url)) {
      if (redirects >= 3) break;
      const safe = safeSiteUrl(link);
      if (!safe || safe.host !== new URL(page.url).host || !buttons.has(link) && !/whats|atendimento|orcamento|orçamento|agend|fale|contato/i.test(link) || !robotsAllows(robots, safe.pathname)) continue;
      redirects++;
      const value = await resolveContactLink(link, page.url).catch(() => "");
      if (value) evidence.push({ field: "whatsapp", value, url: link, method });
    }
  }
  // Only values with a retrieved source page can be applied.
  return { scan: { ...scan, emails: evidence.filter(e => e.field === "email").map(e => e.value), phones: evidence.filter(e => e.field === "phone").map(e => e.value), whatsapp: evidence.filter(e => e.field === "whatsapp").map(e => e.value) }, evidence, matched };
}

const active = new Map<string, Promise<{ processed: number; remaining: number }>>();
/** Cached reprocessing never calls Apify or imports cards. Sequential bounded batches, no automatic retries. */
export async function reprocessInstagramContacts(searchId: string) {
  await requireB2bAccess();
  const existing = active.get(searchId);
  if (existing) return existing;
  const task = run(searchId).finally(() => active.delete(searchId));
  active.set(searchId, task);
  return task;
}
async function run(searchId: string) {
  const db = await b2bDb();
  const { data: search } = await db.from("b2b_instagram_searches").select("status").eq("id", searchId).maybeSingle();
  if (!search || search.status === "running") throw new Error("Aguarde a pesquisa terminar antes de atualizar contatos.");
  const cutoff = new Date(Date.now() - 86400_000).toISOString();
  const { data, error } = await db.from("b2b_instagram_profiles").select("*").eq("search_id", searchId).or(`public_checked_at.is.null,public_checked_at.lt.${cutoff}`).order("id").limit(5);
  if (error) throw new Error("Não foi possível recuperar os perfis existentes.");
  for (const row of data || []) {
    const checked = new Date().toISOString();
    // Cross-isolate compare-and-set claim, shared with the 24-hour refresh marker.
    const { data: claimed } = await db.from("b2b_instagram_profiles").update({ public_checked_at: checked }).eq("id", row.id).or(`public_checked_at.is.null,public_checked_at.lt.${cutoff}`).select("id");
    if (!claimed?.length) continue;
    const cacheKey = `ig:${row.id}:v2`;
    const bio = extractContacts(String(row.biography || ""), String(row.external_url || ""));
    const patch: Record<string, unknown> = {};
    const sources: ContactEvidence[] = Array.isArray(row.contact_sources) ? row.contact_sources : [];
    const profileUrl = `https://www.instagram.com/${row.username}/`;
    for (const field of ["email", "phone", "whatsapp"] as const) {
      if (!row[field] && bio[field]) { patch[field] = bio[field]; sources.push({ field, value: bio[field], url: whatsappLink(row.external_url || "").phone === bio[field] ? row.external_url : profileUrl, method: "instagram" }); }
    }
    if (whatsappLink(String(row.external_url || "")).isWhatsapp) patch.external_url = "";
    try {
      const { data: cached } = await db.from("b2b_instagram_public_cache").select("result,valid_until").eq("cache_key", cacheKey).maybeSingle();
      let result = cached && Date.parse(cached.valid_until) > Date.now() ? cached.result : null;
      if (!result) {
        result = bio.website ? await investigate(bio.website, String(row.username), "site") : { scan: null, evidence: [], matched: false };
        if ((!row.email && !bio.email && !result.scan?.emails.length || !row.whatsapp && !bio.whatsapp && !result.scan?.whatsapp.length) && firecrawlConfigured()) {
          const query = [JSON.stringify(String(row.full_name || row.username)), row.city, row.state, `Instagram ${row.username}`, bio.website].filter(Boolean).join(" ");
          const candidates = await firecrawlSearch(query, 3);
          for (const candidate of candidates.slice(0, 2)) {
            if (!safeSiteUrl(candidate.url)) continue;
            const found = await investigate(candidate.url, String(row.username), "busca", true);
            if (found.matched && found.scan) {
              result = { scan: result.scan ? { ...result.scan, emails: [...result.scan.emails, ...found.scan.emails], phones: [...result.scan.phones, ...found.scan.phones], whatsapp: [...result.scan.whatsapp, ...found.scan.whatsapp] } : found.scan, evidence: [...result.evidence, ...found.evidence], matched: true };
              if (!bio.website) patch.external_url = found.scan.pages[0];
              break;
            }
          }
        }
        await db.from("b2b_instagram_public_cache").upsert({ cache_key: cacheKey, result, checked_at: checked, valid_until: new Date(Date.now() + 86400_000).toISOString() });
      }
      if (result.scan) Object.assign(patch, applySiteScan({ email: row.email || bio.email, phone: row.phone || bio.phone, whatsapp: row.whatsapp || bio.whatsapp, cnpj: row.cnpj || "", address: row.address || "" }, result.scan));
      sources.push(...result.evidence);
      patch.enrichment = result.scan?.blocked ? "falhou" : "concluido";
    } catch { patch.enrichment = "falhou"; }
    patch.contact_sources = sources.filter((e, i, all) => all.findIndex(x => x.field === e.field && x.value === e.value && x.url === e.url) === i).slice(0, 25);
    await requireB2bAccess();
    const saved = await db.from("b2b_instagram_profiles").update(patch).eq("id", row.id).eq("public_checked_at", checked);
    if (saved.error) throw new Error("Não foi possível salvar os contatos encontrados.");
  }
  const { count } = await db.from("b2b_instagram_profiles").select("id", { count: "exact", head: true }).eq("search_id", searchId).or(`public_checked_at.is.null,public_checked_at.lt.${cutoff}`);
  return { processed: data?.length || 0, remaining: count || 0 };
}