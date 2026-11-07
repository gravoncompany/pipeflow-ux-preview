import { companyInput, safeHttps, type CompanyData, type CompanyInput, type Place, type SearchInput } from "./b2b-prospecting";
import { businessLinks } from "./business-links";
import { collectEmails, collectPhones } from "./bulk-actions";

// Cadastro em massa a partir da pesquisa (sem revisão individual). CNPJ não é obrigatório: empresa sem CNPJ usa o
// identificador do Google Maps, como já aceito pela importação existente. Nunca inventa e-mail, CNPJ ou razão social.
export type BulkCompanyResult = { ok: true; company: CompanyInput } | { ok: false; reason: string };
export function placeToCompany(place: Place, search: Pick<SearchInput, "city" | "state"> | null, prepared?: CompanyData): BulkCompanyResult {
  if (prepared) {
    const parsed = companyInput.safeParse({ ...prepared, identityConfirmed: true, storageAuthorized: true });
    return parsed.success ? { ok: true, company: parsed.data } : { ok: false, reason: "dados revisados incompletos" };
  }
  const links = businessLinks(place.website || "", place.instagram || "");
  const phones = collectPhones([place.phone]).filter(p => /^\+?\d{8,15}$/.test(p));
  const candidate = {
    placeId: place.id, cnpj: "", legalName: "", tradeName: place.name.trim().slice(0, 300), registrationStatus: "",
    segment: (place.category || "").slice(0, 300), city: (search?.city ?? "").slice(0, 300), state: search?.state ?? "",
    address: (place.address || "").slice(0, 700), phones, emails: [] as string[],
    website: links.website && safeHttps(links.website) ? links.website : "",
    instagram: links.instagram && safeHttps(links.instagram) ? links.instagram : "",
    source: "manual" as const, sourceReference: "Pesquisa Google Maps · cadastro em massa confirmado pelo usuário",
    identityConfirmed: true as const, storageAuthorized: true as const,
  };
  const parsed = companyInput.safeParse(candidate);
  if (parsed.success) return { ok: true, company: parsed.data };
  if (!/^[A-Za-z0-9_-]+$/.test(place.id)) return { ok: false, reason: "identificador do Google Maps inválido" };
  if (candidate.tradeName.length < 2) return { ok: false, reason: "nome da empresa ausente" };
  return { ok: false, reason: "dados inválidos para cadastro" };
}
// Contatos disponíveis de cada empresa selecionada: dados revisados/enriquecidos têm prioridade sobre o Google Maps.
export function companyEmails(prepared?: CompanyData): string[] { return collectEmails([prepared?.emails ?? []]).emails; }
export function companyPhones(place?: Place, prepared?: CompanyData): string[] { return collectPhones([prepared?.phones ?? [], prepared?.whatsappNumbers ?? [], place?.phone]); }

// Identificação de CNPJ pelo histórico privado de consultas públicas: só associa quando há exatamente um candidato
// com nome compatível e mesma cidade/UF. Ambíguo ou sem candidato fica sem CNPJ (nunca adivinha).
export type CnpjStatus = "pendente" | "identificado" | "nao_encontrado" | "ambiguo" | "enriquecido";
export const CNPJ_STATUS_LABEL: Record<CnpjStatus, string> = { pendente: "Identificação pendente", identificado: "CNPJ identificado", nao_encontrado: "CNPJ não encontrado", ambiguo: "CNPJ ambíguo (confirme na revisão)", enriquecido: "Dados enriquecidos" };
const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export function pickCnpjCandidate(place: Place, candidates: CompanyData[], search: Pick<SearchInput, "city" | "state"> | null): { status: "identificado"; company: CompanyData } | { status: "nao_encontrado" | "ambiguo" } {
  const city = norm(search?.city ?? ""), uf = (search?.state ?? "").toUpperCase(), name = norm(place.name);
  const sameName = candidates.filter(c => c.cnpj && [c.tradeName, c.legalName].some(n => { const v = norm(n); return v.length >= 3 && (v === name || v.includes(name) || name.includes(v)); }));
  const sameLocation = sameName.filter(c => (!uf || !c.state || c.state === uf) && (!city || !c.city || norm(c.city) === city));
  const unique = [...new Map(sameLocation.map(c => [c.cnpj, c])).values()];
  if (unique.length === 1) return { status: "identificado", company: unique[0] };
  return { status: unique.length > 1 ? "ambiguo" : "nao_encontrado" };
}
// Junta o cadastro público (CNPJ identificado) aos dados do Google Maps, sem perder o identificador do Maps.
export function mergeIdentified(place: Place, search: Pick<SearchInput, "city" | "state"> | null, publicCompany: CompanyData): CompanyData {
  const base = placeToCompany(place, search);
  const maps = base.ok ? base.company : null;
  return { ...publicCompany, placeId: place.id, tradeName: publicCompany.tradeName || place.name, address: publicCompany.address || place.address,
    phones: collectPhones([publicCompany.phones, maps?.phones ?? []]).filter(p => /^\+?\d{8,15}$/.test(p)).slice(0, 10),
    website: publicCompany.website || maps?.website || "", instagram: publicCompany.instagram || maps?.instagram || "",
    sourceReference: `${publicCompany.sourceReference || "Consulta pública de CNPJ"} · Google Maps ${place.id}`.slice(0, 500) };
}
