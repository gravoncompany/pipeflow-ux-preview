import { campaignDb, reviewCampaign, validateCampaign } from "./campaigns.server";
import { campaignChannels } from "./campaign-channels.server";
import { campaignText, type Campaign, type CampaignInput } from "./campaigns";
import { groupText } from "./whatsapp-campaigns";
import { getPortalAccount } from "./gravon-portal-admin.server";
import { evolutionSendText } from "./evolution-text.server";
import { phoneDigits } from "./phone";
import { evolutionFailureCode } from "./whatsapp-campaigns";
import { WHATSAPP_CAMPAIGN_ACK, WHATSAPP_BATCH_SIZE, WHATSAPP_SEND_GAP_MS, summarizeDeliveries, isValidPacing, type Pacing } from "./whatsapp-campaigns";

/** Starts a reviewed WhatsApp draft: revalidates channel + audience, records the user's single acknowledgement and queues eligible contacts once. */
export async function startWhatsAppCampaign(id: string, revision: number, acknowledged: boolean) {
  if (!acknowledged) return { ok: false as const, message: "Marque a caixa de ciência das orientações de envio para iniciar.", issues: [] };
  const db = await campaignDb();
  const row = await db.from("crm_campaigns").select("*").eq("id", id).single();
  if (row.error || !row.data) throw new Error("Campanha não encontrada; reabra o rascunho salvo.");
  const c = row.data as Campaign;
  if (c.channel !== "whatsapp" || c.state !== "draft" || c.revision !== revision) return { ok: false as const, message: "A campanha mudou ou já foi iniciada. Reabra antes de continuar.", issues: [] };
  const input = { audienceKind: c.audience_kind ?? "individual", groups: c.group_targets ?? [], manual: c.manual_targets ?? [], id: c.id, revision: c.revision, name: c.name, channel: c.channel, body: c.body, subject: c.subject, instanceReference: c.instance_reference, senderReference: c.sender_reference, leadIds: c.lead_ids, clientIds: c.client_ids ?? [], scheduledAt: c.scheduled_at };
  const validation = await validateCampaign(input);
  if (!validation.ready) return { ok: false as const, message: `Campanha não iniciada: ${validation.reasons.join(" ")}`, issues: [] };
  const targets = await whatsAppTargets(input);
  const recipients = targets.recipients.filter(r => r.eligible).map(r => ({ contact: r.contact, leadId: r.leadId, clientId: r.clientId, name: r.name, company: r.company }));
  if (!recipients.length) return { ok: false as const, message: "Nenhum destinatário elegível.", issues: [] };
  const account = await getPortalAccount();
  if (!account?.authorized) return { ok: false as const, message: "Entre com sua conta administrativa individual para iniciar.", issues: [] };
  const started = await db.rpc("start_crm_whatsapp_campaign", { p_id: c.id, p_revision: c.revision, p_recipients: recipients, p_statement: WHATSAPP_CAMPAIGN_ACK, p_actor: account.email || account.userId });
  if (started.error) return { ok: false as const, message: started.error.message.includes("no_eligible") ? "Nenhum contato elegível (todos descadastrados ou já incluídos)." : "Não foi possível iniciar; a campanha pode ter mudado. Reabra e tente novamente.", issues: [] };
  return { ok: true as const, message: c.scheduled_at && Date.parse(c.scheduled_at) > Date.now() + 60000 ? `Campanha agendada: ${started.data} destinatário(s) na fila. O envio começa no horário escolhido enquanto a tela de campanhas estiver aberta.` : `Campanha iniciada: ${started.data} contato(s) na fila. O envio é gradual, com intervalo entre mensagens; acompanhe o andamento nesta tela.`, issues: [] };
}

