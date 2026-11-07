import { z } from "zod";
import { sameWhatsAppNumber } from "./phone";

export const CS_STAGES = { novo: "Novo Cliente", onboarding: "Onboarding", implementacao: "Implementação", acompanhamento: "Acompanhamento", renovacao: "Renovação", encerrado: "Encerrado" } as const;
export const CS_HEALTH = { saudavel: "Saudável", atencao: "Atenção", em_risco: "Em risco" } as const;
export const CS_RISK = { baixo: "Baixo", medio: "Médio", alto: "Alto" } as const;
export const stageSchema = z.enum(["novo", "onboarding", "implementacao", "acompanhamento", "renovacao", "encerrado"]);
export const healthSchema = z.enum(["saudavel", "atencao", "em_risco"]);
export const riskForHealth = (health: z.infer<typeof healthSchema>) => ({ saudavel: "baixo", atencao: "medio", em_risco: "alto" } as const)[health];
export const csUpdateSchema = z.object({
  clientId: z.string().uuid(), revision: z.number().int().min(0), eventId: z.string().uuid(),
  stage: stageSchema.optional(), health: healthSchema.optional(), note: z.string().trim().max(3000).default(""),
  followedAt: z.string().datetime({ offset: true }).optional(), evaluationId: z.string().uuid().optional(),
}).strict().refine(v => v.stage !== undefined || v.health !== undefined || v.followedAt !== undefined, "Informe a alteração.")
  .refine(v => !v.health || v.note.length >= 3 || !!v.evaluationId, "Registre o motivo da avaliação.");
export const diagnosisSchema = z.object({
  health: healthSchema, reasons: z.array(z.string().trim().min(3).max(800)).min(1).max(8),
  evidence: z.array(z.object({ messageId: z.string().uuid(), quote: z.string().trim().min(3).max(1000) }).strict()).min(1).max(8),
  actions: z.array(z.string().trim().min(3).max(1000)).min(1).max(8),
}).strict();
export type CsMessage = { id: string; body: string; from_me: boolean; sent_at: string; instance: string };

export function gravonCsInstances(channels: { instance: string; company_key: string }[]) {
  return [...new Set(channels.filter(c => c.company_key === "crm:1" && c.instance && !channels.some(other => other.instance === c.instance && other.company_key !== "crm:1")).map(c => c.instance))];
}
export function isCsClientMessage(message: { phone: string; instance: string; remote_jid: string | null; body: string }, number: string, instances: string[]) {
  return instances.includes(message.instance) && sameWhatsAppNumber(message.phone, number) && (!message.remote_jid || message.remote_jid.endsWith("@s.whatsapp.net")) && !!message.body.trim();
}

/** Every diagnosis must cite literal inbound evidence from this exact client snapshot. */
export function validateDiagnosis(input: unknown, messages: CsMessage[]) {
  const d = diagnosisSchema.parse(input);
  for (const e of d.evidence) {
    const source = messages.find(m => m.id === e.messageId);
    if (!source || source.from_me || !source.body.includes(e.quote)) throw new Error("A análise não apresentou evidências válidas nas mensagens do cliente.");
  }
  return d;
}

export type CsFilterRow = { trade_name: string; status: string; internal_responsible: string; stage: string; health: string | null; last_followup_at: string | null };
export function filterCsClients<T extends CsFilterRow>(rows: T[], f: { search: string; status: string; risk: string; health: string; responsible: string; followup: string }, now = Date.now()) {
  return rows.filter(c => {
    if (f.search && !c.trade_name.toLocaleLowerCase("pt-BR").includes(f.search.toLocaleLowerCase("pt-BR"))) return false;
    if (f.status !== "todos" && c.status !== f.status) return false;
    if (f.health !== "todos" && (c.health ?? "sem_avaliacao") !== f.health) return false;
    if (f.risk !== "todos" && (c.health ? riskForHealth(healthSchema.parse(c.health)) : "sem_avaliacao") !== f.risk) return false;
    if (f.responsible !== "todos" && (c.internal_responsible || "sem_responsavel") !== f.responsible) return false;
    if (f.followup === "nunca" && c.last_followup_at) return false;
    if (f.followup === "atrasado" && c.last_followup_at && now - Date.parse(c.last_followup_at) < 30 * 86400000) return false;
    if (f.followup === "recente" && (!c.last_followup_at || now - Date.parse(c.last_followup_at) >= 30 * 86400000)) return false;
    return true;
  });
}