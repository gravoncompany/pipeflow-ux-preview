import { createFileRoute } from "@tanstack/react-router";
import { phoneKey } from "@/lib/phone";
import { explicitDeliveryUpdate } from "@/lib/whatsapp-message-sync";

type Msg = Record<string, any>;

function textOf(m: Msg): string {
  const msg = m.message ?? {};
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    (msg.imageMessage ? "[Imagem]" : msg.audioMessage ? "[Áudio]" : msg.videoMessage ? "[Vídeo]" : msg.documentMessage ? "[Documento]" : msg.stickerMessage ? "[Figurinha]" : "")
  );
}

function mediaOf(m: Msg): string {
  const msg = m.message ?? {};
  if (msg.imageMessage) return "image";
  if (msg.audioMessage) return "audio";
  if (msg.videoMessage) return "video";
  if (msg.stickerMessage) return "sticker";
  if (msg.documentMessage) return "document";
  return "";
}

export const Route = createFileRoute("/api/public/evolution/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.EVOLUTION_WEBHOOK_TOKEN;
        const url = new URL(request.url);
        if (!token || url.searchParams.get("token") !== token) return new Response("Unauthorized", { status: 401 });

        let payload: Msg;
        try { payload = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
        const event = String(payload.event ?? "").toLowerCase().replace(/_/g, ".");
        if (event === "call") {
          const instance = typeof payload.instance === "string" && payload.instance.length <= 160 ? payload.instance : "";
          if (!instance) return new Response("Invalid instance", { status: 400 });
          const list = Array.isArray(payload.data) ? payload.data : [payload.data];
          if (list.length > 100) return new Response("Too many calls", { status: 400 });
          try {
            const { processEvolutionCalls } = await import("@/lib/whatsapp-calls.server");
            await processEvolutionCalls(instance, list);
            return new Response("ok");
          } catch { console.error("call_webhook_processing_failed"); return new Response("Call persistence failed", { status: 500 }); }
        }
        if (event === "messages.update") {
          const instance = typeof payload.instance === "string" ? payload.instance : "";
          if (!instance) return new Response("ignored");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const updates = Array.isArray(payload.data) ? payload.data : [payload.data];
          for (const item of updates) {
            const delivery = explicitDeliveryUpdate(item);
            if (!delivery) continue;
            const now = new Date().toISOString();
            const status = String(item?.update?.status ?? item?.status ?? "");
            const { error: receiptError } = await supabaseAdmin.from("analysis_delivery_receipts").upsert({ instance, message_id: delivery.messageId, remote_jid: delivery.remoteJid, state: status, received_at: now }, { onConflict: "instance,message_id,remote_jid,state", ignoreDuplicates: true });
            if (receiptError) return new Response("db error", { status: 500 });
            const { error: reconcileError } = await supabaseAdmin.rpc("reconcile_analysis_delivery", { p_instance: instance, p_id: delivery.messageId });
            if (reconcileError) return new Response("db error", { status: 500 });
            const { data: matched, error } = await supabaseAdmin.from("whatsapp_messages")
              .update({ send_state: "delivered", delivered_at: now })
              .eq("message_id", delivery.messageId).eq("instance", instance)
              .eq("phone", delivery.remoteJid.split("@")[0]).eq("from_me", true)
              .is("delivered_at", null).select("message_id");
            if (error) return new Response("db error", { status: 500 });
            if (["READ", "PLAYED"].includes(status)) {
              const { error: readError } = await supabaseAdmin.from("whatsapp_messages")
                .update({ read_at: now }).eq("message_id", delivery.messageId).eq("instance", instance)
                .eq("phone", delivery.remoteJid.split("@")[0]).eq("from_me", true).is("read_at", null);
              if (readError) return new Response("db error", { status: 500 });
            }
            if (matched?.length) {
              const { error: logError } = await supabaseAdmin.from("gravon_ai_test_log")
                .update({ delivered_at: now }).eq("outbound_id", delivery.messageId)
                .eq("instance", instance).eq("remote_jid", delivery.remoteJid);
              if (logError) console.error("Gravon delivery log update failed.");
            }
          }
          return new Response("ok");
        }
        if (event !== "messages.upsert") return new Response("ignored");

        const list: Msg[] = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
        if (list.length > 100) return new Response("Too many messages", { status: 400 });
        try {
          const { protectFirstContactLid } = await import("@/lib/first-contact.server");
          for (const m of list) {
            const alt = await protectFirstContactLid(String(payload.instance ?? ""), m);
            // Corroborated aliases feed existing Conversations without invented numbers.
            if (alt && m.key) m.key = { ...m.key, remoteJid: alt };
          }
        } catch { console.error("first_contact_inbound_protection_failed"); return new Response("Inbound protection failed", { status: 503 }); }
        const rows = list
          .filter((m) => m.key?.id && m.key?.remoteJid && String(m.key.remoteJid).endsWith("@s.whatsapp.net"))
          .map((m) => {
            const jid = String(m.key.remoteJid);
            const ts = Number(m.messageTimestamp);
            return {
              message_id: String(m.key.id),
              instance: String(payload.instance ?? ""),
              phone: jid.split("@")[0],
              remote_jid: jid,
              phone_key: phoneKey(jid),
              from_me: Boolean(m.key.fromMe),
              push_name: m.key.fromMe ? "" : String(m.pushName ?? ""),
              body: textOf(m).slice(0, 10000),
              media_type: mediaOf(m),
              sent_at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
            };
          });
        if (!rows.length) return new Response("ok");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("whatsapp_messages").upsert(rows, { onConflict: "message_id", ignoreDuplicates: true });
        if (error) { console.error("whatsapp webhook insert", error); return new Response("db error", { status: 500 }); }
        try {
          const { processSelfTestMessages } = await import("@/lib/ai/gravon-whatsapp-test.server");
          await processSelfTestMessages(rows);
        } catch { console.error("Gravon self-test processing failed; no automatic retry initiated."); }
        // Campaign reference messages, then the per-funnel Commercial Agent. Both are isolated:
        // messages are already stored, so their failures never change the webhook response.
        const instance = String(payload.instance ?? "");
        try {
          const { captureReferenceMessages } = await import("@/lib/reference-messages.server");
          await captureReferenceMessages(instance, rows);
        } catch { console.error("reference_capture_failed"); }
        try {
          const { runCommercialAgent } = await import("@/lib/commercial-agent.server");
          await runCommercialAgent(request, instance, rows);
        } catch { console.error("commercial_agent_failed"); }
        return new Response("ok");
      },
    },
  },
});
