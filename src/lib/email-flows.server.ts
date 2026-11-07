import { b2bDb, requireB2bAccess } from "./b2b-prospecting.server";
import { brevoProviderStatus, brevoSend } from "./brevo.server";
import { loadEmailSettings } from "./email-campaigns.server";
import { personalize, providerIssues, renderEmail } from "./email-campaigns";
import {
  aiApproved, effectiveReplyTo, FLOW_BATCH_PER_RUN, FLOW_SUGGESTIONS_PER_RUN, gmailReplyQuery, isOptOut, matchReplies, remainingDailyQuota,
  replyAddressMonitored, stripQuoted, type EmailFlow, type EnrollmentStatus, type FlowInput,
} from "./email-flows";
import { insightForEmail } from "./company-insights";
import { insightForLead } from "./company-insights.server";
import { FlowAiError, personalizeFlowStep, suggestFlowReply, type FlowLeadContext } from "./ai/email-flow-ai.server";
import { gmailFindReplies, gmailMailbox } from "./gmail.server";
import { inboxReview, resolveInbox, syncInbox, type InboxSyncResult } from "./email-inbox.server";
import { inSendWindow, type FlowScheduleInput } from "./email-flows";
import { assembleBody, fillCompanyVars, LINK_PLACEHOLDER, trackedLink } from "./automations";
import { automationPostReplies, automationPreSend, automationSendContext } from "./automations.server";
import { EMAIL_PUBLIC_ORIGIN } from "./email-content";
import { withGravonSignature } from "./b2b-email-ai";
import { trackFlowEmail } from './outbound-clicks.server';

type Db = Awaited<ReturnType<typeof b2bDb>>;

export async function flowsDb() { await requireB2bAccess(); return b2bDb(); }

const rpcMessage = (raw: string | undefined, fallback: string) => {
  const r = raw ?? "";
  if (r.includes("stale_flow")) return "O fluxo foi alterado em outra aba. Atualize a página e tente de novo.";
  if (r.includes("ai_not_approved")) return "Com a Gravon IA ligada, aprove as etapas do fluxo antes de ativar.";
  if (r.includes("invalid_steps")) return "Cada etapa precisa de dia, assunto e mensagem.";
  if (r.includes("stale_suggestion")) return "Esta sugestão já foi enviada ou alterada. Atualize a página; nada foi reenviado.";
  if (r.includes("suppressed_contact")) return "Este contato pediu para não receber e-mails ou está bloqueado. Nada foi enviado.";
  if (r.includes("invalid_content")) return "Assunto e mensagem não podem ficar vazios.";
  if (r.includes("invalid_schedule")) return "Escolha ao menos um dia, um horário final depois do inicial e de 1 a 10 mensagens.";
  return fallback;
};

/* ------------------------------- Leitura ------------------------------- */

export async function flowsOverview() {
  const db = await flowsDb();
  await db.rpc("settle_crm_email_flows");
  const [flows, enrollments, suggestions, runner, leads, pipelines, b2b, sentFlows, sentCampaigns] = await Promise.all([
    db.from("crm_email_flows").select("*").neq("state", "archived").order("created_at", { ascending: false }).limit(100),
    db.from("crm_email_flow_enrollments").select("id,flow_id,lead_id,contact,status,next_step,started_at,next_send_at,last_sent_at,replied_at,reason").order("updated_at", { ascending: false }).limit(1000),
    db.from("crm_email_flow_suggestions").select("id,enrollment_id,lead_id,inbound_id,analysis,subject,body,state,revision,created_at").in("state", ["pending", "sending", "failed", "unknown"]).order("created_at", { ascending: false }).limit(100),
    db.from("crm_email_flow_runner").select("last_run_at,last_result,gmail_checked_at,ai_blocked_reason,lease_until,agent_enabled,inbox_synced_at,inbox_error").eq("id", true).maybeSingle(),
    db.from("leads").select("id,name,company,email,stage,pipeline_id").order("created_at", { ascending: false }).limit(2000),
    db.from("sales_pipelines").select("id,name,stages").eq("archived", false),
    db.from("b2b_companies").select("lead_id").not("lead_id", "is", null).limit(5000),
    db.from("crm_email_flow_messages").select("id", { count: "exact", head: true }).eq("direction", "out").eq("state", "accepted").gte("updated_at", new Date(Date.now() - 864e5).toISOString()),
    db.from("crm_campaign_deliveries").select("id", { count: "exact", head: true }).in("state", ["accepted", "scheduled"]).gte("updated_at", new Date(Date.now() - 864e5).toISOString()),
  ]);
  if (flows.error || enrollments.error || suggestions.error || leads.error || pipelines.error || b2b.error)
    throw new Error("Fluxos de E-mail indisponíveis no momento.");
  const inboundIds = (suggestions.data ?? []).map((s) => s.inbound_id);
  const inbound = inboundIds.length ? await db.from("crm_email_flow_messages").select("id,subject,body,created_at").in("id", inboundIds) : { data: [], error: null };
  const replyTo = effectiveReplyTo(await loadEmailSettings(db));
  let gmail: { connected: boolean; address: string; replyTo: string; monitored: boolean; error: string } = { connected: false, address: "", replyTo, monitored: false, error: "" };
  try {
    const mailbox = await gmailMailbox();
    const monitored = replyAddressMonitored(replyTo, mailbox);
    gmail = { connected: true, address: mailbox.address, replyTo, monitored, error: monitored ? "" : `As respostas vão para ${replyTo || "(sem endereço)"}, que não chega à caixa ${mailbox.address}. Envios automáticos ficam suspensos.` };
  } catch (e) { gmail = { connected: false, address: "", replyTo, monitored: false, error: e instanceof Error ? e.message : "Gmail indisponível." }; }
  const sent24h = (sentFlows.count ?? 0) + (sentCampaigns.count ?? 0);
  return {
    flows: (flows.data ?? []) as EmailFlow[],
    enrollments: (enrollments.data ?? []) as { id: string; flow_id: string; lead_id: string; contact: string; status: EnrollmentStatus; next_step: number; started_at: string; next_send_at: string | null; last_sent_at: string | null; replied_at: string | null; reason: string }[],
    suggestions: (suggestions.data ?? []) as { id: string; enrollment_id: string; lead_id: string | null; inbound_id: string; analysis: string; subject: string; body: string; state: string; revision: number; created_at: string }[],
    inbound: (inbound.data ?? []) as { id: string; subject: string; body: string; created_at: string }[],
    runner: (runner.data ?? null) as { last_run_at: string | null; last_result: { sent?: number; replies?: number; suggestions?: number; notes?: string[]; skipped?: string }; gmail_checked_at: string | null; ai_blocked_reason: string; lease_until: string | null; agent_enabled: boolean; inbox_synced_at: string | null; inbox_error: string } | null,
    review: await inboxReview(db),
    leads: (leads.data ?? []) as { id: string; name: string; company: string; email: string; stage: string; pipeline_id: string | null }[],
    pipelines: (pipelines.data ?? []) as { id: string; name: string; stages: { id: string; title: string }[] }[],
    b2bLeadIds: (b2b.data ?? []).map((r) => r.lead_id as string),
    gmail,
    quota: { sent24h, remaining: remainingDailyQuota(sent24h) },
  };
}

