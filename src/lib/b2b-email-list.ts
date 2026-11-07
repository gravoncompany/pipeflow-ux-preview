// Pure helpers for importing B2B companies from an e-mail list (CSV, XLSX or pasted text). No network, no CRM writes.
import { BRAZIL_STATES, validCnpj, type CompanyInput } from "./b2b-prospecting";

export const LIST_FIELDS = [
  { id: "name", label: "Nome da empresa", required: true },
  { id: "email", label: "E-mail", required: true },
  { id: "phone", label: "Telefone" },
  { id: "website", label: "Site" },
  { id: "contactName", label: "Nome do responsável" },
  { id: "contactRole", label: "Cargo" },
  { id: "cnpj", label: "CNPJ" },
  { id: "city", label: "Cidade" },
  { id: "state", label: "Estado" },
  { id: "notes", label: "Observações" },
] as const;
export type ListField = (typeof LIST_FIELDS)[number]["id"];
export type ColumnMap = Partial<Record<ListField, number>>;
export type ListRow = { key: string; name: string; emails: string[]; phone: string; website: string; contactName: string; contactRole: string; cnpj: string; city: string; state: string; notes: string };

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const HINTS: Record<ListField, string[]> = {
  name: ["empresa", "nome da empresa", "razao social", "nome fantasia", "company", "organizacao", "cliente", "nome"],
  email: ["email", "e mail", "mail", "emails", "e mails"],
  phone: ["telefone", "celular", "whatsapp", "fone", "phone", "tel"],
  website: ["site", "website", "url", "pagina", "web"],
  contactName: ["responsavel", "contato", "nome do responsavel", "nome do contato", "decisor"],
  contactRole: ["cargo", "funcao", "role", "posicao"],
  cnpj: ["cnpj"],
  city: ["cidade", "municipio", "city"],
  state: ["estado", "uf", "state"],
  notes: ["observacoes", "observacao", "obs", "notas", "notes", "comentarios"],
};

/** Parses CSV or pasted text (comma, semicolon or tab), honoring quotes. */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = first.includes("\t") ? "\t" : (first.split(";").length > first.split(",").length ? ";" : ",");
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) { if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && clean[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(Boolean));
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
export const isEmail = (s: string) => EMAIL_RE.test(s) && s.length <= 254;

/** Guesses columns from the header row; when there is no header (first row has an e-mail), maps by content. */
export function guessColumns(rows: string[][]): { map: ColumnMap; hasHeader: boolean } {
  const head = rows[0] ?? [];
  const hasHeader = !head.some(c => isEmail(c.split(/[,;\s]+/)[0] ?? ""));
  const map: ColumnMap = {};
  if (hasHeader) {
    const used = new Set<number>();
    for (const f of LIST_FIELDS) {
      // exact match first, then contains
      let idx = head.findIndex((h, i) => !used.has(i) && HINTS[f.id].includes(norm(h)));
      if (idx < 0) idx = head.findIndex((h, i) => !used.has(i) && HINTS[f.id].some(k => k.length > 3 && norm(h).includes(k)));
      if (idx >= 0) { map[f.id] = idx; used.add(idx); }
    }
  } else {
    const e = head.findIndex(c => isEmail(c.split(/[,;\s]+/)[0] ?? ""));
    if (e >= 0) map.email = e;
    const n = head.findIndex((_, i) => i !== e);
    if (n >= 0) map.name = n;
  }
  return { map, hasHeader };
}

export function rowsFromTable(rows: string[][], map: ColumnMap, hasHeader: boolean): ListRow[] {
  const get = (r: string[], f: ListField) => (map[f] === undefined ? "" : String(r[map[f]!] ?? "").trim());
  return rows.slice(hasHeader ? 1 : 0).map((r, i) => ({
    key: `r${i}-${Math.random().toString(36).slice(2, 8)}`,
    name: get(r, "name"),
    emails: [...new Set(get(r, "email").split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean))],
    phone: get(r, "phone"), website: get(r, "website"), contactName: get(r, "contactName"), contactRole: get(r, "contactRole"),
    cnpj: get(r, "cnpj"), city: get(r, "city"), state: get(r, "state").toUpperCase(), notes: get(r, "notes"),
  })).filter(r => r.name || r.emails.length);
}

export type RowStatus = { ok: boolean; issues: string[]; duplicateOf: string | null };

/** Required fields, e-mail format and duplicates inside the imported list (same e-mail or same company name). */
export function validateRows(rows: ListRow[]): Record<string, RowStatus> {
  const seenEmail = new Map<string, string>(), seenName = new Map<string, string>(), out: Record<string, RowStatus> = {};
  for (const r of rows) {
    const issues: string[] = [];
    if (r.name.trim().length < 2) issues.push("Falta o nome da empresa");
    if (!r.emails.length) issues.push("Falta o e-mail");
    const bad = r.emails.filter(e => !isEmail(e));
    if (bad.length) issues.push(`E-mail inválido: ${bad.join(", ")}`);
    if (r.cnpj && !validCnpj(r.cnpj.replace(/\D/g, ""))) issues.push("CNPJ inválido");
    if (r.website && !/^https:\/\//i.test(normalizeSite(r.website))) issues.push("Site inválido");
    let dup: string | null = null;
    const n = norm(r.name);
    for (const e of r.emails) if (seenEmail.has(e)) dup = seenEmail.get(e)!;
    if (!dup && n && seenName.has(n)) dup = seenName.get(n)!;
    if (!dup) { for (const e of r.emails) seenEmail.set(e, r.key); if (n) seenName.set(n, r.key); }
    out[r.key] = { ok: !issues.length && !dup, issues, duplicateOf: dup };
  }
  return out;
}

export function normalizeSite(s: string) {
  const t = s.trim(); if (!t) return "";
  const u = /^https?:\/\//i.test(t) ? t.replace(/^http:/i, "https:") : `https://${t}`;
  try { const url = new URL(u); return url.hostname.includes(".") ? url.href : ""; } catch { return ""; }
}

/** Builds the reviewed company payload accepted by importB2b (source "lista", no CNPJ required). */
export function toCompanyInput(r: ListRow, fileLabel: string): CompanyInput {
  const digits = r.phone.replace(/\D/g, ""), cnpj = r.cnpj.replace(/\D/g, "");
  const validC = cnpj.length === 14 && validCnpj(cnpj);
  const state = (BRAZIL_STATES as readonly string[]).includes(r.state) ? r.state as CompanyInput["state"] : "";
  return {
    placeId: "", cnpj: validC ? cnpj : "", legalName: validC ? r.name.trim() : "", tradeName: r.name.trim(),
    registrationStatus: "", segment: "", city: r.city.slice(0, 300), state, address: "",
    phones: digits.length >= 8 && digits.length <= 15 ? [digits] : [],
    emails: r.emails.filter(isEmail).slice(0, 10), website: normalizeSite(r.website),
    source: "lista", sourceReference: `Lista de e-mails importada (${fileLabel}) e revisada pelo usuário`.slice(0, 500),
    ...(r.contactName ? { contactName: r.contactName.slice(0, 200) } : {}),
    ...(r.contactRole ? { contactRole: r.contactRole.slice(0, 200) } : {}),
    ...(r.notes ? { notes: r.notes.slice(0, 1000) } : {}),
    identityConfirmed: true, storageAuthorized: true,
  };
}