type Delivery = { id: string; contact: string; name: string; company: string; body: string; instance: string };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Sends a small batch. Each contact is reserved before calling the provider; unknown outcomes are never resent. */
export async function processWhatsAppCampaign(id: string) {
  const db = await campaignDb();
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error("Credencial da Evolution não configurada no servidor.");
  const row = await db.from("crm_campaigns").select("instance_reference,state,channel").eq("id", id).single();
  if (row.error || !row.data || row.data.channel !== "whatsapp") throw new Error("Campanha não encontrada.");
  if (row.data.state === "running" || row.data.state === "scheduled") {
    // Rechecks binding/connection before every batch; a lost connection pauses without consuming contacts.
    const channels = await campaignChannels();
    const inst = channels.instances.find(i => i.reference === row.data.instance_reference);
    if (!inst?.campaignAuthorized) return { paused: true, reason: channels.error ?? inst?.reasons.join(" ") ?? "Instância indisponível.", ...(await whatsAppCampaignStatus(id)) };
    // Campaigns with saved speed settings: one message per call, slot gated atomically in the database.
    // Campaigns without settings keep the original batch behavior unchanged.
    const paced = await db.rpc("claim_paced_crm_whatsapp_delivery", { p_campaign: id });
    if (paced.error) throw new Error("Não foi possível reservar o próximo contato.");
    const pg = paced.data as { paced: boolean; wait?: boolean; delivery?: Delivery | null };
    const limit = pg.paced ? 1 : WHATSAPP_BATCH_SIZE;
    for (let i = 0; i < limit; i++) {
      let d: Delivery | null;
      if (pg.paced) { if (pg.wait) break; d = pg.delivery ?? null; }
      else {
        const claim = await db.rpc("claim_crm_whatsapp_delivery", { p_campaign: id });
        if (claim.error) throw new Error("Não foi possível reservar o próximo contato.");
        d = claim.data as Delivery | null;
      }
      if (!d) break;
      if (i > 0) await sleep(WHATSAPP_SEND_GAP_MS);
      let state: "accepted" | "failed" | "unknown" = "unknown", messageId = "", error = "";
      try {
        // Evolution expects the full international number; saved contacts may lack Brazil's 55 (root cause of http_400).
        const isGroup = d.contact.endsWith("@g.us");
        const number = isGroup ? d.contact : phoneDigits(d.contact);
        if (!isGroup && !/^\d{12,15}$/.test(number)) { state = "failed"; error = "invalid_number"; }
        else if (isGroup && !(await (await import("./whatsapp-groups.server")).verifyCampaignGroups(d.instance, [d.contact])).groups.some(g => g.jid === d.contact && g.canPost)) { state = "failed"; error = "group_permission_unverified"; }
        else {
          const res = await evolutionSendText(key, d.instance, number, isGroup ? groupText(d.body, d.name) : campaignText(d.body, d.name, d.company));
          const text = (await res.text()).slice(0, 20000);
          if (res.ok) { state = "accepted"; try { messageId = String(JSON.parse(text)?.key?.id ?? ""); } catch { /* aceito sem id */ } }
          else if (res.status >= 400 && res.status < 500) { state = "failed"; error = evolutionFailureCode(res.status, text); }
          else error = `http_${res.status}`;
          if (!res.ok) console.error(`whatsapp campaign send failed [${res.status}] code=${error}`);
        }
      } catch { error = "timeout_or_network"; }
      const fin = await db.rpc("finish_crm_whatsapp_delivery", { p_id: d.id, p_state: state, p_message_id: messageId, p_error: error });
      if (fin.error) throw new Error("Envio feito, mas o status não pôde ser registrado. Não reenvie; atualize a tela.");
    }
  }
  return { paused: false, reason: "", ...(await whatsAppCampaignStatus(id)) };
}

export async function whatsAppCampaignStatus(id: string) {
  const db = await campaignDb();
  const [c, rows, p] = await Promise.all([db.from("crm_campaigns").select("state").eq("id", id).single(), db.from("crm_campaign_deliveries").select("state").eq("campaign_id", id).limit(5000), db.from("crm_campaign_send_pacing").select("*").eq("campaign_id", id).maybeSingle()]);
  if (c.error || rows.error) throw new Error("Status da campanha indisponível.");
  const pacing = p.data ? { min: p.data.min_gap_seconds, max: p.data.max_gap_seconds, pauseEvery: p.data.pause_every, pauseSeconds: p.data.pause_seconds, sentSincePause: p.data.sent_since_pause, nextSendAt: p.data.next_send_at as string } : null;
  return { state: c.data.state as Campaign["state"], counts: summarizeDeliveries((rows.data ?? []).map(r => r.state as string)), pacing };
}

/** Saves speed settings for a draft or running campaign; affects only upcoming sends, never re-queues. */
export async function saveCampaignPacing(id: string, p: Pacing) {
  if (!isValidPacing(p)) throw new Error("Configuração de velocidade inválida.");
  const db = await campaignDb();
  const r = await db.rpc("save_crm_campaign_pacing", { p_campaign: id, p_min: p.min, p_max: p.max, p_every: p.pauseEvery, p_pause: p.pauseSeconds });
  if (r.error || r.data !== true) throw new Error("Só é possível ajustar a velocidade de campanhas de WhatsApp em rascunho ou em andamento.");
  return { ok: true };
}

export async function stopWhatsAppCampaign(id: string) {
  const db = await campaignDb();
  const r = await db.rpc("stop_crm_whatsapp_campaign", { p_id: id });
  if (r.error) throw new Error("A campanha não está em andamento.");
  return { ok: true, message: `Campanha interrompida. ${r.data} contato(s) não receberam a mensagem.` };
}

