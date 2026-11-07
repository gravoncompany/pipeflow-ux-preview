import { z } from "zod";

export const analysisSchema = z.object({
  qualification: z.enum(["qualified", "not_qualified", "inconclusive"]),
  summary: z.string(),
  interestEvidence: z.array(z.object({ messageId: z.string(), quote: z.string() }).strict()),
  opportunity: z.enum(["open", "won", "lost", "unclear"]),
  opportunityReason: z.string(),
  serviceAssessment: z.enum(["possible_failure", "no_failure_observed", "insufficient_data"]),
  failures: z.array(z.object({ reason: z.string(), messageId: z.string(), quote: z.string() }).strict()),
  nextAction: z.string(),
  limitations: z.string(),
}).strict();
export type Analysis = z.infer<typeof analysisSchema>;
export type AnalysisMessage = { message_id: string; body: string; from_me: boolean; sent_at: string; media_type: string | null };
export const QUALIFICATION_RULE = "Qualificado é quem demonstrou interesse no serviço de tráfego pago. Não exigir faturamento, orçamento ou reunião. Silêncio não significa desqualificação.";

export function validateEvidence(result: Analysis, messages: AnalysisMessage[]): Analysis {
  const valid = (e: { messageId: string; quote: string }, inbound = false) => messages.some(m => m.message_id === e.messageId && (!inbound || !m.from_me) && e.quote.trim().length > 0 && m.body.includes(e.quote));
  const interestEvidence = result.interestEvidence.filter(e => valid(e, true));
  const failures = result.failures.filter(e => valid(e));
  return { ...result, interestEvidence, failures,
    qualification: result.qualification === "qualified" && !interestEvidence.length ? "inconclusive" : result.qualification,
    serviceAssessment: result.serviceAssessment === "possible_failure" && !failures.length ? "insufficient_data" : result.serviceAssessment,
  };
}

export const qualificationLabels = { qualified: "Qualificado", not_qualified: "Não qualificado", inconclusive: "Inconclusivo" };
export const opportunityLabels = { open: "Oportunidade aberta", won: "Contratação identificada", lost: "Oportunidade perdida", unclear: "Oportunidade indefinida" };
export const serviceLabels = { possible_failure: "Possível falha no atendimento", no_failure_observed: "Sem falha observada", insufficient_data: "Atendimento inconclusivo" };