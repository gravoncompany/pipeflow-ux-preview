import { z } from "zod";
import { cnpjInput, companyFields } from "./b2b-prospecting";

export const deskSelections = [
  { id: "basic", label: "Dados cadastrais da empresa" },
  { id: "addresses", label: "Endereços comerciais" },
  { id: "phones", label: "Telefones comerciais" },
  { id: "emails", label: "E-mails comerciais" },
  { id: "relationships", label: "Quadro societário" },
  { id: "relationships_phones", label: "Telefones dos sócios" },
] as const;
export const deskDataset = z.enum(["basic", "addresses", "phones", "emails", "relationships", "relationships_phones"]);
export const deskLeadInput = z.object({ leadId: z.string().uuid() }).strict();
export const deskBindInput = deskLeadInput.extend({ cnpj: cnpjInput, identityConfirmed: z.literal(true), storageAuthorized: z.literal(true) }).strict();
export const deskQuoteInput = deskLeadInput.extend({ selected: z.array(deskDataset).min(1).max(6) }).strict();
export const deskSendInput = deskLeadInput.extend({ quote: z.string().min(1).max(10000), confirmed: z.literal(true) }).strict();
export const deskRecoverInput = deskLeadInput.extend({ historyId: z.string().uuid() }).strict();
export const deskProfile = companyFields.omit({ identityConfirmed: true, storageAuthorized: true });
export const deskHistory = z.object({ id: z.string().uuid(), cnpj: z.string(), datasets: z.array(z.string()), estimated_credits: z.number(), status: z.enum(["pending", "success", "empty", "error", "unknown"]), profile: deskProfile.nullable(), outcome_code: z.string().nullable(), created_at: z.string(), checked_at: z.string(), recoverable: z.boolean() });
export type DeskHistory = z.infer<typeof deskHistory>;
export function leadDeskDatasets(selected: string[]) {
  return [...new Set(["basic", ...selected, ...(selected.includes("relationships_phones") ? ["relationships"] : [])])].sort();
}
export const deskStatusLabels = { pending: "Em processamento", success: "Concluída", empty: "Sem resultados", error: "Com erro", unknown: "Resultado não confirmado" } as const;
export function deskQueryCode(value: unknown) {
  return typeof value === "string" && /^Q-[A-F0-9]{10}$/.test(value) ? value : null;
}