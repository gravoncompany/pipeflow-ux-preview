import { normalizeWhatsAppTarget } from "./phone";
import { z } from "zod";
export const campaignChannel = z.enum(["email", "whatsapp"]);
export const campaignInput = z.object({ id: z.string().uuid().nullable(), revision: z.number().int().positive(), name: z.string().trim().min(2).max(150), channel: campaignChannel, subject: z.string().max(300), body: z.string().max(10000), senderReference: z.string().max(254), instanceReference: z.string().max(200), leadIds: z.array(z.string().uuid()).max(1000), clientIds: z.array(z.string().uuid()).max(1000).optional(), audienceKind: z.enum(["individual","groups"]).optional(), groups: z.array(z.object({ jid: z.string().regex(/^[0-9]{5,40}(-[0-9]+)?@g\.us$/), name: z.string().max(200) }).strict()).max(300).optional(), manual: z.array(z.object({ phone: z.string().regex(/^\d{12,15}$/), name: z.string().max(200), company: z.string().max(200), source: z.string().max(40) }).strict()).max(1000).optional(), scheduledAt: z.string().datetime({offset:true}).nullable() }).strict();
export type CampaignInput = z.infer<typeof campaignInput>;
export type Campaign = { id: string; name: string; channel: "email" | "whatsapp"; subject: string; body: string; sender_reference: string; instance_reference: string; lead_ids: string[]; client_ids?: string[]; audience_kind?: "individual" | "groups"; group_targets?: { jid: string; name: string }[]; manual_targets?: { phone: string; name: string; company: string; source: string }[]; state: "draft" | "scheduled" | "running" | "paused" | "completed" | "cancelled"; scheduled_at: string | null; revision: number; created_at: string };
export const campaignLabels = { draft: "Rascunho", scheduled: "Agendada", running: "Em andamento", paused: "Pausada", completed: "Concluída", cancelled: "Cancelada" };
export function campaignContact(channel: "email" | "whatsapp", value: string) {
  if (channel === "email") { const email = value.trim().toLowerCase(); return z.string().email().safeParse(email).success ? email : ""; }
  const t = normalizeWhatsAppTarget(value); return t.kind === "phone" ? t.value : "";
}
export function campaignText(text: string, name: string, company: string) { return text.replace(/\{\{(nome|empresa)\}\}/g, (_, field: string) => field === "nome" ? name : company); }
export type CampaignConsent = { evidence: string; grantedAt: string; recordedAt: string };
/** "crm": regra do Pipeflow (contato, descadastro, bloqueio, duplicado). "provider": restrição da Brevo. */
export type CampaignRecipient = { leadId: string; clientId?: string; name: string; company: string; contact: string; eligible: boolean; reason: string; blockedBy: "crm" | "provider" | null; consent: CampaignConsent | null };
export const PROVIDER_BLOCK_LABELS: Record<string, string> = {
  hardBounce: "falha permanente de entrega (hard bounce)",
  contactFlaggedAsSpam: "reclamação de spam",
  unsubscribedViaEmail: "descadastro feito pelo próprio contato",
  unsubscribedViaApi: "descadastro registrado na Brevo",
  unsubscribedViaMA: "descadastro em automação da Brevo",
  adminBlocked: "bloqueado manualmente na Brevo",
};
/**
 * E-mail: usa o e-mail salvo no card; consentimento registrado não é exigido (se existir, é exibido).
 * WhatsApp: não exige registro por ficha; o usuário confirma uma única ciência ao iniciar. Descadastros registrados continuam excluídos.
 * Sempre excluídos: inválidos, descadastrados/bloqueados, bloqueados pelo provedor e duplicados.
 */
export function campaignAudience(leads: { id: string; name: string | null; company: string | null; email: string | null; whatsapp: string | null }[], channel: "email" | "whatsapp", permissions: { lead_id: string; channel: string; contact: string; withdrawn_at: string | null; evidence?: string; granted_at?: string; recorded_at?: string }[], suppressed: string[], providerBlocked: Record<string, string> = {}): CampaignRecipient[] {
  const seen = new Set<string>();
  const blocked = new Set(suppressed);
  return leads.map(lead => {
    const contact = campaignContact(channel, (channel === "email" ? lead.email : lead.whatsapp) ?? "");
    const permission = permissions.find(p => p.lead_id === lead.id && p.channel === channel && p.contact === contact && !p.withdrawn_at);
    const providerCode = channel === "email" && contact ? providerBlocked[contact] : undefined;
    const reason = !contact ? "Contato ausente ou inválido"
      : blocked.has(contact) ? "Descadastro ou bloqueio"
      : providerCode !== undefined ? `Restrição da Brevo: ${PROVIDER_BLOCK_LABELS[providerCode] ?? "contato bloqueado no provedor"}`
      : seen.has(contact) ? "Destinatário duplicado" : "Elegível";
    if (reason === "Elegível") seen.add(contact);
    const consent = permission ? { evidence: permission.evidence ?? "", grantedAt: permission.granted_at ?? "", recordedAt: permission.recorded_at ?? "" } : null;
    const blockedBy = reason === "Elegível" ? null : providerCode !== undefined && reason.startsWith("Restrição da Brevo") ? "provider" as const : "crm" as const;
    return { leadId: lead.id, name: lead.name ?? "", company: lead.company ?? "", contact, eligible: reason === "Elegível", reason, blockedBy, consent };
  });
}