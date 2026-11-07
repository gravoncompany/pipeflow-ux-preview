import { CLIENTS_ACTOR, requireClientsSession } from "./crm-clients.server";
import { sameWhatsAppNumber } from "./phone";

type Db = Awaited<ReturnType<typeof requireClientsSession>>;

/** Finds the single registered client whose WhatsApp matches the message's contact; ambiguity is never guessed. */
async function resolve(db: Db, messageId: string) {
  const msg = await db.from("whatsapp_messages").select("id,body,phone,sent_at,from_me").eq("message_id", messageId).maybeSingle();
  if (msg.error || !msg.data) throw new Error("Mensagem não encontrada.");
  const clients = await db.from("crm_clients").select("id,trade_name,contact_name,whatsapp,phone,lead_id").limit(2001);
  if (clients.error) throw new Error("Não foi possível conferir os clientes.");
  const leadIds = (clients.data ?? []).flatMap(c => c.lead_id ? [c.lead_id] : []);
  const leads = leadIds.length ? await db.from("leads").select("id,whatsapp").in("id", leadIds) : { data: [], error: null };
  if (leads.error) throw new Error("Não foi possível conferir os cards vinculados.");
  const number = msg.data.phone as string;
  const matches = (clients.data ?? []).filter(c => [c.whatsapp, c.phone, (leads.data ?? []).find(l => l.id === c.lead_id)?.whatsapp ?? ""].some(n => n && number && sameWhatsAppNumber(n, number)));
  return { message: msg.data, matches };
}

export async function messageTaskContext(messageId: string) {
  const db = await requireClientsSession();
  const { message, matches } = await resolve(db, messageId);
  const existing = matches.length === 1 ? await db.from("crm_client_tasks").select("id,title").eq("client_id", matches[0].id).eq("source_message_id", messageId).is("deleted_at", null) : { data: [] };
  return {
    status: matches.length === 1 ? "ok" as const : matches.length === 0 ? "no_client" as const : "ambiguous" as const,
    client: matches.length === 1 ? { id: matches[0].id, name: matches[0].trade_name || matches[0].contact_name } : null,
    body: message.body as string, sentAt: message.sent_at as string,
    existing: (existing.data ?? []) as { id: string; title: string }[],
  };
}

export async function createTaskFromMessage(input: { messageId: string; title: string; dueDate: string | null; responsible: string }) {
  const db = await requireClientsSession();
  const { message, matches } = await resolve(db, input.messageId);
  if (matches.length !== 1) throw new Error(matches.length ? "Este WhatsApp está em mais de um cliente; revise os cadastros." : "Este contato não é um cliente cadastrado.");
  const quote = String(message.body ?? "").slice(0, 1000);
  const norm = input.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  const { data, error } = await db.rpc("create_crm_client_message_task", {
    p_actor: CLIENTS_ACTOR, p_client: matches[0].id, p_title: input.title, p_description: `Criada a partir de mensagem do WhatsApp (${new Date(message.sent_at as string).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}).`,
    p_responsible: input.responsible, p_due: input.dueDate, p_source_message: input.messageId, p_quote: quote, p_dedupe: `msg:${input.messageId}:${norm}`.slice(0, 400),
  } as any);
  if (error) throw new Error("Não foi possível criar a tarefa.");
  const r = data as { id: string; created: boolean };
  return { ...r, clientId: matches[0].id };
}

/** Cliente único cujo WhatsApp corresponde ao contato da conversa; nunca adivinha em caso de ambiguidade. */
export async function clientForConversation(phone: string) {
  const db = await requireClientsSession();
  const clients = await db.from("crm_clients").select("id,trade_name,contact_name,whatsapp,phone,lead_id").limit(2001);
  if (clients.error) throw new Error("Não foi possível conferir os clientes.");
  const leadIds = (clients.data ?? []).flatMap(c => c.lead_id ? [c.lead_id] : []);
  const leads = leadIds.length ? await db.from("leads").select("id,whatsapp").in("id", leadIds) : { data: [], error: null };
  if (leads.error) throw new Error("Não foi possível conferir os cards vinculados.");
  const matches = (clients.data ?? []).filter(c => [c.whatsapp, c.phone, (leads.data ?? []).find(l => l.id === c.lead_id)?.whatsapp ?? ""].some(n => n && sameWhatsAppNumber(n, phone)));
  return {
    status: matches.length === 1 ? "ok" as const : matches.length === 0 ? "no_client" as const : "ambiguous" as const,
    client: matches.length === 1 ? { id: matches[0].id, name: (matches[0].trade_name || matches[0].contact_name) as string } : null,
  };
}
