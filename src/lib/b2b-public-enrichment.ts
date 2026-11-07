import { normalizeCnpj, validCnpj, type CompanyData } from "./b2b-prospecting";

// Consulta Pública Gratuita: regras puras (sem rede). Só fontes gratuitas: cadastro público do CNPJ (Minha Receita /
// BrasilAPI), o site oficial já cadastrado da empresa e o histórico privado de consultas públicas. Nunca DeskData.

export type PublicJobStatus = "queued" | "running" | "found" | "no_data" | "error";
export const PUBLIC_STATUS_LABEL: Record<PublicJobStatus, string> = {
  queued: "Consultando dados",
  running: "Consultando dados",
  found: "Dados encontrados",
  no_data: "Consulta concluída sem novos dados",
  error: "Erro na consulta",
};

export type CandidateHow = "cnpj" | "site" | "historico" | "busca";
export type EnrichTarget = {
  name: string; company: string; tradeName: string; legalName: string;
  city: string; state: string; address: string; website: string; cnpj: string;
};
export type FindingKey = "cnpj" | "company" | "email" | "whatsapp" | "website";
export type Finding = {
  key: FindingKey; label: string; value: string; current: string;
  source: string; sourceUrl: string;
  /** Pode ser preenchido automaticamente no cadastro em massa (correspondência confiável e fonte da própria empresa). */
  autoFill: boolean;
  note?: string;
};
export type SiteScan = { pages: string[]; cnpjs: string[]; emails: string[]; whatsapp: string[]; phones: string[]; addresses: string[]; blocked: boolean };

/** Endereço comercial publicado em dados estruturados (JSON-LD PostalAddress) da própria página. Nunca inferido. */
export function extractJsonLdAddresses(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]{0,20000}?)<\/script>/gi)) {
    let doc: unknown;
    try { doc = JSON.parse(m[1]); } catch { continue; }
    const nodes = Array.isArray(doc) ? doc : [doc];
    const queue: unknown[] = [...nodes];
    while (queue.length && out.size < 2) {
      const node = queue.shift();
      if (!node || typeof node !== "object") continue;
      const rec = node as Record<string, unknown>;
      if (Array.isArray(rec["@graph"])) queue.push(...rec["@graph"]);
      const addr = rec.address;
      const addrRec = (Array.isArray(addr) ? addr[0] : addr) as Record<string, unknown> | undefined;
      if (addrRec && typeof addrRec === "object" && typeof addrRec.streetAddress === "string" && addrRec.streetAddress.trim()) {
        const parts = [
          addrRec.streetAddress,
          typeof addrRec.addressLocality === "string" ? addrRec.addressLocality : "",
          typeof addrRec.addressRegion === "string" ? addrRec.addressRegion : "",
        ].map((p) => p.trim()).filter(Boolean);
        const formatted = parts.join(", ").slice(0, 200);
        if (formatted) out.add(formatted);
      }
    }
    if (out.size >= 2) break;
  }
  return [...out];
}
export type PublicEnrichResult = {
  status: "found" | "no_data";
  identified: { cnpj: string; how: CandidateHow } | null;
  ambiguous: boolean;
  company: CompanyData | null;
  /** Empresas compatíveis quando há mais de uma (para revisão manual). */
  candidates?: { company: CompanyData; how: CandidateHow; source: string; sourceUrl: string }[];
  /** Leitura do site (e-mails/WhatsApp publicados), para mostrar todos os campos com a fonte. */
  site?: SiteScan | null;
  siteUrl?: string;
  /** Fontes que falharam (diferente de "não encontrado"). */
  errors?: { site?: boolean; cnpj?: boolean };
  findings: Finding[];
  sources: { name: string; url: string; outcome: string }[];
  notes: string[];
  checkedAt: string;
};

const STOP = new Set(["ltda", "eireli", "me", "epp", "sa", "s/a", "s.a", "cia", "comercio", "servicos", "servico", "de", "da", "do", "das", "dos", "e", "the", "and", "clinica", "loja", "empresa", "grupo", "centro"]);
export const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (v: string) => norm(v).split(" ").filter(t => t.length >= 3 && !STOP.has(t));

export function extractCnpjs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![0-9])(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})(?![0-9])/g)) {
    const c = normalizeCnpj(m.slice(1).join(""));
    if (validCnpj(c)) out.add(c);
    if (out.size >= 5) break;
  }
  return [...out];
}

