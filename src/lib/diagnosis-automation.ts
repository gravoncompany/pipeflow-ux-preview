import { z } from "zod";
import { firstContactIdentity } from "./first-contact";

export const DIAGNOSIS_AUTOMATION_NAME = "Diagnóstico Gravon — Atendimento WhatsApp";
export const DIAGNOSIS_TAG = "Diagnóstico solicitado";
export const DIAGNOSIS_MESSAGE = "Olá, {{nome}}! Tudo bem? 😊\n\nAqui é da Gravon Company.\n\nRecebemos sua solicitação de diagnóstico gratuito!\n\nGostaria de entender um pouquinho melhor sua empresa para preparar algumas recomendações.\n\nHoje vocês já investem em anúncios no Google ou Instagram?";
export const diagnosisConsent = z.object({
  granted: z.boolean(), at: z.string().datetime({ offset: true }), version: z.string().trim().min(1).max(160),
}).strict();
export const diagnosisOptions = z.object({
  enabled: z.boolean(), instance: z.string().trim().max(160), revision: z.number().int().nonnegative(),
}).strict();

export function prepareDiagnosisMessage(input: { name: string; whatsapp: string; whatsapp_consent?: z.infer<typeof diagnosisConsent> | null }, now = Date.now()) {
  const consent = diagnosisConsent.safeParse(input.whatsapp_consent);
  const identity = firstContactIdentity(input.name, input.whatsapp);
  if (!identity || !consent.success || !consent.data.granted || Date.parse(consent.data.at) > now) return null;
  return { phone: identity.phone, body: DIAGNOSIS_MESSAGE.replace("{{nome}}", identity.first), consent: consent.data };
}

export const DIAGNOSIS_SEND_LABEL: Record<string, string> = {
  pending: "Preparada", sending: "Envio reservado", accepted: "Aceita pela Evolution · entrega não confirmada",
  failed: "Falhou · sem reenvio", unknown: "Resultado incerto · não reenviar", cancelled: "Cancelada",
};