/** Per-recipient delivery list for the campaign detail view (names resolved from leads/clients). */
export async function whatsAppCampaignDetails(id: string) {
  const db = await campaignDb();
  const [c, rows] = await Promise.all([db.from("crm_campaigns").select("id,name,state,instance_reference,created_at,updated_at,body").eq("id", id).single(), db.from("crm_campaign_deliveries").select("*").eq("campaign_id", id).order("updated_at").limit(5000)]);
  if (c.error || rows.error) throw new Error("Detalhes da campanha indisponíveis.");
  const list = (rows.data ?? []) as Record<string, unknown>[];
  const leadIds = [...new Set(list.map(r => r.lead_id as string).filter(Boolean))], clientIds = [...new Set(list.map(r => r.client_id as string).filter(Boolean))];
  const [leads, clients] = await Promise.all([
    leadIds.length ? db.from("leads").select("id,name,company").in("id", leadIds) : Promise.resolve({ data: [] as { id: string; name: string; company: string | null }[] }),
    clientIds.length ? db.from("crm_clients").select("id,legal_name,trade_name").in("id", clientIds) : Promise.resolve({ data: [] as { id: string; legal_name: string; trade_name: string }[] }),
  ]);
  const ln = new Map((leads.data ?? []).map(l => [l.id, [l.name, l.company].filter(Boolean).join(" · ")]));
  const cn = new Map((clients.data ?? []).map(k => [k.id, k.trade_name || k.legal_name]));
  return {
    campaign: { id: c.data.id, name: c.data.name, state: c.data.state as string, instance: c.data.instance_reference, createdAt: c.data.created_at, updatedAt: c.data.updated_at },
    counts: summarizeDeliveries(list.map(r => r.state as string)),
    recipients: list.map(r => ({ id: r.id as string, contact: r.contact as string, name: (r.client_id ? cn.get(r.client_id as string) : ln.get(r.lead_id as string)) || [r.recipient_name, r.recipient_company].filter(Boolean).join(" · "), state: r.state as string, error: (r.error_code as string | null) ?? "", updatedAt: r.updated_at as string })),
  };
}

export type TargetRow = { key: string; contact: string; leadId: string; clientId: string; name: string; company: string; source: string; eligible: boolean; reason: string };
/** Single source of truth for who a WhatsApp campaign will reach: groups OR individuals (CRM + manual/CSV), deduped by normalized number. */
export async function whatsAppTargets(input: CampaignInput) {
  const warnings: string[] = [];
  if ((input.audienceKind ?? "individual") === "groups") {
    const { verifyCampaignGroups } = await import("./whatsapp-groups.server");
    const live = await verifyCampaignGroups(input.instanceReference, (input.groups ?? []).map(g => g.jid));
    if (live.error) warnings.push(live.error);
    const byJid = new Map(live.groups.map(g => [g.jid, g]));
    const seen = new Set<string>();
    const recipients: TargetRow[] = (input.groups ?? []).map(g => {
      const l = byJid.get(g.jid);
      const reason = seen.has(g.jid) ? "Grupo duplicado" : live.error ? "Não foi possível confirmar o grupo" : !l ? "Grupo inacessível para esta instância" : !l.canPost ? l.reason : "Elegível";
      seen.add(g.jid);
      return { key: g.jid, contact: g.jid, leadId: "", clientId: "", name: l?.name ?? g.name, company: "", source: "Grupo do WhatsApp", eligible: reason === "Elegível", reason };
    });
    return { recipients, eligible: recipients.filter(r => r.eligible).length, warnings };
  }
  const audience = await reviewCampaign(input.leadIds, "whatsapp", {}, input.clientIds ?? []);
  const recipients: TargetRow[] = audience.recipients.map(r => ({ key: r.clientId ? `c:${r.clientId}` : `l:${r.leadId}`, contact: r.contact, leadId: r.clientId ? "" : r.leadId, clientId: r.clientId ?? "", name: r.name, company: r.company, source: r.clientId ? "Cliente" : "CRM", eligible: r.eligible, reason: r.reason }));
  const seen = new Set(recipients.filter(r => r.eligible).map(r => r.contact));
  const manual = input.manual ?? [];
  let withdrawn = new Set<string>();
  if (manual.length) {
    const db = await campaignDb();
    const variants = manual.flatMap(m => [m.phone, m.phone.startsWith("55") ? m.phone.slice(2) : m.phone]);
    const w = await db.from("crm_campaign_permissions").select("contact").eq("channel", "whatsapp").not("withdrawn_at", "is", null).in("contact", variants);
    if (w.error) throw new Error("Não foi possível verificar descadastros.");
    withdrawn = new Set((w.data ?? []).map(r => phoneDigits(r.contact)));
  }
  for (const m of manual) {
    const reason = withdrawn.has(m.phone) ? "Descadastro ou bloqueio" : seen.has(m.phone) ? "Destinatário duplicado" : "Elegível";
    if (reason === "Elegível") seen.add(m.phone);
    recipients.push({ key: `m:${m.phone}`, contact: m.phone, leadId: "", clientId: "", name: m.name, company: m.company, source: m.source || "Manual", eligible: reason === "Elegível", reason });
  }
  return { recipients, eligible: recipients.filter(r => r.eligible).length, warnings };
}

export async function pauseWhatsAppCampaign(id: string, pause: boolean) {
  const db = await campaignDb();
  const r = await db.rpc("pause_crm_whatsapp_campaign", { p_id: id, p_pause: pause });
  if (r.error) throw new Error(pause ? "Só campanhas em andamento podem ser pausadas." : "Só campanhas pausadas podem ser retomadas.");
  return { ok: true, message: pause ? "Campanha pausada. Nenhuma nova mensagem será enviada até retomar." : "Campanha retomada." };
}
