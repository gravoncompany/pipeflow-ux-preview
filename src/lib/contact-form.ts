import { z } from "zod";
import { firstContactIdentity } from "./first-contact";
import { extractUtms, sourceFromUtms } from "./lead-attribution";

export const WHATSAPP_CONSENT_VERSION = "gravon-whatsapp-contact-v1";
export const WHATSAPP_CONSENT_TEXT = "Autorizo a Gravon a entrar em contato comigo pelo WhatsApp sobre os serviços solicitados. Posso retirar esta autorização a qualquer momento.";
export const contactFormSchema = z.object({
  submissionId: z.string().uuid(), name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120), email: z.union([z.literal(""), z.string().trim().email().max(160)]),
  whatsapp: z.string().trim().max(40), service: z.string().trim().max(160), notes: z.string().trim().max(2000),
  whatsappConsent: z.boolean(), landingUrl: z.string().url().max(2000),
}).strict().superRefine((data, ctx) => {
  if (!data.email && !data.whatsapp) ctx.addIssue({ code: "custom", message: "Informe e-mail ou WhatsApp.", path: ["email"] });
  if (data.whatsappConsent && !firstContactIdentity(data.name, data.whatsapp)) ctx.addIssue({ code: "custom", message: "Informe nome e WhatsApp válidos para autorizar o contato.", path: ["whatsapp"] });
});
export function contactFormPayload(input: z.infer<typeof contactFormSchema>, origin: string, now: Date) {
  const data = contactFormSchema.parse(input);
  const identity = firstContactIdentity(data.name, data.whatsapp);
  const utms = extractUtms({ landing_url: data.landingUrl });
  return {
    name: data.name, company: data.company, email: data.email, whatsapp: data.whatsapp,
    service: data.service, notes: data.notes, source: sourceFromUtms(utms, "Formulário público"), ...utms,
    stage: "lead-novo", pipeline_id: null, status: "Novo", entry_date: now.toISOString().slice(0, 10),
    first_contact_form_origin: origin, first_contact_submission_id: `capture:${data.submissionId}`,
    first_contact_consent_at: data.whatsappConsent ? now.toISOString() : null,
    first_contact_consent_version: data.whatsappConsent ? WHATSAPP_CONSENT_VERSION : null,
    first_contact_first_name: data.whatsappConsent ? identity?.first : null,
    first_contact_phone: data.whatsappConsent ? identity?.phone : null,
    history: [{ id: `capture:${data.submissionId}`, date: now.toISOString(), text: data.whatsappConsent ? "Lead criado pelo formulário público. Contato por WhatsApp autorizado pelo formulário." : "Lead criado pelo formulário público. Sem autorização para primeiro contato automático." }],
  };
}