const JUNK_EMAIL = /(example\.(com|org)|sentry|wixpress|domain\.com|email\.com|seuemail|seu-email|yourname|\.(png|jpe?g|gif|webp|svg)$)/i;
export function extractEmails(html: string, siteHost = ""): string[] {
  const found = new Set<string>();
  const decoded = html.replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, "@");
  for (const m of decoded.matchAll(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,10}/g)) {
    const e = m[0].toLowerCase().replace(/^[._-]+/, "");
    if (!JUNK_EMAIL.test(e) && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,10}$/.test(e)) found.add(e);
    if (found.size >= 20) break;
  }
  const host = siteHost.replace(/^www\./, "");
  return [...found].sort((a, b) => Number(Boolean(host) && b.endsWith(`@${host}`)) - Number(Boolean(host) && a.endsWith(`@${host}`))).slice(0, 5);
}
const brPhone = (digits: string) => { const d = digits.replace(/\D/g, ""); const full = d.startsWith("55") ? d : `55${d}`; return /^55\d{10,11}$/.test(full) ? full : ""; };
export function extractWhatsApp(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"'\s]*&)?phone=|whatsapp:\/\/send\?phone=)\+?(\d{10,13})/gi)) { const p = brPhone(m[1]); if (p) out.add(p); }
  return [...out].slice(0, 3);
}
export function extractPhones(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']tel:([+\d\s().-]{8,25})["']/gi)) { const p = brPhone(m[1]); if (p) out.add(p); }
  return [...out].slice(0, 3);
}
export function contactLinks(html: string, base: string): string[] {
  const baseUrl = new URL(base), out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const label = `${m[1]} ${m[2].replace(/<[^>]+>/g, " ")}`;
    if (!/contato|contact|fale|atendimento|sobre|quem-somos|about/i.test(norm(label).replace(/ /g, "-")) && !/contato|contact|fale|atendimento|sobre|about/i.test(label)) continue;
    try { const u = new URL(m[1], baseUrl); if (u.protocol === "https:" && u.host === baseUrl.host && u.href !== baseUrl.href) out.add(u.href.split("#")[0]); } catch { /* link inválido */ }
    if (out.size >= 3) break;
  }
  return [...out];
}
/** robots.txt simplificado: respeita "Disallow" do grupo "*" (ou do nosso agente). */
export function robotsAllows(robots: string, path: string, agent = "pipeflowcrm"): boolean {
  let applies = false, sawAgentLine = false; const rules: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); if (!line) continue;
    const [k, ...rest] = line.split(":"); const key = k.trim().toLowerCase(), value = rest.join(":").trim();
    if (key === "user-agent") { if (!sawAgentLine) applies = false; sawAgentLine = true; const a = value.toLowerCase(); if (a === "*" || a.includes(agent)) applies = true; }
    else { sawAgentLine = false; if (applies && key === "disallow" && value) rules.push(value); if (applies && key === "allow" && value && path.startsWith(value)) return true; }
  }
  return !rules.some(r => robotsRule(r).test(path));
}
/** Regra do robots.txt como prefixo, com "*" (qualquer trecho) e "$" (fim). */
function robotsRule(rule: string): RegExp {
  const end = rule.endsWith("$");
  const body = (end ? rule.slice(0, -1) : rule).split("*").map(p => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${end ? "$" : ""}`);
}

export function nameMatches(target: EnrichTarget, c: Pick<CompanyData, "tradeName" | "legalName">): boolean {
  const mine = new Set([target.name, target.company, target.tradeName, target.legalName].flatMap(tokens));
  if (!mine.size) return false;
  const theirs = [c.tradeName, c.legalName].flatMap(tokens);
  const shared = theirs.filter(t => mine.has(t));
  const whole = [c.tradeName, c.legalName].map(norm).filter(v => v.length >= 4);
  const mineWhole = [target.name, target.company, target.tradeName].map(norm).filter(v => v.length >= 4);
  return shared.length >= 2 || (shared.length === 1 && shared[0].length >= 5) || whole.some(w => mineWhole.some(m => m.includes(w) || w.includes(m)));
}
export function locationMatches(target: EnrichTarget, c: Pick<CompanyData, "city" | "state">): "match" | "mismatch" | "unknown" {
  if (target.state && c.state && target.state.toUpperCase() !== c.state.toUpperCase()) return "mismatch";
  if (target.city && c.city) return norm(target.city) === norm(c.city) ? "match" : "mismatch";
  if (target.address && c.city && norm(target.address).includes(norm(c.city))) return "match";
  return "unknown";
}
export function addressMatches(target: EnrichTarget, c: Pick<CompanyData, "address">): boolean {
  if (!target.address || !c.address) return false;
  const a = tokens(target.address), b = new Set(tokens(c.address));
  const num = (v: string) => (norm(v).match(/\b\d{1,5}\b/) ?? [""])[0];
  return a.filter(t => b.has(t) && !/^\d+$/.test(t)).length >= 2 && num(target.address) !== "" && num(target.address) === num(c.address);
}
/** Associação confiável: localização compatível e (nome ou endereço). Sem localização, só vale com nome E fonte da própria empresa. */
/** Mesmo domínio entre o site da empresa e o site/e-mail do cadastro público. */
export function domainMatches(target: EnrichTarget, c: Pick<CompanyData, "website" | "emails">): boolean {
  const host = (v: string) => { try { return new URL(v.includes("://") ? v : `https://${v}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
  const mine = host(target.website);
  if (!mine || /gmail|hotmail|outlook|yahoo|bol\.com|uol\.com/.test(mine)) return false;
  return host(c.website) === mine || c.emails.some(e => e.toLowerCase().endsWith(`@${mine}`));
}
export function assessCandidate(target: EnrichTarget, c: CompanyData, how: CandidateHow): boolean {
  if (how === "cnpj") return true;
  const loc = locationMatches(target, c);
  if (loc === "mismatch") return false;
  const nm = nameMatches(target, c), addr = addressMatches(target, c), dom = domainMatches(target, c);
  if (loc === "match") return nm || addr || dom;
  return (how === "site" && nm) || (nm && dom);
}
export function pickReliable<T extends { company: CompanyData; how: CandidateHow }>(target: EnrichTarget, candidates: T[]): T | "ambiguous" | null {
  const unique = reliableCandidates(target, candidates);
  if (unique.length === 1) return unique[0];
  return unique.length > 1 ? "ambiguous" : null;
}
export function reliableCandidates<T extends { company: CompanyData; how: CandidateHow }>(target: EnrichTarget, candidates: T[]): T[] {
  const ok = candidates.filter(c => assessCandidate(target, c.company, c.how));
  return [...new Map(ok.map(c => [c.company.cnpj, c])).values()];
}

/** Campos mostrados no card e na lista, sempre todos — inclusive os pendentes — com valor, fonte e situação. */
export type FieldState = "not_searched" | "found" | "not_found" | "error";
export type FieldRow = { key: "cnpj" | "legalName" | "address" | "website" | "siteEmail" | "fiscalEmail" | "whatsapp"; label: string; value: string; source: string; sourceUrl: string; state: FieldState; note?: string };
export const FIELD_STATE_LABEL: Record<FieldState, string> = { not_searched: "Ainda não pesquisado", found: "Encontrado", not_found: "Não encontrado", error: "Falha na consulta" };
const REGISTRY = "Cadastro público do CNPJ (Receita Federal)";
export function fieldRows(result: PublicEnrichResult | null, failed = false): FieldRow[] {
  const base: Omit<FieldRow, "value" | "source" | "sourceUrl" | "state">[] = [
    { key: "cnpj", label: "CNPJ" }, { key: "legalName", label: "Razão social" }, { key: "address", label: "Endereço" },
    { key: "website", label: "Site" }, { key: "siteEmail", label: "E-mail publicado pela empresa" },
    { key: "fiscalEmail", label: "E-mail do cadastro fiscal" }, { key: "whatsapp", label: "WhatsApp" },
  ];
  if (!result) return base.map(b => ({ ...b, value: "", source: "", sourceUrl: "", state: failed ? "error" : "not_searched" }));
  const c = result.company, regUrl = c?.sourceReference.split(" · ")[1] ?? "";
  const site = result.site, siteUrl = result.siteUrl ?? site?.pages[0] ?? "";
  const how = result.identified?.how;
  const cnpjSource = how === "site" ? "CNPJ publicado no site oficial" : how === "busca" ? "Busca pública na web, conferida no cadastro do CNPJ" : how === "historico" ? "Histórico de consultas públicas" : REGISTRY;
  const cnpjErr = Boolean(result.errors?.cnpj), siteErr = Boolean(result.errors?.site);
  const reg = (v: string, note?: string): Pick<FieldRow, "value" | "source" | "sourceUrl" | "state" | "note"> =>
    v ? { value: v, source: REGISTRY, sourceUrl: regUrl, state: "found", note } : { value: "", source: "", sourceUrl: "", state: cnpjErr && !c ? "error" : "not_found", note: result.ambiguous ? "Mais de uma empresa compatível: escolha abaixo." : undefined };
  const fromSite = (v: string, src: string, note?: string): Pick<FieldRow, "value" | "source" | "sourceUrl" | "state" | "note"> =>
    v ? { value: v, source: src, sourceUrl: siteUrl, state: "found", note } : { value: "", source: "", sourceUrl: "", state: siteErr ? "error" : "not_found", note: !siteUrl ? "Sem site oficial para ler." : site?.blocked ? "O site não permite leitura automática." : undefined };
  const wa = site?.whatsapp[0] ?? "";
  return base.map(b => {
    switch (b.key) {
      case "cnpj": return { ...b, ...(c ? { value: c.cnpj, source: cnpjSource, sourceUrl: regUrl, state: "found" as const } : reg("")) };
      case "legalName": return { ...b, ...reg(c?.legalName ?? "") };
      case "address": return { ...b, ...reg(c?.address ?? "") };
      case "website": return { ...b, ...(siteUrl ? { value: siteUrl, source: "Google Maps / cadastro", sourceUrl: siteUrl, state: "found" as const } : reg(c?.website ?? "")) };
      case "siteEmail": return { ...b, ...fromSite(site?.emails[0] ?? "", "Página de contato/rodapé do site oficial") };
      case "fiscalEmail": return { ...b, ...reg(c?.emails[0] ?? "", "Do cadastro fiscal; às vezes pertence ao contador.") };
      case "whatsapp": return { ...b, ...fromSite(wa, "Botão de WhatsApp no site oficial", undefined) };
    }
  });
}

const same = (a: string, b: string) => norm(a) === norm(b) || a.replace(/\D/g, "") !== "" && a.replace(/\D/g, "") === b.replace(/\D/g, "");
export function buildFindings(current: { company: string; email: string; whatsapp: string; website: string; cnpj: string }, company: CompanyData | null, site: SiteScan | null, siteUrl: string, sourceName: string, sourceUrl: string): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => { if (f.value && !same(f.value, f.current) && !out.some(o => o.key === f.key)) out.push(f); };
  if (company) {
    add({ key: "cnpj", label: "CNPJ", value: company.cnpj, current: current.cnpj, source: sourceName, sourceUrl, autoFill: true });
    add({ key: "company", label: "Empresa (razão social)", value: company.legalName, current: current.company, source: sourceName, sourceUrl, autoFill: true });
  }
  const siteEmail = site?.emails[0] ?? "";
  if (siteEmail) add({ key: "email", label: "E-mail", value: siteEmail, current: current.email, source: "Site oficial da empresa", sourceUrl: siteUrl, autoFill: true });
  else if (company?.emails[0]) add({ key: "email", label: "E-mail", value: company.emails[0], current: current.email, source: sourceName, sourceUrl, autoFill: false, note: "E-mail do cadastro público; às vezes pertence ao contador da empresa." });
  const wa = site?.whatsapp[0] ?? "", tel = site?.phones[0] ?? "";
  if (wa) add({ key: "whatsapp", label: "WhatsApp", value: wa, current: current.whatsapp, source: "Botão de WhatsApp no site oficial", sourceUrl: siteUrl, autoFill: true });
  else if (tel) add({ key: "whatsapp", label: "Telefone", value: tel, current: current.whatsapp, source: "Site oficial da empresa", sourceUrl: siteUrl, autoFill: true, note: "Telefone comercial; não confirma que é WhatsApp." });
  else if (company?.phones[0]) add({ key: "whatsapp", label: "Telefone", value: company.phones[0], current: current.whatsapp, source: sourceName, sourceUrl, autoFill: false, note: "Telefone do cadastro público; não confirma que é WhatsApp." });
  if (company?.website) add({ key: "website", label: "Site", value: company.website, current: current.website, source: sourceName, sourceUrl, autoFill: true });
  return out;
}

