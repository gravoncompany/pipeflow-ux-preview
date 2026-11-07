// Busca de e-mails comerciais públicos nos sites das empresas da Prospecção B2B.
// Regras puras (sem rede): classificação do tipo de contato, escolha do melhor e-mail,
// descoberta de páginas de equipe e resumo de uma rodada de pesquisa.
// Nunca inventa e-mails: só entra na lista o endereço lido literalmente de uma página pública.

export type EmailKind = "diretoria" | "comercial" | "administracao" | "geral";
export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  diretoria: "Diretoria",
  comercial: "Comercial",
  administracao: "Administração",
  geral: "Geral",
};

const KIND_WORDS: [EmailKind, RegExp][] = [
  ["diretoria", /^(diretoria|diretor|diretora|socio|socia|socios|ceo|presidente|presidencia|dono|dona|owner|fundador|fundadora|founder|principal)([._-]|$)/],
  ["comercial", /^(comercial|vendas?|negocios|orcamentos?|cotacao|propostas?|sales?|quotes?|parcerias?)([._-]|$)/],
  ["administracao", /^(administrativo|administracao|adm|financeiro|faturamento|contabil|contabilidade|juridico|rh|recursoshumanos|fiscal)([._-]|$)/],
];

/** Classifica o e-mail pela parte local publicada. Sem palavra reconhecida, é "geral". */
export function classifyEmail(email: string): EmailKind {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  for (const [kind, re] of KIND_WORDS) if (re.test(local)) return kind;
  return "geral";
}

export type SiteEmailContact = {
  email: string;
  kind: EmailKind;
  /** Página pública onde o endereço estava publicado. */
  page: string;
  /** "site" = publicado no site oficial; "fiscal" = e-mail do cadastro público do CNPJ. */
  source: "site" | "fiscal";
};

export type SiteEmailStatus = "encontrado" | "nao_encontrado" | "sem_site" | "site_bloqueado" | "erro";
export const SITE_EMAIL_STATUS_LABEL: Record<SiteEmailStatus, string> = {
  encontrado: "E-mail encontrado",
  nao_encontrado: "Não encontrado",
  sem_site: "Sem site oficial",
  site_bloqueado: "Site não permite leitura",
  erro: "Falha na pesquisa",
};

export type SiteEmailResult = {
  key: string;
  name: string;
  cnpj: string;
  site: string;
  contacts: SiteEmailContact[];
  status: SiteEmailStatus;
  note: string;
  checkedAt: string;
  /** Veio do cache de 24 h (nenhuma nova leitura do site foi feita). */
  fromCache: boolean;
};

const KIND_RANK: Record<EmailKind, number> = { diretoria: 0, comercial: 1, administracao: 2, geral: 3 };

/** Melhor contato para preencher o cadastro: prioriza diretoria > comercial > administração > geral,
 *  preferindo endereços do próprio domínio da empresa e publicados no site (não fiscais). */
export function bestContact(contacts: SiteEmailContact[], siteHost = ""): SiteEmailContact | null {
  if (!contacts.length) return null;
  const host = siteHost.replace(/^www\./, "").toLowerCase();
  const score = (c: SiteEmailContact) =>
    KIND_RANK[c.kind] * 10 + (c.source === "fiscal" ? 5 : 0) - (host && c.email.endsWith(`@${host}`) ? 2 : 0);
  return [...contacts].sort((a, b) => score(a) - score(b))[0];
}

/** Links de páginas de equipe/quem somos (complementam as páginas de contato já descobertas). */
export function teamLinks(html: string, base: string): string[] {
  let baseUrl: URL;
  try { baseUrl = new URL(base); } catch { return []; }
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const label = `${m[1]} ${m[2].replace(/<[^>]+>/g, " ")}`;
    if (!/equipe|time|quem[- ]somos|nossa[- ]historia|team|staff|people/i.test(label)) continue;
    try {
      const u = new URL(m[1], baseUrl);
      if (u.protocol === "https:" && u.host === baseUrl.host && u.href !== baseUrl.href) out.add(u.href.split("#")[0]);
    } catch { /* link inválido */ }
    if (out.size >= 2) break;
  }
  return [...out];
}

export type SiteEmailSummary = { consulted: number; withEmails: number; withSpecific: number; failed: number };
/** Resumo de uma rodada: consultadas, com e-mail, com contato específico (não geral) e falhas. */
export function summarizeEmailSearch(results: SiteEmailResult[]): SiteEmailSummary {
  return {
    consulted: results.length,
    withEmails: results.filter(r => r.contacts.length > 0).length,
    withSpecific: results.filter(r => r.contacts.some(c => c.kind !== "geral")).length,
    failed: results.filter(r => r.status === "erro" || r.status === "site_bloqueado").length,
  };
}
