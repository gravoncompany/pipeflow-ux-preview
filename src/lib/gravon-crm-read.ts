import { z } from "zod";
import { DEFAULT_STAGES } from "./crm-types";

// Wire schemas remain simple; bounds and known stages are checked at execution time.
export const crmCountInput = z.object({ stage: z.string().nullable(), startDate: z.string().nullable(), endDate: z.string().nullable() }).strict();
export const crmLookupInput = z.object({ field: z.enum(["name", "company", "phone", "id"]), query: z.string() }).strict();
export type CrmCountInput = z.infer<typeof crmCountInput>;
export type CrmLookupInput = z.infer<typeof crmLookupInput>;
export type CrmReadGrant = { instance: string; phone: string; revision: string };

export function validateCountInput(raw: unknown): CrmCountInput {
  const input = crmCountInput.parse(raw);
  if (input.stage !== null && !DEFAULT_STAGES.some((s) => s.id === input.stage)) throw new Error("Etapa não disponível para consulta.");
  for (const value of [input.startDate, input.endDate]) {
    if (value !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error("Período inválido.");
  }
  if (input.startDate && input.endDate && input.startDate > input.endDate) throw new Error("Período inválido.");
  return input;
}

export function validateLookupInput(raw: unknown): CrmLookupInput {
  const input = crmLookupInput.parse(raw);
  const query = input.query.trim();
  if (query.length < 2 || query.length > 160 || /[%_*\x00-\x1f]/.test(query)) throw new Error("Informe nome, empresa, telefone ou identificador exato.");
  if (input.field === "id" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query)) throw new Error("Identificador inválido.");
  return { ...input, query };
}

export function knownStageTitle(id: string): string {
  return DEFAULT_STAGES.find((s) => s.id === id)?.title ?? "Etapa personalizada (nome indisponível)";
}