export async function flowMessages(enrollmentId: string) {
  const db = await flowsDb();
  const r = await db.from("crm_email_flow_messages").select("id,direction,kind,step,subject,body,state,ai_personalized,error_code,created_at").eq("enrollment_id", enrollmentId).order("created_at").limit(100);
  if (r.error) throw new Error("Mensagens indisponíveis.");
  return r.data ?? [];
}

/* ------------------------------- Escrita ------------------------------- */

/** Fluxos gerados por Automações só mudam pela Central de Automações. */
async function assertNotAutomation(db: Db, id: string | null) {
  if (!id) return;
  const r = await db.from("crm_email_flows").select("automation_id").eq("id", id).maybeSingle();
  if (r.data?.automation_id) throw new Error("Este fluxo pertence a uma Automação. Edite, ligue ou inclua contatos pela página Automações.");
}
export async function saveFlow(input: FlowInput) {
  const db = await flowsDb();
  await assertNotAutomation(db, input.id);
  const r = await db.rpc("save_crm_email_flow", { p_id: input.id, p_revision: input.revision, p_name: input.name, p_steps: input.steps, p_ai: input.aiEnabled, p_approve_ai: input.aiEnabled && input.approveAi });
  if (r.error || !r.data) throw new Error(rpcMessage(r.error?.message, "Não foi possível salvar o fluxo."));
  return r.data as EmailFlow;
}
export async function setFlowState(id: string, revision: number, state: "active" | "paused" | "archived") {
  const db = await flowsDb();
  await assertNotAutomation(db, id);
  const r = await db.rpc("set_crm_email_flow_state", { p_id: id, p_revision: revision, p_state: state });
  if (r.error || !r.data) throw new Error(rpcMessage(r.error?.message, "Não foi possível mudar o estado do fluxo."));
  return r.data as EmailFlow;
}
export async function enrollLeads(flowId: string, leadIds: string[]) {
  const db = await flowsDb();
  await assertNotAutomation(db, flowId);
  const r = await db.rpc("enroll_crm_email_flow", { p_flow: flowId, p_leads: leadIds });
  if (r.error || !r.data) throw new Error(rpcMessage(r.error?.message, "Não foi possível adicionar os contatos."));
  return r.data as { added: number; skipped: { lead: string; reason: string }[] };
}
export async function enrollmentAction(id: string, action: "pause" | "resume" | "stop") {
  const db = await flowsDb();
  const r = await db.rpc("set_crm_email_flow_enrollment", { p_id: id, p_action: action });
  if (r.error || r.data !== true) throw new Error(rpcMessage(r.error?.message, "Esta ação não está disponível para o estado atual do contato."));
  return { ok: true };
}
export async function clearAiBlock() {
  const db = await flowsDb();
  const r = await db.from("crm_email_flow_runner").update({ ai_blocked_reason: "" }).eq("id", true);
  if (r.error) throw new Error("Não foi possível liberar a IA.");
  return { ok: true };
}
export async function discardSuggestion(id: string, revision: number) {
  const db = await flowsDb();
  const r = await db.rpc("discard_crm_email_flow_suggestion", { p_suggestion: id, p_revision: revision });
  if (r.error || r.data !== true) throw new Error(rpcMessage("stale_suggestion", ""));
  return { ok: true };
}

