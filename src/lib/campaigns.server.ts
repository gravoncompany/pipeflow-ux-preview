import { requireB2bAccess, b2bDb } from "./b2b-prospecting.server";
import { campaignAudience, campaignContact, type Campaign, type CampaignInput } from "./campaigns";
import { campaignChannels } from "./campaign-channels.server";
import { campaignReadiness } from "./campaign-channels";
import { campaignClients, type CampaignClientRow } from "./campaign-recipients";
export async function campaignDb() { await requireB2bAccess(); return b2bDb(); }
export async function campaignOverview() {
  const db = await campaignDb();
  const [campaigns,templates,leads] = await Promise.all([db.from("crm_campaigns").select("*").order("created_at",{ascending:false}).limit(100), db.from("crm_campaign_templates").select("id,name,channel,subject,body").order("created_at",{ascending:false}).limit(100), db.from("leads").select("id,name,company,email,whatsapp,stage,pipeline_id,tags").order("created_at",{ascending:false}).limit(1000)]);
  if (campaigns.error || templates.error || leads.error) throw new Error("Central de Campanhas indisponível.");
  // Clientes cadastrados entram só pelo card existente do CRM (vínculo ou WhatsApp único); nada é criado.
  const clientRows = await db.from("crm_clients").select("id,lead_id,trade_name,contact_name,whatsapp,phone,status").limit(1000);
  const clients = clientRows.error ? null : campaignClients((clientRows.data ?? []) as CampaignClientRow[], (leads.data ?? []) as {id:string;whatsapp:string}[]);
  const pac = await db.from("crm_campaign_send_pacing").select("campaign_id,min_gap_seconds,max_gap_seconds,pause_every,pause_seconds");
  const pacing: Record<string,{min:number;max:number;pauseEvery:number;pauseSeconds:number}> = {};
  for (const r of pac.data ?? []) pacing[r.campaign_id] = { min: r.min_gap_seconds, max: r.max_gap_seconds, pauseEvery: r.pause_every, pauseSeconds: r.pause_seconds };
  return { pacing, clients, campaigns: (campaigns.data ?? []) as Campaign[], templates: (templates.data ?? []) as {id:string;name:string;channel:"email"|"whatsapp";subject:string;body:string}[], leads: (leads.data ?? []) as {id:string;name:string;company:string;email:string;whatsapp:string;stage:string;pipeline_id:string|null;tags?:string[]|null}[], sendingEnabled: false, emailStatus: "E-mail Marketing: usa os e-mails salvos nos cards; envio liberado somente após verificar a Brevo, o remetente e o domínio. Inválidos, duplicados, descadastrados e bloqueados ficam de fora.", whatsappStatus: "Selecione a instância conectada da empresa, revise a mensagem e confirme a ciência das orientações para iniciar. Descadastros e duplicados ficam de fora.", whatsappChannels: await campaignChannels() };
}
/** Estado da consulta à lista de bloqueio do provedor (só e-mail). */
export type ProviderCheck = { checked: boolean; ok: boolean; code: string; blockedCount: number };
export async function reviewCampaign(leadIds: string[], channel: "email"|"whatsapp", opts: { provider?: boolean } = {}, clientIds: string[] = []) {
  const db = await campaignDb();
  const noCheck: ProviderCheck = { checked: false, ok: true, code: "", blockedCount: 0 };
  // Clientes cadastrados entram direto no WhatsApp, sem exigir card; clientes com card usam o próprio card.
  let clientOnly: {id:string;name:string;company:string;email:string;whatsapp:string}[] = [];
  if (channel === "whatsapp" && clientIds.length) {
    const rows = await db.from("crm_clients").select("id,lead_id,trade_name,contact_name,whatsapp,phone").in("id", [...new Set(clientIds)]);
    if (rows.error || rows.data.length !== new Set(clientIds).size) throw new Error("Não foi possível confirmar todos os clientes selecionados.");
    leadIds = [...new Set([...leadIds, ...rows.data.flatMap((c: any) => c.lead_id ? [c.lead_id as string] : [])])];
    clientOnly = rows.data.filter((c: any) => !c.lead_id).map((c: any) => ({ id: c.id, name: c.contact_name || c.trade_name, company: c.trade_name, email: "", whatsapp: c.whatsapp || c.phone || "" }));
  }
  if (!leadIds.length && !clientOnly.length) return { recipients: [], eligible: 0, provider: noCheck };
  const [leads,permissions,suppressions] = leadIds.length===0 ? [{data:[] as any[],error:null},{data:[] as any[],error:null},{data:[] as any[],error:null}] as const : await Promise.all([db.from("leads").select("id,name,company,email,whatsapp").in("id",leadIds),db.from("crm_campaign_permissions").select("lead_id,channel,contact,withdrawn_at,evidence,granted_at,recorded_at").in("lead_id",leadIds).eq("channel",channel), channel === "email" ? db.from("b2b_email_suppressions").select("email").limit(10000) : Promise.resolve({data:[],error:null})]);
  if (leads.error || permissions.error || suppressions.error || leads.data?.length !== new Set(leadIds).size) throw new Error("Não foi possível confirmar todos os destinatários.");
  const contacts=[...(leads.data??[]),...clientOnly].map(l=>campaignContact(channel,(channel==="email"?l.email:l.whatsapp)??"")).filter(Boolean);
  const withdrawn=contacts.length?await db.from("crm_campaign_permissions").select("contact").eq("channel",channel).not("withdrawn_at","is",null).in("contact",channel==="whatsapp"?[...contacts,...contacts.map(c=>c.startsWith("55")?c.slice(2):c)]:contacts):{data:[],error:null};
  if(withdrawn.error)throw new Error("Não foi possível verificar descadastros.");
  let provider = noCheck; let providerBlocked: Record<string,string> = {};
  if (channel === "email" && opts.provider !== false && contacts.length) {
    const { brevoBlockedContacts } = await import("./brevo.server");
    const list = await brevoBlockedContacts(contacts);
    if (list.ok) { providerBlocked = list.blocked; provider = { checked: true, ok: true, code: "", blockedCount: Object.keys(list.blocked).length }; }
    else provider = { checked: true, ok: false, code: list.code, blockedCount: 0 };
  }
  const clientSet = new Set(clientOnly.map(c => c.id));
  const recipients = campaignAudience([...(leads.data ?? []), ...clientOnly], channel, permissions.data ?? [], [...(suppressions.data ?? []).map(row => row.email),...(withdrawn.data??[]).map(row=>channel==="whatsapp"?campaignContact("whatsapp",row.contact)||row.contact:row.contact)], providerBlocked).map(r => clientSet.has(r.leadId) ? { ...r, clientId: r.leadId } : r);
  return { recipients, eligible: recipients.filter(r => r.eligible).length, provider };
}
export async function saveCampaign(input: CampaignInput) {
  const db = await campaignDb(); await reviewCampaign(input.leadIds,input.channel,{provider:false},input.clientIds??[]);
  if (input.channel === "whatsapp" && input.instanceReference) {
    const channels = await campaignChannels();
    if (!channels.instances.some(i => i.reference === input.instanceReference && i.bindingVerified)) throw new Error(channels.error ?? "Instância sem vínculo exclusivo autorizado à empresa. Rascunho não foi alterado.");
  }
  const result = await db.rpc("save_crm_campaign_draft",{p_id:input.id,p_revision:input.revision,p_payload:input});
  if (result.error || !result.data) throw new Error("Não foi possível salvar; o rascunho pode ter mudado. Reabra a campanha.");
  return result.data as Campaign;
}
export async function validateCampaign(input: CampaignInput) {
  if (input.channel === "email") {
    const { validateEmailCampaign } = await import("./email-campaigns.server");
    const result = await validateEmailCampaign(input);
    return { ready: result.ready, reasons: result.reasons, issues: result.issues, eligible: result.eligible, timezone: result.timezone, warnings: [] as string[], channels: { instances: [], error: null, checkedAt: result.status.checkedAt } as Awaited<ReturnType<typeof campaignChannels>> };
  }
  const { whatsAppTargets } = await import("./whatsapp-campaigns.server");
  const targets = await whatsAppTargets(input);
  const channels = await campaignChannels();
  const base = campaignReadiness({ ...input, scheduledAt: null }, channels, targets.eligible);
  const reasons = [...base.reasons, ...(input.scheduledAt && Date.parse(input.scheduledAt) < Date.now() ? ["O horário agendado já passou."] : [])];
  return { ...base, ready: reasons.length === 0, reasons, warnings: [...base.warnings, ...targets.warnings], targets: targets.recipients, issues: [] as import("./email-campaigns").ReadinessIssue[], timezone: "", channels };
}
export async function blockedCampaignStart(id: string, revision?: number, acknowledged = false) {
  const db = await campaignDb();
  const result = await db.from("crm_campaigns").select("*").eq("id", id).single();
  if (result.error || !result.data) throw new Error("Campanha não encontrada; reabra o rascunho salvo.");
  const c = result.data as Campaign;
  if (c.channel === "email") {
    if (revision === undefined) throw new Error("Reabra a campanha e confirme a revisão atual.");
    const { dispatchEmailCampaign } = await import("./email-campaigns.server");
    return dispatchEmailCampaign(id, revision);
  }
  if (revision === undefined) throw new Error("Reabra a campanha e confirme a revisão atual.");
  const { startWhatsAppCampaign } = await import("./whatsapp-campaigns.server");
  return startWhatsAppCampaign(id, revision, acknowledged);
}
