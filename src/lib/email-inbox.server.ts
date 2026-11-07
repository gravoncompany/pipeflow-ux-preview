import type { b2bDb } from "./b2b-prospecting.server";
import { businessInboxQuery, isOptOut, knownContactsQuery, referencedIds, shouldImportInbound, stripQuoted, type GmailMailbox } from "./email-flows";
import { gmailGetMessage, gmailListIds } from "./gmail.server";

type Db = Awaited<ReturnType<typeof b2bDb>>;

/** Janela de leitura: últimos 30 dias na primeira vez; depois, desde a última leitura com 2 dias de folga. */
const FIRST_SYNC_DAYS = 30, OVERLAP_DAYS = 2, MAX_NEW_PER_RUN = 40, LEAD_CONTACTS = 300;

export type InboxSyncResult = { imported: number; linked: number; review: number; flowReplies: number; skipped: number };

/**
 * Lê mensagens novas do Gmail conectado e registra no CRM:
 * - destinadas ao endereço comercial (contato@…), ou
 * - vindas de um contato que já tem card.
 * Mensagens pessoais da caixa, listas e avisos automáticos de desconhecidos não entram.
 * Se a mensagem é de um contato em sequência, a sequência pausa (resposta registrada no fluxo).
 * Lança erro em qualquer falha de leitura: quem chama suspende os envios.
 */
export async function syncInbox(db: Db, mailbox: GmailMailbox, businessAddress: string, own: string[]): Promise<InboxSyncResult> {
  const result: InboxSyncResult = { imported: 0, linked: 0, review: 0, flowReplies: 0, skipped: 0 };
  const runner = await db.from("crm_email_flow_runner").select("inbox_synced_at").eq("id", true).single();
  if (runner.error) throw new Error("Estado da sincronização indisponível.");
  const last = runner.data?.inbox_synced_at ? Date.parse(runner.data.inbox_synced_at) : 0;
  const after = Math.max(Date.now() - FIRST_SYNC_DAYS * 864e5, last ? last - OVERLAP_DAYS * 864e5 : 0) / 1000;

  const leads = await db.from("leads").select("email").neq("email", "").order("updated_at", { ascending: false }).limit(LEAD_CONTACTS);
  if (leads.error) throw new Error("Contatos indisponíveis para a sincronização.");
  const known = new Set((leads.data ?? []).map((l) => String(l.email).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)));
  const ownList = [...new Set([mailbox.address, ...mailbox.aliases, ...own].map((a) => a.toLowerCase()).filter(Boolean))];

  const ids = new Map<string, string>();
  const business = businessAddress.trim().toLowerCase();
  if (business) for (const m of await gmailListIds(businessInboxQuery(business, after), 50)) ids.set(m.id, m.threadId);
  const contacts = [...known].filter((c) => !ownList.includes(c));
  for (let i = 0; i < contacts.length; i += 20)
    for (const m of await gmailListIds(knownContactsQuery(contacts.slice(i, i + 20), after), 25)) ids.set(m.id, m.threadId);
  if (!ids.size) return result;

  const all = [...ids.keys()];
  const [inInbox, inFlows] = await Promise.all([
    db.from("crm_email_inbox").select("gmail_message_id").in("gmail_message_id", all),
    db.from("crm_email_flow_messages").select("gmail_message_id").in("gmail_message_id", all),
  ]);
  if (inInbox.error || inFlows.error) throw new Error("Mensagens já registradas indisponíveis.");
  const seen = new Set([...(inInbox.data ?? []), ...(inFlows.data ?? [])].map((r) => r.gmail_message_id as string));
  const fresh = all.filter((id) => !seen.has(id)).slice(0, MAX_NEW_PER_RUN);

  for (const id of fresh) {
    const m = await gmailGetMessage(id);
    if (!shouldImportInbound(m, known.has(m.from), ownList)) { result.skipped++; continue; }
    const body = stripQuoted(m.text) || m.text.slice(0, 2000);
    const saved = await db.rpc("record_crm_email_inbox", {
      p: { gmailId: m.id, threadId: m.threadId, rfcId: m.rfcId, from: m.from, fromName: m.fromName, to: m.to, subject: m.subject, body, receivedAt: new Date(m.internalDate || Date.now()).toISOString(), unread: m.unread },
      p_refs: referencedIds(m.inReplyTo, m.references),
    });
    if (saved.error) throw new Error("Não foi possível registrar um e-mail recebido.");
    const r = saved.data as { id: string | null; lead: string | null; new: boolean; status: string };
    if (!r.new) continue;
    result.imported++;
    if (!r.lead) { result.review++; continue; }
    result.linked++;
    // Contato em sequência: registra como resposta do fluxo (pausa os envios e gera sugestão para aprovação).
    const live = await db.from("crm_email_flow_enrollments").select("id,started_at").eq("lead_id", r.lead).in("status", ["active", "awaiting_reply", "in_conversation", "paused"]).limit(1).maybeSingle();
    if (live.error) throw new Error("Sequência do contato indisponível.");
    if (live.data && m.internalDate >= Date.parse(live.data.started_at)) {
      const reply = await db.rpc("record_crm_email_flow_reply", { p_enrollment: live.data.id, p_gmail_id: m.id, p_rfc_id: m.rfcId, p_subject: m.subject, p_body: body, p_opt_out: isOptOut(`${m.subject}\n${body}`) });
      if (reply.error) throw new Error("Não foi possível pausar a sequência de um contato que respondeu.");
      if (reply.data) {
        result.flowReplies++;
        // Central de Notificações: avisa sobre a resposta pelos canais ligados (nunca interrompe a sincronização).
        try {
          const { notifyEmailReply } = await import("./notifications.server");
          await notifyEmailReply(db, { gmailMessageId: m.id, contact: m.from, company: "", subject: m.subject, leadId: r.lead });
        } catch { /* notificação nunca bloqueia o registro da resposta */ }
      }
    }
  }
  return result;
}

/** Remetentes sem card aguardando revisão. */
export async function inboxReview(db: Db) {
  const r = await db.from("crm_email_inbox").select("id,from_address,from_name,to_address,subject,body,received_at,unread,match").eq("status", "review").order("received_at", { ascending: false }).limit(100);
  if (r.error) throw new Error("E-mails para revisão indisponíveis.");
  return r.data ?? [];
}

export async function resolveInbox(db: Db, input: { id: string; action: "ignore" | "link" | "create"; leadId: string | null; pipelineId: string | null; name: string; company: string }) {
  const r = await db.rpc("resolve_crm_email_inbox", { p_id: input.id, p_action: input.action, p_lead: input.leadId, p_pipeline: input.pipelineId, p_name: input.name, p_company: input.company });
  if (r.error) {
    const m = r.error.message;
    if (m.includes("stale_inbox")) throw new Error("Este e-mail já foi revisado. Atualize a página.");
    if (m.includes("lead_exists")) throw new Error("Já existe um card com este e-mail; use “Vincular a um card”.");
    if (m.includes("pipeline_not_found")) throw new Error("Funil indisponível.");
    if (m.includes("lead_not_found")) throw new Error("Card não encontrado.");
    if (m.includes("invalid_name")) throw new Error("Informe o nome do contato.");
    throw new Error("Não foi possível concluir a revisão.");
  }
  return r.data as { status: string; lead?: string };
}
