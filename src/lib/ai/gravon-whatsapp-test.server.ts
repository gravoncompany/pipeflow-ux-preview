import { EVOLUTION_BASE_URL } from "../evolution.functions";
import { generateWhatsAppTestReply } from "./gravon-whatsapp.server";
import { processTestRows, type TestIncoming } from "../gravon-test-processing.server";
import { saveAcceptedMessage } from "../whatsapp-message-sync.server";
import { resolveDatabaseMove } from "../gravon-crm-actions.server";

export async function processSelfTestMessages(rows: TestIncoming[]): Promise<void> {
  if (!rows.some((r) => r.from_me && r.body)) return;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!evolutionKey || !openaiKey) {
    console.error("Gravon test provider configuration missing; no send attempted.");
    return;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await processTestRows(rows, {
    isOwnEcho: async row => {
      const { data, error } = await supabaseAdmin.rpc("claim_gravon_reserved_echo", { p_instance: row.instance, p_jid: row.remote_jid, p_id: row.message_id, p_body: row.body });
      if (error) throw new Error("Não foi possível verificar eco; resposta bloqueada.");
      return data === true;
    },
    reserve: async (row, body) => {
      const { error } = await supabaseAdmin.from("gravon_outbound_reservations").insert({ inbound_id: row.message_id, instance: row.instance, remote_jid: row.remote_jid, body });
      if (error?.code === "23505") return false;
      if (error) throw new Error("Falha ao reservar envio; nenhum envio realizado.");
      return true;
    },
    outcome: async (row, state, providerId) => {
      const { error } = await supabaseAdmin.from("gravon_outbound_reservations").update({ state, provider_id: providerId ?? null }).eq("inbound_id", row.message_id);
      if (error) throw new Error("Falha ao registrar resultado; não reenviar.");
    },
    settings: async () => {
      const { data, error } = await supabaseAdmin
        .from("gravon_ai_test_settings")
        .select(
          "enabled,authorized_phone,crm_read_enabled,crm_read_instance,crm_read_phone,crm_read_revision,crm_move_enabled,crm_move_instance,crm_move_phone,crm_move_revision,crm_move_authorized_phone,crm_finance_enabled,crm_finance_instance,crm_finance_phone,crm_finance_revision,crm_finance_read_revision,crm_finance_authorized_phone,crm_knowledge_enabled,crm_knowledge_read_revision",
        )
        .eq("id", 1)
        .maybeSingle();
      if (error) throw new Error("Não foi possível verificar a autorização de teste.");
      return data;
    },
    instances: async () => {
      const response = await fetch(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, {
        headers: { apikey: evolutionKey },
      });
      if (!response.ok) throw new Error("Não foi possível verificar a instância de teste.");
      return response.json();
    },
    claim: async (row) => {
      // Preserve the old deduplication guard without rewriting old logs.
      const { data: old, error: readError } = await supabaseAdmin
        .from("gravon_ai_test_log")
        .select("id")
        .eq("event", "inbound")
        .eq("detail", row.message_id)
        .limit(1);
      if (readError) throw new Error("Falha ao verificar repetição da mensagem.");
      if (old?.length) return false;
      const { error } = await supabaseAdmin.from("gravon_ai_test_log").insert({
        event: "inbound",
        status: "received",
        detail: row.message_id,
        inbound_id: row.message_id,
        instance: row.instance,
        remote_jid: row.remote_jid,
        phone: row.phone,
        body: row.body.slice(0, 2000),
      });
      if (error?.code === "23505") return false;
      if (error) throw new Error("Falha ao registrar a solicitação; envio interrompido.");
      return true;
    },
    record: async (entry) => {
      const { error } = await supabaseAdmin.from("gravon_ai_test_log").insert(entry);
      if (error) throw new Error("Falha ao registrar o estado do teste.");
    },
    generate: (body, context) => generateWhatsAppTestReply(openaiKey, body, context),
    resolveMove: resolveDatabaseMove,
    send: (instance, number, text) =>
      fetch(`${EVOLUTION_BASE_URL}/message/sendText/${encodeURIComponent(instance)}`, {
        method: "POST",
        headers: { apikey: evolutionKey, "Content-Type": "application/json" },
        body: JSON.stringify({ number, text }),
      }),
    save: saveAcceptedMessage,
    knowledge: async () => {
      const { data, error } = await supabaseAdmin
        .from("ai_knowledge")
        .select("kind,text,generation,created_at")
        .eq("company_key", "crm:1")
        .eq("entry_type", "generated")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error("Base de conhecimento indisponível.");
      const rows = data ?? [];
      const latest = rows[0]?.generation ?? 0;
      return {
        generatedAt: rows[0]?.created_at ?? null,
        insights: rows
          .filter((r) => r.generation === latest)
          .map((r) => ({ tipo: r.kind, aprendizado: r.text })),
      };
    },
  });
}
