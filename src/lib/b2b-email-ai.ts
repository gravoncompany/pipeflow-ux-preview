import { z } from "zod";
import { businessLinks } from "./business-links";

export const EMAIL_BATCH_LIMIT = 30;
export const emailCompanySchema = z.object({
  key: z.string().trim().min(1).max(350),
  name: z.string().trim().min(2).max(300),
  segment: z.string().trim().max(300),
  website: z.string().max(2000),
  city: z.string().trim().max(100),
  email: z.union([z.literal(""), z.string().email().max(254)]),
  services: z.string().trim().max(1200),
  servicesSource: z.string().trim().max(500),
  source: z.string().trim().min(3).max(500),
  cnpj: z.string().max(14).optional(),
  state: z.string().max(2).optional(),
  address: z.string().max(700).optional(),
  whatsapp: z.string().max(20).optional(),
  leadId: z.string().uuid().optional(),
  mapsPlaceId: z.string().min(1).max(300).regex(/^[A-Za-z0-9_-]+$/).optional(),
  segmentTag: z.string().trim().max(100).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.services && !v.servicesSource) ctx.addIssue({ code: "custom", path: ["servicesSource"], message: "Informe a fonte dos serviços identificados." });
});
export type EmailCompany = z.infer<typeof emailCompanySchema>;
export const emailBatchInput = z.object({
  companies: z.array(emailCompanySchema).min(1).max(EMAIL_BATCH_LIMIT),
  template: z.enum(["auto", "odontologia", "estetica"]),
  sender: z.string().trim().min(2).max(200),
  authorized: z.literal(true),
  bases: z.object({
    odontologia: z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(10).max(4000) }).strict(),
    estetica: z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(10).max(4000) }).strict(),
  }).strict(),
  regenerate: z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict().optional(),
}).strict().refine(v => new Set(v.companies.map(c => c.key)).size === v.companies.length, "Há empresas repetidas na seleção.");
export type EmailBatchInput = z.infer<typeof emailBatchInput>;
export const emailReviewInput = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(10).max(6000),
  reviewed: z.boolean(),
}).strict();
export const EMAIL_AI_BASES = {
  odontologia: {
    name: "Odontologia",
    subject: "CRM com IA para a {{empresa}}: demonstração de 15 minutos",
    body: "Olá, equipe da {{empresa}}. Sou {{remetente}}, da Gravon Company. Apresentamos um CRM personalizado com IA para organizar avaliações, propostas de tratamento, agendamentos e retornos pendentes na odontologia. Podemos agendar uma demonstração de 15 minutos para entender a rotina da clínica? Caso não queira receber novos contatos, basta responder solicitando a remoção.",
  },
  estetica: {
    name: "Estética",
    subject: "CRM com IA para a {{empresa}}: podemos conversar?",
    body: "Olá, equipe da {{empresa}}. Sou {{remetente}}, da Gravon Company. Apresentamos um CRM personalizado com IA para organizar agendamentos, interessados, orçamentos e oportunidades comerciais em estética. Podemos agendar uma demonstração de 15 minutos para entender a rotina da empresa? Caso não queira receber novos contatos, basta responder solicitando a remoção.",
  },
} as const;
export function resolveEmailBase(segment: string, requested: EmailBatchInput["template"]): keyof typeof EMAIL_AI_BASES {
  if (requested !== "auto") return requested;
  const s = segment.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /estet|beleza|beauty/.test(s) ? "estetica" : "odontologia";
}
// A website URL is an identity/context field, never evidence that its content was read.
export function emailSourceContext(company: EmailCompany) {
  return {
    empresa: company.name, segmento: company.segment || null,
    site: businessLinks(company.website, "").website || null,
    cidade: company.city || null,
    servicosIdentificados: company.services || null,
    fonteServicos: company.services ? company.servicesSource : null,
    fonteCadastro: company.source,
  };
}
export function emailDraftState(reviewed: boolean): "reviewed" | "draft" { return reviewed ? "reviewed" : "draft"; }
/** Geração nunca envia; o envio é uma ação separada, só depois da revisão de cada e-mail. */
export function emailSendingEnabled(): false { return false; }
/** Revisão em lote: assunto, corpo e destinatário editáveis por empresa. */
export const emailItemReviewInput = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(10).max(6000),
  recipient: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(254)]),
  whatsapp: z.string().trim().max(1000).default(""),
  reviewed: z.boolean(),
}).strict();
/** Disparo pela Brevo: só itens aprovados, com confirmação explícita, até o limite do lote. */
export const emailSendInput = z.object({
  items: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).strict()).min(1).max(EMAIL_BATCH_LIMIT),
  confirmed: z.literal(true),
  /** Agendamento opcional na Brevo (5 min a 72 h). */
  scheduledAt: z.string().datetime().nullable().default(null),
  /** Fluxo de E-mail para os follow-ups depois do primeiro e-mail (opcional). */
  flowId: z.string().uuid().nullable().default(null),
}).strict().refine(v => new Set(v.items.map(i => i.id)).size === v.items.length, "Há e-mails repetidos no disparo.");
export function scheduleWithinBrevoWindow(iso: string | null, now = Date.now()) {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= now + 5 * 60_000 && t <= now + 72 * 3600_000;
}
/** Apresentação da Gravon (tráfego pago + Pipeflow CRM) usada como base de todo primeiro contato. */
export const GRAVON_PRESENTATION = {
  pitch: "Gravon Company: tráfego pago (Google Ads e Meta Ads) integrado ao Pipeflow CRM com Inteligência Artificial — centraliza conversas do WhatsApp, organiza contatos e etapas do funil, identifica interessados sem atendimento, usa IA para analisar conversas e sugerir próximas ações, conectando marketing, atendimento e inteligência comercial em um único processo.",
  signature: "WhatsApp: (51) 99548-6303\nSite: https://gravoncompany.com/\n\nGravon Company\nMarketing, tecnologia e inteligência comercial.",
  banner: "[imagem: https://crm.gravoncompany.com/api/public/email-images/8d46de25-a205-4a31-84a3-e8e148ede9fa.png | Pipeflow: IA no CRM]",
} as const;
/** Corpo final: texto da IA + assinatura e banner fixos da Gravon (nunca escritos pela IA). */
export function withGravonSignature(body: string) {
  const clean = body.replace(/\n*(Gravon Company\s*\n?Marketing, tecnologia[^\n]*)\s*$/i, "").trim();
  return `${clean}\n\n${GRAVON_PRESENTATION.signature}\n\n${GRAVON_PRESENTATION.banner}`.slice(0, 6000);
}
export type SendState = "none" | "reserved" | "accepted" | "failed" | "unknown";
export type AiEmailItem = {
  id: string; batch_id: string; position: number; company: EmailCompany;
  state: "pending" | "generating" | "draft" | "reviewed" | "failed";
  subject: string; body: string; revision: number; error_message: string;
  recipient: string; send_state: SendState; send_error: string; sent_at: string | null;
  whatsapp_text?: string; personalization_fact?: string; personalization_source?: string;
  outbound_follow_up?: "pending" | "scheduled" | "sent" | "review" | null;
  context_status?: "ok" | "insufficient"; scheduled_for?: string | null; whatsapp_sent_at?: string | null;
  /** Destinatário sugerido (salvo no rascunho, no snapshot ou no card cadastrado). */
  suggested_recipient?: string;
};
export type DispatchIssue = "missing_email" | "not_generated" | "not_reviewed" | "already_sent" | "suppressed" | "duplicate_recipient" | "insufficient_context";
/** Pendências de cada e-mail do lote; quem não tem pendência pode seguir para o disparo. */
export function dispatchIssues(item: AiEmailItem, recipient: string, suppressed: ReadonlySet<string>, otherRecipients: ReadonlySet<string>): DispatchIssue[] {
  const issues: DispatchIssue[] = [];
  const r = recipient.trim().toLowerCase();
  if (item.send_state !== "none") return ["already_sent"];
  if (!["draft", "reviewed"].includes(item.state)) issues.push("not_generated");
  if (!r || !z.string().email().safeParse(r).success) issues.push("missing_email");
  else if (suppressed.has(r)) issues.push("suppressed");
  else if (otherRecipients.has(r)) issues.push("duplicate_recipient");
  if (item.state === "draft") issues.push("not_reviewed");
  if (item.context_status === "insufficient" && item.state === "draft") issues.push("insufficient_context");
  return issues;
}
export const DISPATCH_ISSUE_LABEL: Record<DispatchIssue, string> = {
  missing_email: "E-mail ausente",
  not_generated: "Rascunho não gerado",
  not_reviewed: "Falta aprovar",
  already_sent: "Já processado",
  suppressed: "Descadastrado",
  duplicate_recipient: "E-mail repetido no lote",
  insufficient_context: "Contexto insuficiente — revise",
};
export type AiEmailBatch = { id: string; state: string; created_at: string; sender: string; template: EmailBatchInput["template"]; items: AiEmailItem[] };
export const prospectCampaignSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(200), city: z.string().trim().min(2).max(100),
  state: z.string().regex(/^[A-Z]{2}$/), segments: z.string().trim().min(2).max(300),
  quantity: z.number().int().min(1).max(30),
  frequency: z.enum(["daily", "weekly", "fortnightly", "monthly"]),
  preferWebsite: z.boolean(), preferInstagram: z.boolean(), criteria: z.string().trim().max(1200),
  status: z.enum(["configured", "paused", "ended"]),
}).strict();
export type ProspectCampaign = z.infer<typeof prospectCampaignSchema> & { id: string };