/** Envio de uma resposta personalizada somente após aprovação explícita (a função exige confirmed=true). */
export async function approveSuggestion(id: string, revision: number, subject: string, body: string) {
  const db = await flowsDb();
  const settings = await loadEmailSettings(db);
  if (!settings.sender_email) throw new Error("Remetente de e-mail não configurado em Campanhas.");
  const reserved = await db.rpc("reserve_crm_email_flow_reply", { p_suggestion: id, p_revision: revision, p_subject: subject, p_body: body });
  if (reserved.error || !reserved.data) throw new Error(rpcMessage(reserved.error?.message, "Não foi possível reservar o envio."));
  const { contact, inbound } = reserved.data as { message: string; contact: string; inbound: string };
  const [lead, original] = await Promise.all([
    db.from("crm_email_flow_suggestions").select("lead_id").eq("id", id).single().then(async (s) => s.data?.lead_id ? db.from("leads").select("name,company").eq("id", s.data.lead_id).single() : { data: null }),
    db.from("crm_email_flow_messages").select("rfc_message_id").eq("id", inbound).single(),
  ]);
  const replyTo = effectiveReplyTo(settings);
  const content = renderEmail({ subject, body }, { name: lead.data?.name ?? "", company: lead.data?.company ?? "" });
  const outcome = await brevoSend(settings, { to: contact, toName: lead.data?.name ?? "", subject: content.subject, html: content.html, text: content.text, scheduledAt: null, batchId: crypto.randomUUID(), tag: "crm-flow-reply", replyTo, inReplyTo: original.data?.rfc_message_id ?? undefined });
  await db.rpc("finish_crm_email_flow_reply", { p_suggestion: id, p_state: outcome.state, p_provider_id: outcome.state === "accepted" ? outcome.messageId : "", p_error: outcome.state === "accepted" ? "" : outcome.code });
  if (outcome.state === "accepted") return { ok: true, message: `Resposta aceita pela Brevo para ${contact}.` };
  return { ok: false, message: outcome.state === "failed" ? `A Brevo recusou o envio (${outcome.code}). Nada foi enviado.` : `Resultado desconhecido (${outcome.code}); confira antes de responder de novo. Não será reenviado automaticamente.` };
}

/* ------------------------------ Card do lead ------------------------------ */

