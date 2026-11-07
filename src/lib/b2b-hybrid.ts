import { z } from "zod";
import { cnpjInput, lookupInput, type CompanyData } from "./b2b-prospecting";

export const publicLookupInput = z.object({ cnpj: cnpjInput, purposeConfirmed: z.literal(true) }).strict();
export const publicNameInput = z.object({ name: z.string().trim().min(2).max(150), purposeConfirmed: z.literal(true) }).strict();
export function matchPublicCompanyNames(companies: CompanyData[], name: string): CompanyData[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const query = normalize(name.trim());
  if (query.length < 2) return [];
  const seen = new Set<string>();
  return companies.filter(c => {
    if (seen.has(c.cnpj) || ![c.legalName, c.tradeName].some(n => normalize(n).includes(query))) return false;
    seen.add(c.cnpj); return true;
  }).slice(0, 20);
}
export function assertPartnerEnrichment(input: { keyType: string; selected: string[] }) {
  if (input.keyType !== "cnpj" || !input.selected.length || input.selected.some(s => !ENRICHMENT_OPTIONS.some(o => o.id === s))) throw new Error("DeskData disponível somente por CNPJ, com conjuntos selecionados e confirmação de custo.");
}
export const ENRICHMENT_OPTIONS = [
  { id: "basic", label: "Dados cadastrais: porte, capital social e CNAE", datasets: ["basic"] },
  { id: "relationships", label: "Dados básicos de sócios", datasets: ["basic", "relationships"] },
  { id: "relationships_phones", label: "Telefones de sócios", datasets: ["basic", "relationships", "relationships_phones"] },
] as const;
export const quoteInput = lookupInput.innerType().omit({ confirmed: true }).extend({
  selected: z.array(z.enum(["basic", "relationships", "relationships_phones"])).max(3),
}).strict().refine(v => lookupInput.safeParse({keyType:v.keyType,key:v.key,confirmed:true}).success, "Informe nome ou CNPJ válido.");
export const paidLookupInput = lookupInput.innerType().extend({ quote: z.string().min(1).max(10000) }).strict().refine(v => lookupInput.safeParse({keyType:v.keyType,key:v.key,confirmed:v.confirmed}).success, "Informe nome ou CNPJ válido.");
export type QuoteInput = z.infer<typeof quoteInput>;
export function requestedDatasets(input: QuoteInput): string[] {
  if (input.keyType === "name") return ["basic"];
  return [...new Set(["basic", ...ENRICHMENT_OPTIONS.filter(o => input.selected.includes(o.id)).flatMap(o => [...o.datasets])])].sort();
}
export function estimateDeskCredits(datasets: string[], configured: string[], costs: Record<string, number>) {
  if (datasets.some(d => !configured.includes(d))) return null;
  if (datasets.some(d => !Number.isSafeInteger(costs[d]) || costs[d] <= 0)) return null;
  const total = datasets.reduce((sum, d) => sum + costs[d], 0);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}
export function mergeCompanyData(current: CompanyData, incoming: CompanyData): CompanyData {
  if (current.cnpj && current.cnpj.replace(/[./\s-]/g, "").toUpperCase() !== incoming.cnpj) return { ...incoming, placeId: current.placeId };
  const result = { ...current };
  for (const key of ["cnpj", "legalName", "tradeName", "registrationStatus", "segment", "city", "state", "address", "website", "instagram"] as const) {
    if (!result[key] && incoming[key]) Object.assign(result, { [key]: incoming[key] });
  }
  result.phones = [...new Set([...current.phones, ...incoming.phones])].slice(0, 10);
  result.emails = [...new Set([...current.emails, ...incoming.emails])].slice(0, 10);
  result.whatsappNumbers = [...new Set([...(current.whatsappNumbers ?? []), ...(incoming.whatsappNumbers ?? [])])].slice(0, 10);
  // Names are not an identity key for associating personal contacts. Preserve each source record separately.
  result.partners = [...(current.partners ?? []), ...(incoming.partners ?? []).filter(p =>
    !(current.partners ?? []).some(old => JSON.stringify(old) === JSON.stringify(p)))].slice(0, 10);
  result.publicDetails = current.publicDetails ?? incoming.publicDetails;
  if (current.publicDetails && incoming.publicDetails) {
    const old = current.publicDetails, next = incoming.publicDetails;
    result.publicDetails = {
      ...old,
      companySize: old.companySize || next.companySize,
      capital: old.capital ?? next.capital,
      cnae: old.cnae || next.cnae,
      openedOn: old.openedOn || next.openedOn,
      postalCode: old.postalCode || next.postalCode,
      // Keep each registry's source separate in evidence; never relabel existing data.
      registrySource: [...new Set([old.registrySource || current.evidence?.find(e => e.kind === "reported")?.source || "Fonte cadastral anterior", next.registrySource || incoming.evidence?.find(e => e.kind === "reported")?.source || ""].filter(Boolean))].join(" + ").slice(0, 100),
    };
  }
  result.evidence = [...(current.evidence ?? []), ...(incoming.evidence ?? [])].slice(-20);
  result.sourceReference = [current.sourceReference, incoming.sourceReference].filter(Boolean).join("; ").slice(0, 500);
  if (!current.sourceReference) result.source = incoming.source;
  return result;
}