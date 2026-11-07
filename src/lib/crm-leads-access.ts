import { z } from "zod";
import { canAccessLead, canAdminister, canMoveLead, type CrmPrincipal } from "./crm-permissions";
import type { CrmSessionLevel } from "./crm-session-token";

export const crmLeadId = z.string().uuid();
const text = z.string().max(20000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const crmLeadInput = z.object({
  id: crmLeadId, pipelineId: z.string().uuid().nullable().optional(),
  name: text, company: text, whatsapp: text, email: text, instagram: text, website: text,
  investedTraffic: text, revenue: text, employees: text, source: text,
  utmSource: text.optional(), utmMedium: text.optional(), utmCampaign: text.optional(), utmContent: text.optional(), utmTerm: text.optional(),
  service: text, potentialValue: z.number().finite(),
  // Somente leitura aqui: o valor fechado é gravado por confirmLeadClosedValue, nunca pelo salvamento do card.
  closedValue: z.number().finite().nullable().optional(), closedValueConfirmedAt: z.string().max(80).nullable().optional(),
  owner: text, entryDate: date,
  nextAction: text, nextActionDate: z.union([date, z.literal("")]), status: text, stage: z.string().min(1).max(100),
  tags: z.array(z.string().max(100)).max(100), notes: text, lastConversation: text, nextSteps: text,
  history: z.array(z.object({ id: z.string().min(1).max(240), date: z.string().max(80), text,
    kind: text.optional(), source: text.optional(), result: text.optional(), direction: text.optional(), note: text.optional(), responsible: text.optional(), client: z.string().uuid().optional(),
  }).strict()).max(5000),
}).strict();

export function crmPrincipal(level: CrmSessionLevel | null): CrmPrincipal {
  return level ? { role: level === "full" ? "admin" : "team", active: true } : null;
}

export function assertCrmLeadWrite(level: CrmSessionLevel, existing: { stage: string; pipeline_id: string | null } | null, target: { stage: string; pipelineId?: string | null }) {
  const principal = crmPrincipal(level);
  if (!canAccessLead(principal, target.stage) || (existing && !canMoveLead(principal, existing.stage, target.stage))) throw new Error("Acesso negado a esta etapa.");
  if (level === "limited" && ((existing?.pipeline_id ?? null) !== null || (target.pipelineId ?? null) !== null)) throw new Error("Este funil exige acesso completo.");
}

export function assertCrmAdmin(level: CrmSessionLevel | null) {
  if (!canAdminister(crmPrincipal(level))) throw new Error("Esta ação exige acesso completo.");
}

export const zapierDestination = z.union([z.literal(""), z.string().url().max(2000).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "hooks.zapier.com" && url.port === "" && !url.username && !url.password && url.pathname.startsWith("/hooks/catch/") && !url.hash;
}, "Use um endereço HTTPS de webhook do Zapier.")]);