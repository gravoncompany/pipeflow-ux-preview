import { z } from "zod";
import type { AnalysisMessage } from "./whatsapp-analysis";

/** Stage of the main funnel (pipeline_id null) where automatic qualification runs. */
export const QUALIFICATION_STAGE_ID = "qualificacao";

export const leadQualificationSchema = z.object({
  decision: z.enum(["qualified", "insufficient"]),
  summary: z.string(),
  interestEvidence: z.array(z.object({ messageId: z.string(), quote: z.string() }).strict()),
  fitReason: z.string(),
}).strict();
export type LeadQualificationResult = z.infer<typeof leadQualificationSchema>;

export type QualificationOutcome = "qualified" | "insufficient";

/**
 * Only literal quotes from the client's own messages count as evidence. "qualified" without at least one
 * valid quote, or without an explanation of service fit, is downgraded to "insufficient" (stays Em análise).
 */
export function decideQualification(result: LeadQualificationResult, messages: AnalysisMessage[]) {
  const evidence = result.interestEvidence
    .filter((e) => e.quote.trim().length >= 3 && messages.some((m) => m.message_id === e.messageId && !m.from_me && m.body.includes(e.quote)))
    .slice(0, 3)
    .map((e) => ({ messageId: e.messageId, quote: e.quote.trim().slice(0, 500) }));
  const outcome: QualificationOutcome = result.decision === "qualified" && evidence.length > 0 && result.fitReason.trim().length > 0 ? "qualified" : "insufficient";
  return { outcome, evidence, summary: result.summary.trim().slice(0, 4000), fitReason: result.fitReason.trim().slice(0, 2000) };
}

/** Commercial criteria shown to the model: the base rule plus the company's manual knowledge, bounded. */
export function criteriaText(entries: { title: string; text: string }[], maxChars = 30_000) {
  let out = "";
  for (const e of entries) {
    const block = `### ${e.title.trim() || "Sem título"}\n${e.text.trim().slice(0, 2000)}\n\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}

export type QualificationView = {
  status: "em_analise" | "qualificado";
  state: string;
  summary: string;
  fitReason: string;
  evidence: { messageId: string; quote: string }[];
  assessedAt: string | null;
  qualifiedAt: string | null;
  meta: { status: string; pixelId: string | null } | null;
};

export const qualificationLabel = { em_analise: "Em análise", qualificado: "Qualificado" } as const;

export function stateExplanation(state: string) {
  switch (state) {
    case "pending": case "running": return "A Gravon IA vai avaliar a conversa em alguns minutos.";
    case "no_conversation": return "Ainda não há conversa de WhatsApp com este número. Será reavaliado quando o cliente escrever.";
    case "ambiguous": return "Há mais de um card com este número no funil principal. Corrija o número para a IA avaliar.";
    case "failed": return "A avaliação não foi concluída. Nova tentativa automática em até uma hora.";
    default: return "";
  }
}

export const metaEventLabel: Record<string, string> = {
  waiting_settings: "Preparado · aguardando configuração da Meta",
  paused: "Preparado · integração da Meta pausada",
  ready: "Preparado · envio real desligado até a validação",
  sending: "Enviando",
  sent: "Enviado à Meta",
  failed: "Recusado pela Meta",
  unknown: "Resultado incerto · não será reenviado",
  pixel_changed: "Não enviado · o Pixel mudou depois de preparado",
  retry_scheduled: "Nova tentativa agendada",
};
