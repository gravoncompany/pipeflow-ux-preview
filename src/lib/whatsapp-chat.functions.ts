import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { phoneKey, phoneDigits } from "./phone";
import { EVOLUTION_BASE_URL } from "./evolution.functions";
import { chronologicalMessages } from "./whatsapp-message-sync";

export type ChatMessage = { id: string; fromMe: boolean; body: string; sentAt: string; pushName: string; phone: string; mediaType: string; sendState?: string | null; instance?: string };
/** inboundSinceReply: send times of the client's messages after the last reply (newest first, up to 99) for unread badges. */
export type Conversation = { phoneKey: string; phone: string; name: string; lastBody: string; lastAt: string; lastFromMe: boolean; count: number; leadId: string | null; leadName: string | null; inboundSinceReply: string[]; clientId: string | null; clientName: string | null };

async function requireFull() {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  return Boolean(secret && (await hasFullCrmSession(secret)));
}

const toMsg = (r: any): ChatMessage => ({ id: r.message_id, fromMe: r.from_me, body: r.body, sentAt: r.sent_at, pushName: r.push_name, phone: r.phone, mediaType: r.media_type ?? "", sendState: r.read_at ? "read" : r.delivered_at ? "delivered" : r.send_state, instance: r.instance });

export const getLeadMessages = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ phone: z.string().max(40), limit: z.number().int().min(500).max(10000).default(500) }).parse(i))
  .handler(async ({ data }) => {
    if (!(await requireFull())) return { needsAuth: true, messages: [] as ChatMessage[] };
    const key = phoneKey(data.phone);
    if (key.length < 8) return { needsAuth: false, messages: [] as ChatMessage[] };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin.from("whatsapp_messages").select("*").eq("phone_key", key);
    const { data: rows, error } = await query.order("sent_at", { ascending: false }).order("message_id", { ascending: false }).limit(data.limit);
    if (error) throw new Error("Não foi possível carregar a conversa.");
    return { needsAuth: false, messages: chronologicalMessages(rows ?? []).map(toMsg), hasMore: (rows?.length ?? 0) === data.limit && data.limit < 10000 };
  });

export const listConversations = createServerFn({ method: "POST" }).handler(async () => {
  if (!(await requireFull())) return { needsAuth: true, conversations: [] as Conversation[] };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: rows, error }, { data: leads }] = await Promise.all([
    supabaseAdmin.from("whatsapp_messages").select("*").order("sent_at", { ascending: false }).limit(2000),
    supabaseAdmin.from("leads").select("id,name,whatsapp"),
  ]);
  if (error) throw new Error("Não foi possível carregar as conversas.");
  const leadByKey = new Map<string, { id: string; name: string }>();
  for (const l of leads ?? []) { const k = phoneKey(l.whatsapp); if (k.length >= 8) leadByKey.set(k, { id: l.id, name: l.name }); }
  // Clientes cadastrados (menu Clientes): pelo card vinculado ou pelo WhatsApp do cadastro. Só leitura.
  const { data: clients } = await supabaseAdmin.from("crm_clients").select("id,lead_id,trade_name,whatsapp,phone").limit(2000);
  const clientByLead = new Map<string, { id: string; name: string }>();
  const clientByKey = new Map<string, { id: string; name: string }>();
  for (const c of clients ?? []) {
    const v = { id: c.id, name: c.trade_name };
    if (c.lead_id) clientByLead.set(c.lead_id, v);
    for (const raw of [c.whatsapp, c.phone]) { const k = phoneKey(raw ?? ""); if (k.length >= 10 && !clientByKey.has(k)) clientByKey.set(k, v); }
  }
  const map = new Map<string, Conversation>();
  const replied = new Set<string>();
  for (const r of rows ?? []) {
    let c = map.get(r.phone_key);
    if (!c) {
      const lead = leadByKey.get(r.phone_key) ?? null;
      c = { phoneKey: r.phone_key, phone: r.phone, name: "", lastBody: r.body, lastAt: r.sent_at, lastFromMe: Boolean(r.from_me), count: 0, leadId: lead?.id ?? null, leadName: lead?.name ?? null, inboundSinceReply: [], clientId: null, clientName: null };
      const client = (lead ? clientByLead.get(lead.id) : undefined) ?? clientByKey.get(r.phone_key) ?? null;
      if (client) { c.clientId = client.id; c.clientName = client.name; }
      map.set(r.phone_key, c);
    }
    c.count++;
    if (r.from_me) replied.add(r.phone_key);
    else if (!replied.has(r.phone_key) && c.inboundSinceReply.length < 99) c.inboundSinceReply.push(r.sent_at);
    if (!c.name && r.push_name) c.name = r.push_name;
  }
  return { needsAuth: false, conversations: [...map.values()] };
});