/** Junta o cadastro público ao perfil existente sem apagar nem trocar dados já preenchidos. */
export function mergeProfile(existing: CompanyData | null, pub: CompanyData, fallbackName: string): CompanyData {
  const base: CompanyData = existing ?? { placeId: "", cnpj: "", legalName: "", tradeName: fallbackName.slice(0, 300), registrationStatus: "", segment: "", city: "", state: "", address: "", phones: [], emails: [], website: "", instagram: "", source: "manual", sourceReference: "Consulta Pública Gratuita" };
  const pick = <K extends keyof CompanyData>(k: K) => (base[k] as unknown) || pub[k];
  return {
    ...base,
    cnpj: base.cnpj || pub.cnpj, legalName: pick("legalName") as string, tradeName: pick("tradeName") as string,
    registrationStatus: pub.registrationStatus || base.registrationStatus, segment: pick("segment") as string,
    city: pick("city") as string, state: pick("state") as CompanyData["state"], address: pick("address") as string,
    phones: [...new Set([...base.phones, ...pub.phones])].slice(0, 10), emails: [...new Set([...base.emails, ...pub.emails])].slice(0, 10),
    publicDetails: base.publicDetails ?? pub.publicDetails,
    evidence: [...(base.evidence ?? []), ...(pub.evidence ?? [])].slice(-20),
  };
}
