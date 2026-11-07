import { z } from "zod";
import { sameWhatsAppNumber, phoneDigits } from "./phone";

export type CampaignInstance = { reference: string; company: string; connection: string; transport: string; bindingVerified: boolean; campaignAuthorized: boolean; reasons: string[]; warnings: string[] };
export type CampaignChannels = { instances: CampaignInstance[]; error: string | null; checkedAt: string };
export type ChannelBinding = { instance: string; canonical_phone: string; company_key: string };
const record = z.object({ name: z.string().max(200).optional(), connectionStatus: z.string().max(80).optional(), number: z.string().max(100).nullable().optional(), ownerJid: z.string().max(100).nullable().optional(), integration: z.string().max(80).optional(), instance: z.object({ instanceName: z.string().max(200).optional(), status: z.string().max(80).optional(), ownerJid: z.string().max(100).optional(), integration: z.string().max(80).optional() }).passthrough().optional() }).passthrough();

/** Never disclose provider-global instances, phone numbers or credentials. */
export function campaignInstances(raw: unknown, own: ChannelBinding[], all: ChannelBinding[]): CampaignInstance[] {
  const rows = z.array(record).max(200).parse(raw);
  const names = [...new Set(own.filter(b => b.company_key === "crm:1").map(b => b.instance))];
  return names.map(reference => {
    const bindings = all.filter(b => b.instance === reference);
    const matches = rows.filter(r => (r.name ?? r.instance?.instanceName) === reference);
    const row = matches.length === 1 ? matches[0] : undefined;
    const number = phoneDigits(row?.number || row?.ownerJid || row?.instance?.ownerJid || "");
    const authorized = own.filter(b => b.instance === reference && b.company_key === "crm:1");
    const bindingVerified = Boolean(row && /^\d{10,15}$/.test(number) && bindings.length && bindings.every(b => b.company_key === "crm:1" && sameWhatsAppNumber(b.canonical_phone, number)) && authorized.some(b => sameWhatsAppNumber(b.canonical_phone, number)));
    const connection = row?.connectionStatus ?? row?.instance?.status ?? (matches.length > 1 ? "ambiguous" : "unavailable");
    const transport = row?.integration ?? row?.instance?.integration ?? "unknown";
    const reasons: string[] = [];
    const warnings: string[] = [];
    if (!bindingVerified) reasons.push("Vínculo exclusivo empresa/instância/número não confirmado.");
    if (connection !== "open") reasons.push("Instância não está conectada de forma verificável.");
    if (transport === "WHATSAPP-BAILEYS") warnings.push("Conexão pelo WhatsApp do aparelho: envie aos poucos e só para quem espera sua mensagem, para evitar denúncias e bloqueios do número.");
    else if (transport === "WHATSAPP-BUSINESS") warnings.push("API oficial: fora da janela de 24 horas a Meta pode exigir modelo aprovado.");
    else warnings.push("Tipo de conexão não identificado; acompanhe os primeiros envios.");
    return { reference, company: "crm:1", connection, transport, bindingVerified, campaignAuthorized: reasons.length === 0, reasons, warnings };
  });
}

export function campaignReadiness(input: { channel: "email" | "whatsapp"; instanceReference: string; body: string; scheduledAt: string | null }, channels: CampaignChannels, eligible: number, now = Date.now()) {
  const reasons: string[] = [];
  if (!input.body.trim()) reasons.push("Mensagem vazia.");
  if (eligible === 0) reasons.push("Nenhum destinatário elegível (contato válido, sem descadastro e sem duplicidade).");
  if (input.scheduledAt && Date.parse(input.scheduledAt) <= now) reasons.push("A data pretendida precisa estar no futuro.");
  if (input.channel === "email") reasons.push("Serviço de e-mail e remetente verificado pendentes.");
  else {
    if (channels.error) reasons.push(channels.error);
    const instance = channels.instances.find(i => i.reference === input.instanceReference);
    if (input.scheduledAt) reasons.push("Agendamento de WhatsApp não está disponível; limpe a data para iniciar agora.");
    if (!instance) reasons.push("Selecione uma instância vinculada à sua conta e à empresa.");
    else reasons.push(...instance.reasons);
  }
  // E-mail tem validação própria. WhatsApp só fica pronto com vínculo exclusivo e conexão verificados;
  // o início ainda exige a ciência explícita do usuário no servidor.
  const unique = [...new Set(reasons)];
  return { ready: input.channel === "whatsapp" && unique.length === 0, reasons: unique, eligible, warnings: input.channel === "whatsapp" ? channels.instances.find(i => i.reference === input.instanceReference)?.warnings ?? [] : [] };
}