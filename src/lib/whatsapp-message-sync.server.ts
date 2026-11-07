import type { AcceptedMessage } from "./whatsapp-message-sync";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Internal only: callers authorize the webhook or full CRM cookie before using this helper. */
export async function saveAcceptedMessage(message: AcceptedMessage): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("save_gravon_accepted_message", {
    p_message_id: message.messageId, p_instance: message.instance,
    p_remote_jid: message.remoteJid, p_phone_key: message.phoneKey,
    p_body: message.body, p_accepted_at: message.acceptedAt,
  });
  if (error || data !== true) throw new Error("Falha ao sincronizar a mensagem aceita; nenhum reenvio foi realizado.");
}

/** Recovery repeats the database write, never the provider send. */
export async function recoverAcceptedMessages(): Promise<void> {
  const { data, error } = await supabaseAdmin.from("gravon_ai_test_log")
    .select("id,outbound_id,instance,remote_jid,body,accepted_at")
    .eq("event", "reply").eq("status", "sync_error").limit(30);
  if (error) throw new Error("Não foi possível consultar as sincronizações pendentes.");
  const { phoneKey } = await import("./phone");
  for (const row of data ?? []) {
    if (!row.outbound_id || !row.instance || !row.remote_jid || !row.accepted_at) continue;
    try {
      await saveAcceptedMessage({ messageId: row.outbound_id, instance: row.instance,
        remoteJid: row.remote_jid, phoneKey: phoneKey(row.remote_jid), body: row.body, acceptedAt: row.accepted_at });
      const { error: updateError } = await supabaseAdmin.from("gravon_ai_test_log")
        .update({ status: "accepted", detail: "Sincronização recuperada, sem reenvio. Entrega não confirmada." })
        .eq("id", row.id).eq("status", "sync_error");
      if (updateError) throw new Error("Registro não atualizado.");
    } catch { console.error("Gravon sync recovery failed; no provider send attempted."); }
  }
}