export const sendWhatsApp = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ phone: z.string().min(8).max(40), text: z.string().trim().min(1).max(4000) }).parse(i))
  .handler(async ({ data }) => {
    if (!(await requireFull())) return { ok: false, error: "Entre com a senha de acesso completo." };
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!apiKey) return { ok: false, error: "Chave da Evolution API não configurada." };
    const inst = await fetch(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, { headers: { apikey: apiKey } });
    const list = (await inst.json().catch(() => [])) as any[];
    const open = (Array.isArray(list) ? list : []).find((i) => (i.connectionStatus ?? i.instance?.status) === "open") ?? list?.[0];
    const name = open?.name ?? open?.instance?.instanceName;
    if (!name) return { ok: false, error: "Nenhuma instância do WhatsApp conectada." };
    const number = phoneDigits(data.phone);
    const { evolutionSendText } = await import("./evolution-text.server");
    const res = await evolutionSendText(apiKey, name, number, data.text);
    const body = await res.text();
    if (!res.ok) { console.error(`Evolution send [${res.status}]: ${body}`); return { ok: false, error: `Falha ao enviar (${res.status}): ${body.slice(0, 200)}` }; }
    // Save immediately; the webhook echo is de-duplicated by message_id.
    try {
      const j = JSON.parse(body);
      const id = j?.key?.id;
      if (id) {
        const jid = String(j.key.remoteJid ?? number);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("whatsapp_messages").upsert({ message_id: id, instance: name, phone: jid.split("@")[0], phone_key: phoneKey(jid), from_me: true, body: data.text, sent_at: new Date().toISOString() }, { onConflict: "message_id", ignoreDuplicates: true });
      }
    } catch { /* echo from webhook will store it */ }
    return { ok: true, error: null };
  });

export const setupEvolutionWebhook = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ origin: z.string().url() }).parse(i))
  .handler(async ({ data }) => {
    if (!(await requireFull())) return { ok: false, error: "Entre com a senha de acesso completo." };
    const apiKey = process.env.EVOLUTION_API_KEY;
    const token = process.env.EVOLUTION_WEBHOOK_TOKEN;
    if (!apiKey || !token) return { ok: false, error: "Configuração incompleta." };
    const inst = await fetch(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, { headers: { apikey: apiKey } });
    const list = (await inst.json().catch(() => [])) as any[];
    const names = (Array.isArray(list) ? list : []).map((i) => i.name ?? i.instance?.instanceName).filter(Boolean);
    if (!names.length) return { ok: false, error: "Nenhuma instância encontrada." };
    const url = `${data.origin}/api/public/evolution/webhook?token=${token}`;
    for (const name of names) {
      const currentResponse = await fetch(`${EVOLUTION_BASE_URL}/webhook/find/${encodeURIComponent(name)}`, { headers: { apikey: apiKey }, redirect: "manual", signal: AbortSignal.timeout(10000) });
      if (!currentResponse.ok) return { ok: false, error: "Não foi possível conferir o webhook existente; nenhuma configuração foi substituída." };
      const raw = await currentResponse.json();
      const current = raw?.webhook ?? raw;
      const events = [...new Set([...(Array.isArray(current?.events) ? current.events : []), "MESSAGES_UPSERT", "CALL"])];
      const res = await fetch(`${EVOLUTION_BASE_URL}/webhook/set/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        redirect: "manual", signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ webhook: { enabled: true, url: current?.enabled && current?.url ? current.url : url, byEvents: current?.webhookByEvents ?? current?.byEvents ?? false, base64: current?.webhookBase64 ?? current?.base64 ?? false, ...(current?.headers ? { headers: current.headers } : {}), events } }),
      });
      if (!res.ok) { console.error("webhook/set failed", { status: res.status }); return { ok: false, error: `Não foi possível configurar os eventos (${res.status}).` }; }
    }
    return { ok: true, error: null };
  });

export const getWhatsAppMedia = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ messageId: z.string().min(1).max(200) }).parse(i))
  .handler(async ({ data }) => {
    if (!(await requireFull())) return { ok: false, error: "Sem acesso.", dataUrl: null as string | null };
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!apiKey) return { ok: false, error: "Chave não configurada.", dataUrl: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("whatsapp_messages").select("message_id,instance,phone,from_me").eq("message_id", data.messageId).maybeSingle();
    if (!row || !row.instance) return { ok: false, error: "Mídia não encontrada.", dataUrl: null };
    const res = await fetch(`${EVOLUTION_BASE_URL}/chat/getBase64FromMediaMessage/${encodeURIComponent(row.instance)}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { key: { id: row.message_id, remoteJid: `${row.phone}@s.whatsapp.net`, fromMe: row.from_me } }, convertToMp4: false }),
    });
    const body = await res.text();
    if (!res.ok) { console.error(`getBase64 [${res.status}]: ${body.slice(0, 300)}`); return { ok: false, error: `Não foi possível baixar a mídia (${res.status}).`, dataUrl: null }; }
    try {
      const j = JSON.parse(body);
      if (!j.base64) return { ok: false, error: "Mídia indisponível.", dataUrl: null };
      const mime = String(j.mimetype || "application/octet-stream").split(";")[0];
      return { ok: true, error: null, dataUrl: `data:${mime};base64,${j.base64}` };
    } catch { return { ok: false, error: "Resposta inválida.", dataUrl: null }; }
  });