export async function leadEmailMarketing(leadId: string) {
  const { deskLeadAccess } = await import("./lead-deskdata.server");
  const { db, level } = await deskLeadAccess(leadId, false);
  if (level !== "full") return { allowed: false as const };
  const [lead, deliveries, messages, enrollments, suggestions, inbox, settings] = await Promise.all([
    db.from("leads").select("name,company").eq("id", leadId).single(),
    db.from("crm_campaign_deliveries").select("id,campaign_id,contact,state,error_code,created_at,updated_at,scheduled_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(100),
    db.from("crm_email_flow_messages").select("id,flow_id,enrollment_id,direction,kind,step,contact,subject,body,state,ai_personalized,error_code,created_at,updated_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(200),
    db.from("crm_email_flow_enrollments").select("id,flow_id,status,next_step,next_send_at,last_sent_at,replied_at,reason").eq("lead_id", leadId).limit(20),
    db.from("crm_email_flow_suggestions").select("id,inbound_id,analysis,subject,body,state,revision,created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(20),
    db.from("crm_email_inbox").select("id,gmail_message_id,from_address,from_name,to_address,subject,body,received_at,unread,match").eq("lead_id", leadId).order("received_at", { ascending: false }).limit(100),
    loadEmailSettings(db),
  ]);
  if (lead.error || deliveries.error || messages.error || enrollments.error || suggestions.error || inbox.error) throw new Error("Histórico de e-mails indisponível.");
  const sender = settings.sender_email || "remetente da campanha", replyTo = effectiveReplyTo(settings);
  const campaignIds = [...new Set((deliveries.data ?? []).map((d) => d.campaign_id))];
  const flowIds = [...new Set([...(messages.data ?? []).map((m) => m.flow_id), ...(enrollments.data ?? []).map((e) => e.flow_id)])];
  const [campaigns, flows] = await Promise.all([
    campaignIds.length ? db.from("crm_campaigns").select("id,name,subject,body").in("id", campaignIds) : Promise.resolve({ data: [], error: null }),
    flowIds.length ? db.from("crm_email_flows").select("id,name,steps,state,ai_enabled,ai_approved_revision,revision,max_messages").in("id", flowIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const cMap = new Map((campaigns.data ?? []).map((c) => [c.id as string, c as { name: string; subject: string; body: string }]));
  const fMap = new Map((flows.data ?? []).map((f) => [f.id as string, f as { name: string; steps: unknown[]; state: string; ai_enabled: boolean; ai_approved_revision: number | null; revision: number; max_messages: number }]));
  const who = { name: lead.data.name ?? "", company: lead.data.company ?? "" };
  const deliveryLabel: Record<string, string> = { reserved: "Em envio", accepted: "Enviado", scheduled: "Agendado", failed: "Recusado (não enviado)", unknown: "Resultado desconhecido", cancelled: "Cancelado" };
  const messageLabel: Record<string, string> = { reserved: "Em envio", accepted: "Enviado", failed: "Recusado (não enviado)", unknown: "Resultado desconhecido", received: "Resposta recebida" };
  const records = [
    ...(deliveries.data ?? []).map((d) => {
      const c = cMap.get(d.campaign_id);
      const rendered = renderEmail({ subject: c?.subject ?? "", body: c?.body ?? "" }, who);
      return { id: `c:${d.id}`, source: "Campanha", name: c?.name ?? "Campanha", subject: rendered.subject, contact: d.contact, from: sender, to: d.contact as string, unread: false, date: (d.scheduled_at && d.state === "scheduled" ? d.scheduled_at : d.updated_at) as string, status: deliveryLabel[d.state] ?? d.state, direction: "out" as const, body: rendered.text, error: d.error_code as string | null, ai: false };
    }),
    ...(messages.data ?? []).map((m) => {
      const f = fMap.get(m.flow_id);
      const label = m.kind === "inbound" ? "Resposta do cliente" : m.kind === "reply" ? "Resposta personalizada" : `Etapa ${(m.step ?? 0) + 1}`;
      return { id: `f:${m.id}`, source: "Fluxo", name: `${f?.name ?? "Fluxo"} · ${label}`, subject: m.subject, contact: m.contact, from: m.direction === "in" ? m.contact as string : sender, to: m.direction === "in" ? replyTo : m.contact as string, unread: false, date: m.updated_at as string, status: messageLabel[m.state] ?? m.state, direction: m.direction as "out" | "in", body: m.direction === "out" ? renderEmail({ subject: m.subject, body: m.body }, who).text : m.body, error: m.error_code as string | null, ai: Boolean(m.ai_personalized) };
    }),
    ...(inbox.data ?? []).map((i) => ({ id: `i:${i.id}`, source: "E-mail recebido", name: i.from_name ? `${i.from_name}` : "Mensagem direta", subject: i.subject as string, contact: i.from_address as string,
      from: i.from_address as string, to: (i.to_address as string) || replyTo, date: i.received_at as string, status: i.unread ? "Não lido" : "Recebido", direction: "in" as const, body: i.body as string, error: null as string | null, ai: false, unread: Boolean(i.unread) })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return {
    allowed: true as const,
    records,
    enrollments: (enrollments.data ?? []).map((e) => {
      const f = fMap.get(e.flow_id);
      return { ...e, flowName: f?.name ?? "Fluxo", flowState: f?.state ?? "archived", aiOn: f ? aiApproved(f) : false, totalSteps: f ? Math.min(f.steps.length, f.max_messages) : 0,
        replies: (messages.data ?? []).filter((m) => m.enrollment_id === e.id && m.direction === "in").length };
    }) as { id: string; flow_id: string; flowName: string; flowState: string; aiOn: boolean; totalSteps: number; replies: number; status: EnrollmentStatus; next_step: number; next_send_at: string | null; last_sent_at: string | null; replied_at: string | null; reason: string }[],
    receivedCount: (inbox.data ?? []).length + (messages.data ?? []).filter((m) => m.direction === "in").length,
    suggestions: (suggestions.data ?? []) as { id: string; inbound_id: string; analysis: string; subject: string; body: string; state: string; revision: number; created_at: string }[],
  };
}

/* ------------------------------ Executor ------------------------------ */

async function leadContext(db: Db, leadId: string, enrollmentId: string): Promise<FlowLeadContext> {
  const [lead, company, msgs] = await Promise.all([
    db.from("leads").select("name,company,history").eq("id", leadId).single(),
    db.from("b2b_companies").select("profile").eq("lead_id", leadId).maybeSingle(),
    db.from("crm_email_flow_messages").select("direction,subject,body,state").eq("enrollment_id", enrollmentId).in("state", ["accepted", "received"]).order("created_at").limit(12),
  ]);
  const p = (company.data?.profile ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string).slice(0, 300) : "");
  const history = Array.isArray(lead.data?.history) ? (lead.data!.history as { text?: string }[]).slice(-8).map((h) => String(h.text ?? "").slice(0, 300)) : [];
  return {
    name: lead.data?.name ?? "", company: lead.data?.company ?? s("tradeName") ?? "", segment: s("segment"), city: s("city"), website: s("website"),
    history,
    previousEmails: (msgs.data ?? []).map((m) => ({ direction: m.direction as "out" | "in", subject: m.subject, body: m.body.slice(0, 1500) })),
    publicResearch: insightForEmail(await insightForLead(leadId).catch(() => null)),
  };
}

export type RunResult = {
  skipped?: string; gmail: "ok" | "unavailable"; replies: number; optOuts: number; suggestions: number;
  sent: number; failed: number; unknown: number; notes: string[]; inbox?: InboxSyncResult;
};

/**
 * Uma execução limitada: (1) lê respostas reais no Gmail e pausa as sequências; (2) gera até 5 sugestões;
 * (3) envia até 10 etapas devidas. Sem leitura do Gmail, nada é enviado (não dá para saber se o cliente respondeu).
 */
export async function runEmailFlows(db: Db): Promise<RunResult> {
  const token = crypto.randomUUID();
  const claim = await db.rpc("claim_crm_email_flow_runner", { p_token: token, p_seconds: 240 });
  const result: RunResult = { gmail: "unavailable", replies: 0, optOuts: 0, suggestions: 0, sent: 0, failed: 0, unknown: 0, notes: [] };
  if (claim.error || claim.data !== true) return { ...result, skipped: "Outra execução está em andamento." };
  let gmailOk = false;
  try {
    await db.rpc("settle_crm_email_flows");
    // Automações: cards novos do gatilho entram e quem preencheu o formulário sai antes de qualquer envio.
    const automationsOk = await automationPreSend(db, result.notes);
    const runner = await db.from("crm_email_flow_runner").select("ai_blocked_reason,agent_enabled").eq("id", true).single();
    let aiBlocked = runner.data?.ai_blocked_reason ?? "";
    const agentOn = runner.data?.agent_enabled === true;
    const blockAi = async (reason: string) => { aiBlocked = reason; await db.from("crm_email_flow_runner").update({ ai_blocked_reason: reason }).eq("id", true); };

    // 1) Respostas reais na caixa do Gmail.
    const settings = await loadEmailSettings(db);
    const replyTo = effectiveReplyTo(settings);
    try {
      const mailbox = await gmailMailbox();
      // Sem o endereço de respostas na caixa conectada, não há como saber se o cliente respondeu: nada é enviado.
      if (!replyAddressMonitored(replyTo, mailbox))
        throw new Error(`as respostas vão para ${replyTo || "(sem endereço)"}, que não chega à caixa ${mailbox.address}.`);
      const own = [mailbox.address, ...mailbox.aliases, settings.sender_email, replyTo];
      const live = await db.from("crm_email_flow_enrollments").select("id,contact,started_at,lead_id,flow_id").in("status", ["active", "awaiting_reply", "in_conversation", "paused"]).not("last_sent_at", "is", null).limit(500);
      if (live.error) throw new Error("Inscrições indisponíveis.");
      const rows = live.data ?? [];
      for (let i = 0; i < rows.length; i += 20) {
        const chunk = rows.slice(i, i + 20);
        const byContact = new Map(chunk.map((r) => [(r.contact as string).toLowerCase(), r]));
        const after = Math.min(...chunk.map((r) => Date.parse(r.started_at))) / 1000;
        const replies = await gmailFindReplies(gmailReplyQuery([...byContact.keys()], after), 25);
        const known = replies.length ? await db.from("crm_email_flow_messages").select("gmail_message_id").in("gmail_message_id", replies.map((r) => r.id)) : { data: [], error: null };
        if (known.error) throw new Error("Respostas já registradas indisponíveis.");
        const seen = new Set((known.data ?? []).map((k) => k.gmail_message_id));
        for (const { reply: r, enrollment: e } of matchReplies(replies, byContact, own, seen)) {
          const text = stripQuoted(r.text) || r.text.slice(0, 2000);
          const optOut = isOptOut(`${r.subject}\n${text}`);
          const saved = await db.rpc("record_crm_email_flow_reply", { p_enrollment: e.id, p_gmail_id: r.id, p_rfc_id: r.rfcId, p_subject: r.subject, p_body: text, p_opt_out: optOut });
          // Se a resposta não pôde ser registrada, a sequência não foi pausada: suspende os envios.
          if (saved.error) throw new Error("não foi possível registrar uma resposta no card.");
          if (saved.data) {
            result.replies++; if (optOut) result.optOuts++;
            // Central de Notificações: avisa sobre a resposta pelos canais ligados (nunca interrompe o fluxo).
            try {
              const { notifyEmailReply, notifyAutomationReply } = await import("./notifications.server");
              const ext = e as { lead_id?: string | null; flow_id?: string | null };
              await notifyEmailReply(db, { gmailMessageId: r.id, contact: e.contact, company: "", subject: r.subject, leadId: ext.lead_id ?? null });
              await notifyAutomationReply(db, { gmailMessageId: r.id, contact: e.contact, company: "", flowId: ext.flow_id ?? null });
            } catch { /* notificação nunca bloqueia o registro da resposta */ }
          }
        }
      }
      // Caixa de entrada completa: e-mails de contatos com card e mensagens ao endereço comercial.
      try {
        const synced = await syncInbox(db, mailbox, replyTo, own);
        result.inbox = synced; result.replies += synced.flowReplies;
        await db.from("crm_email_flow_runner").update({ inbox_synced_at: new Date().toISOString(), inbox_error: "" }).eq("id", true);
      } catch (e) {
        await db.from("crm_email_flow_runner").update({ inbox_error: (e instanceof Error ? e.message : "Falha na sincronização.").slice(0, 300) }).eq("id", true);
        throw e;
      }
      gmailOk = true;
      result.gmail = "ok";
    } catch (e) {
      result.notes.push(`Gmail: ${e instanceof Error ? e.message : "indisponível"} Envios automáticos suspensos nesta execução.`);
    }
    await automationPostReplies(db, result.notes);

    // 2) Sugestões de resposta (aguardam aprovação humana).
    if (!aiBlocked) {
      const inbound = await db.from("crm_email_flow_messages").select("id,enrollment_id,lead_id,subject,body").eq("direction", "in").order("created_at", { ascending: false }).limit(50);
      const ids = (inbound.data ?? []).map((m) => m.id);
      const done = ids.length ? await db.from("crm_email_flow_suggestions").select("inbound_id").in("inbound_id", ids) : { data: [] };
      const has = new Set((done.data ?? []).map((d) => d.inbound_id));
      const pendingInbound = (inbound.data ?? []).filter((m) => !has.has(m.id));
      const statuses = pendingInbound.length ? await db.from("crm_email_flow_enrollments").select("id,status").in("id", pendingInbound.map((m) => m.enrollment_id)) : { data: [] };
      const open = new Set((statuses.data ?? []).filter((s) => s.status === "awaiting_reply").map((s) => s.id));
      for (const m of pendingInbound.filter((x) => open.has(x.enrollment_id)).slice(0, FLOW_SUGGESTIONS_PER_RUN)) {
        try {
          const ctx = m.lead_id ? await leadContext(db, m.lead_id, m.enrollment_id) : { name: "", company: "", segment: "", city: "", website: "", history: [], previousEmails: [] };
          const s = await suggestFlowReply({ subject: m.subject, text: m.body }, ctx);
          const saved = await db.rpc("save_crm_email_flow_suggestion", { p_inbound: m.id, p_analysis: s.analysis, p_subject: s.subject, p_body: s.body });
          if (saved.data) result.suggestions++;
        } catch (e) {
          if (e instanceof FlowAiError && e.blocking) { await blockAi(e.message); result.notes.push(`IA pausada: ${e.message}`); break; }
          result.notes.push("Uma sugestão não pôde ser gerada; nova tentativa na próxima execução.");
          break;
        }
      }
    }

    // 3) Etapas devidas (somente com o agente de e-mail ligado e a caixa lida com sucesso).
    if (gmailOk && !agentOn) result.notes.push("Agente Comercial de e-mail desligado: nenhuma etapa enviada.");
    if (gmailOk && agentOn) {
      const due = await db.from("crm_email_flow_enrollments").select("id,flow_id,lead_id,contact,next_step").eq("status", "active").lte("next_send_at", new Date().toISOString()).order("next_send_at").limit(FLOW_BATCH_PER_RUN * 3);
      if ((due.data ?? []).length) {
        const since = new Date(Date.now() - 864e5).toISOString();
        const [a, b, c] = await Promise.all([
          db.from("crm_email_flow_messages").select("id", { count: "exact", head: true }).eq("direction", "out").in("state", ["accepted", "reserved"]).gte("updated_at", since),
          db.from("crm_campaign_deliveries").select("id", { count: "exact", head: true }).in("state", ["accepted", "scheduled", "reserved"]).gte("updated_at", since),
          db.from("b2b_ai_email_items").select("id", { count: "exact", head: true }).in("send_state", ["accepted", "reserved"]).gte("send_reserved_at", since),
        ]);
        let quota = Math.min(FLOW_BATCH_PER_RUN, remainingDailyQuota((a.count ?? 0) + (b.count ?? 0) + (c.count ?? 0)));
        if (!quota) result.notes.push("Limite diário de envios atingido; as etapas seguem na próxima janela.");
        const issues = quota ? providerIssues(await brevoProviderStatus(settings), settings, "campaign").filter((i) => i.blocking) : [];
        if (issues.length) { result.notes.push(`Envio bloqueado: ${issues.map((i) => i.message).join(" ")}`); quota = 0; }
        const flowIds = [...new Set((due.data ?? []).map((d) => d.flow_id))];
        const flows = await db.from("crm_email_flows").select("*").in("id", flowIds);
        const fMap = new Map(((flows.data ?? []) as EmailFlow[]).map((f) => [f.id, f]));
        let outside = 0;
        for (const e of due.data ?? []) {
          if (quota <= 0) break;
          const f = fMap.get(e.flow_id);
          const step = f?.steps[e.next_step];
          if (!f || f.state !== "active" || !step) continue;
          if (!inSendWindow(f)) { outside++; continue; }
          // Etapas de Automações: link rastreado, variáveis da empresa, IA por etapa, botão e assinatura Gravon.
          const auto = f.automation_id ? await automationSendContext(db, e.id, e.lead_id) : null;
          if (auto && (!automationsOk || !auto.token)) continue;
          if (auto && (step.cta || step.body.includes(LINK_PLACEHOLDER)) && !auto.landingOk) { result.notes.push("Automação sem landing page configurada: etapa não enviada."); continue; }
          const lead = await db.from("leads").select("name,company").eq("id", e.lead_id).single();
          const who = { name: lead.data?.name ?? "", company: lead.data?.company ?? "" };
          const vars = (t: string) => personalize(auto ? fillCompanyVars(t, auto) : t, who.name, who.company);
          let subject = vars(step.subject), body = vars(step.body), ai = false;
          if (aiApproved(f) && !aiBlocked && (!auto || step.ai !== false)) {
            try {
              const out = await personalizeFlowStep({ subject, body, index: e.next_step, total: f.steps.length }, await leadContext(db, e.lead_id, e.id));
              subject = out.subject; body = out.body; ai = true;
            } catch (err) {
              if (err instanceof FlowAiError && err.blocking) { await blockAi(err.message); result.notes.push(`IA pausada: ${err.message} Etapas seguem com o texto aprovado.`); }
            }
          }
          if (auto && auto.token) {
            body = assembleBody(body, step.cta ?? "", trackedLink(EMAIL_PUBLIC_ORIGIN, auto.token));
            if (step.signature) body = withGravonSignature(body);
          }
          const reserved = await db.rpc("reserve_crm_email_flow_step", { p_enrollment: e.id, p_step: e.next_step, p_subject: subject, p_body: body, p_ai: ai });
          if (reserved.error || !reserved.data) continue;
          quota--;
          const content = renderEmail({ subject, body }, who);
          let tracked: { html: string; text: string };
          try { tracked = await trackFlowEmail(String(reserved.data), content); }
          catch {
            await db.rpc('finish_crm_email_flow_step', { p_message: reserved.data, p_state: 'failed', p_provider_id: '', p_error: 'tracking_preparation_failed' });
            result.failed++; continue;
          }
          const outcome = await brevoSend(settings, { to: e.contact, toName: who.name, subject: content.subject, html: tracked.html, text: tracked.text, scheduledAt: null, batchId: crypto.randomUUID(), tag: `crm-flow-${f.id}`, replyTo });
          await db.rpc("finish_crm_email_flow_step", { p_message: reserved.data, p_state: outcome.state, p_provider_id: outcome.state === "accepted" ? outcome.messageId : "", p_error: outcome.state === "accepted" ? "" : outcome.code });
          if (outcome.state === "accepted") result.sent++; else if (outcome.state === "failed") result.failed++; else result.unknown++;
        }
        if (outside) result.notes.push(`${outside} etapa(s) aguardando o dia/horário de envio configurado.`);
      }
    }
    return result;
  } finally {
    await db.rpc("release_crm_email_flow_runner", { p_token: token, p_result: result, p_gmail: gmailOk });
  }
}

/** Execução manual pela tela (sessão CRM completa). */
export async function runEmailFlowsNow() { return runEmailFlows(await flowsDb()); }

/** Executor agendado: o token é comparado com o valor privado guardado no banco. */
export async function runEmailFlowsScheduled(bearer: string) {
  const db = await b2bDb();
  const row = await db.from("crm_email_flow_runner").select("token").eq("id", true).single();
  const expected = row.data?.token ?? "";
  if (!expected || bearer.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ bearer.charCodeAt(i);
  if (diff !== 0) return null;
  return runEmailFlows(db);
}

/* ------------------------- Agente Comercial: e-mail ------------------------- */

export async function syncEmailsNow() {
  const db = await flowsDb();
  const settings = await loadEmailSettings(db);
  const replyTo = effectiveReplyTo(settings);
  try {
    const mailbox = await gmailMailbox();
    const r = await syncInbox(db, mailbox, replyTo, [settings.sender_email, replyTo]);
    await db.from("crm_email_flow_runner").update({ inbox_synced_at: new Date().toISOString(), inbox_error: "" }).eq("id", true);
    return r;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha na sincronização.";
    await db.from("crm_email_flow_runner").update({ inbox_error: message.slice(0, 300) }).eq("id", true);
    throw new Error(`Sincronização com o Gmail falhou: ${message} Os envios automáticos ficam suspensos até uma leitura confiável.`);
  }
}

export async function setEmailAgent(enabled: boolean) {
  const db = await flowsDb();
  const r = await db.rpc("set_crm_email_agent_enabled", { p_enabled: enabled });
  if (r.error) throw new Error("Não foi possível mudar o agente de e-mail.");
  return { enabled: r.data === true };
}

export async function saveFlowSchedule(input: FlowScheduleInput) {
  const db = await flowsDb();
  const r = await db.rpc("save_crm_email_flow_schedule", { p_id: input.id, p_revision: input.revision, p_days: input.days, p_start: input.start, p_end: input.end, p_max: input.maxMessages });
  if (r.error || !r.data) throw new Error(rpcMessage(r.error?.message, "Não foi possível salvar dias e horários."));
  return r.data as EmailFlow;
}

export async function reviewInbox() { return inboxReview(await flowsDb()); }
export async function resolveInboxMessage(input: Parameters<typeof resolveInbox>[1]) { return resolveInbox(await flowsDb(), input); }

/** Painel do agente para um funil: fluxos, indicadores, próximos envios, aguardando atendimento e falhas. */
export async function emailAgentOverview(pipelineId: string | null) {
  const db = await flowsDb();
  const leadsQ = db.from("leads").select("id,name,company,email,stage").limit(2000);
  const [flows, runner, leads] = await Promise.all([
    db.from("crm_email_flows").select("*").neq("state", "archived").order("created_at", { ascending: false }).limit(100),
    db.from("crm_email_flow_runner").select("agent_enabled,last_run_at,last_result,gmail_checked_at,inbox_synced_at,inbox_error").eq("id", true).maybeSingle(),
    pipelineId ? leadsQ.eq("pipeline_id", pipelineId) : leadsQ.is("pipeline_id", null),
  ]);
  if (flows.error || runner.error || leads.error) throw new Error("Agente de e-mail indisponível no momento.");
  const leadRows = (leads.data ?? []) as { id: string; name: string; company: string; email: string; stage: string }[];
  const ids = leadRows.map((l) => l.id);
  const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / 300) }, (_, i) => xs.slice(i * 300, i * 300 + 300));
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const enr: { id: string; flow_id: string; lead_id: string; contact: string; status: EnrollmentStatus; next_step: number; next_send_at: string | null; last_sent_at: string | null; reason: string }[] = [];
  const msgs: { lead_id: string; direction: string; state: string; error_code: string | null; updated_at: string; subject: string }[] = [];
  const dels: { lead_id: string; state: string; error_code: string | null; updated_at: string }[] = [];
  let inboxCount = 0;
  for (const part of chunks(ids)) {
    const [e, m, d, i] = await Promise.all([
      db.from("crm_email_flow_enrollments").select("id,flow_id,lead_id,contact,status,next_step,next_send_at,last_sent_at,reason").in("lead_id", part),
      db.from("crm_email_flow_messages").select("lead_id,direction,state,error_code,updated_at,subject").in("lead_id", part).gte("updated_at", since),
      db.from("crm_campaign_deliveries").select("lead_id,state,error_code,updated_at").in("lead_id", part).gte("updated_at", since),
      db.from("crm_email_inbox").select("id", { count: "exact", head: true }).in("lead_id", part).gte("received_at", since),
    ]);
    if (e.error || m.error || d.error || i.error) throw new Error("Indicadores do agente indisponíveis.");
    enr.push(...(e.data as typeof enr)); msgs.push(...(m.data as typeof msgs)); dels.push(...(d.data as typeof dels)); inboxCount += i.count ?? 0;
  }
  const leadOf = new Map(leadRows.map((l) => [l.id, l]));
  const allFlows = (flows.data ?? []) as EmailFlow[];
  const flowName = new Map(allFlows.map((f) => [f.id, f.name]));
  const live = enr.filter((e) => ["active", "awaiting_reply", "in_conversation", "paused"].includes(e.status));
  const person = (id: string) => { const l = leadOf.get(id); return { leadId: id, name: l?.name || "Sem nome", company: l?.company ?? "" }; };
  const failures = [
    ...msgs.filter((m) => m.direction === "out" && (m.state === "failed" || m.state === "unknown")).map((m) => ({ ...person(m.lead_id), kind: m.state === "failed" ? "Envio recusado" : "Resultado desconhecido", detail: m.error_code ?? m.subject, at: m.updated_at })),
    ...dels.filter((d) => d.state === "failed" || d.state === "unknown").map((d) => ({ ...person(d.lead_id), kind: d.state === "failed" ? "Campanha recusada" : "Campanha com resultado desconhecido", detail: d.error_code ?? "", at: d.updated_at })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 20);
  const r = runner.data as { agent_enabled: boolean; last_run_at: string | null; last_result: { notes?: string[] }; gmail_checked_at: string | null; inbox_synced_at: string | null; inbox_error: string } | null;
  const reviewCount = await db.from("crm_email_inbox").select("id", { count: "exact", head: true }).eq("status", "review");
  return {
    agentEnabled: r?.agent_enabled === true,
    runner: { lastRunAt: r?.last_run_at ?? null, gmailCheckedAt: r?.gmail_checked_at ?? null, inboxSyncedAt: r?.inbox_synced_at ?? null, syncError: r?.inbox_error ?? "", notes: r?.last_result?.notes ?? [] },
    flows: allFlows.map((f) => ({ ...f, aiOn: aiApproved(f), people: live.filter((e) => e.flow_id === f.id).length })),
    metrics: {
      activeFlows: allFlows.filter((f) => f.state === "active").length,
      pausedFlows: allFlows.filter((f) => f.state === "paused" || f.state === "draft").length,
      following: live.length,
      sent: msgs.filter((m) => m.direction === "out" && m.state === "accepted").length + dels.filter((d) => d.state === "accepted").length,
      replies: msgs.filter((m) => m.direction === "in").length + inboxCount,
      awaiting: enr.filter((e) => e.status === "awaiting_reply").length,
      failures: failures.length + (r?.inbox_error ? 1 : 0),
    },
    upcoming: enr.filter((e) => e.status === "active" && e.next_send_at).sort((a, b) => Date.parse(a.next_send_at!) - Date.parse(b.next_send_at!)).slice(0, 10)
      .map((e) => ({ ...person(e.lead_id), flow: flowName.get(e.flow_id) ?? "Fluxo", step: e.next_step + 1, at: e.next_send_at! })),
    awaiting: enr.filter((e) => e.status === "awaiting_reply").slice(0, 20).map((e) => ({ ...person(e.lead_id), flow: flowName.get(e.flow_id) ?? "Fluxo", reason: e.reason })),
    paused: enr.filter((e) => e.status === "paused").slice(0, 20).map((e) => ({ ...person(e.lead_id), flow: flowName.get(e.flow_id) ?? "Fluxo", reason: e.reason })),
    failures,
    reviewCount: reviewCount.count ?? 0,
    leads: leadRows.filter((l) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email.trim())).map((l) => ({ id: l.id, name: l.name, company: l.company, email: l.email, stage: l.stage, inFlow: live.some((e) => e.lead_id === l.id) })),
  };
}
