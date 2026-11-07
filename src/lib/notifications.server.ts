// Central de Notificações — envio pelos canais ligados (push, e-mail, WhatsApp).
// Nunca lança erro para quem chamou: falhas ficam registradas no histórico de notificações.
// Cada envio é reservado antes (claim_crm_notification), então a mesma notificação nunca sai duas vezes.

import type { b2bDb } from "./b2b-prospecting.server";
import {
  automationNotification, automationReplyEventKey, cleanSnippet, enabledChannels, replyEventKey, replyNotification,
  type NotificationChannel, type NotificationEvent, type NotificationMessage,
} from "./notifications";
import { sendWebPush } from "./web-push.server";

type Db = Awaited<ReturnType<typeof b2bDb>>;

type PrefsRow = { event: string; channel: string; enabled: boolean };

async function loadPrefs(db: Db, event: NotificationEvent): Promise<NotificationChannel[]> {
  const r = await db.from("crm_notification_prefs").select("event,channel,enabled").eq("event", event).eq("enabled", true);
  if (r.error) return [];
  return enabledChannels(
    (r.data as PrefsRow[]).map((p) => ({ event: event, channel: p.channel as NotificationChannel, enabled: p.enabled })),
    event,
  );
}

async function loadTargets(db: Db): Promise<{ email: string; whatsapp: string }> {
  const r = await db.from("crm_notification_settings").select("email_target,whatsapp_target").eq("id", true).maybeSingle();
  return { email: r.data?.email_target ?? "", whatsapp: r.data?.whatsapp_target ?? "" };
}

async function sendPushChannel(db: Db, message: NotificationMessage): Promise<void> {
  const subs = await db.from("crm_push_subscriptions").select("endpoint,p256dh,auth").is("disabled_at", null).limit(50);
  if (subs.error) throw new Error("Inscrições push indisponíveis.");
  const list = subs.data ?? [];
  if (!list.length) throw new Error("Nenhum dispositivo com notificações ativadas.");
  let delivered = 0;
  const errors: string[] = [];
  for (const s of list) {
    try {
      const res = await sendWebPush(s.endpoint, { p256dh: s.p256dh, auth: s.auth }, { ...message, tag: message.url });
      if (res.ok) {
        delivered++;
        await db.from("crm_push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
      } else if (res.gone) {
        await db.from("crm_push_subscriptions").update({ disabled_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
      } else {
        errors.push(`push respondeu ${res.status}`);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "falha no push");
    }
  }
  if (!delivered) throw new Error(errors[0] ? `Push não entregue: ${errors[0]}` : "Push não entregue.");
}

async function sendEmailChannel(db: Db, target: string, message: NotificationMessage): Promise<void> {
  if (!target) throw new Error("E-mail de aviso não configurado na Central de Notificações.");
  const { loadEmailSettings } = await import("./email-campaigns.server");
  const { brevoSend } = await import("./brevo.server");
  const settings = await loadEmailSettings(db);
  const res = await brevoSend(settings, {
    to: target,
    toName: "",
    subject: message.title,
    html: `<p>${cleanSnippet(message.body, 400)}</p><p><a href="${message.url}">Abrir no Pipeflow</a></p>`,
    text: `${message.body}\n\nAbrir no Pipeflow: ${message.url}`,
    scheduledAt: null,
    batchId: "",
    tag: "crm-notificacao",
  });
  if (res.state !== "accepted") throw new Error(`E-mail de aviso recusado (${res.state}).`);
}

async function sendWhatsAppChannel(target: string, message: NotificationMessage): Promise<void> {
  if (!target) throw new Error("Número de WhatsApp para avisos não configurado na Central de Notificações.");
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!apiKey) throw new Error("Evolution API não configurada.");
  const { EVOLUTION_BASE_URL } = await import("./evolution.functions");
  const inst = await fetch(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, { headers: { apikey: apiKey } });
  const list = (await inst.json().catch(() => [])) as Record<string, unknown>[];
  const open = (Array.isArray(list) ? list : []).find((i) => (i.connectionStatus ?? (i.instance as Record<string, unknown> | undefined)?.status) === "open") ?? list?.[0];
  const name = (open?.name ?? (open?.instance as Record<string, unknown> | undefined)?.instanceName) as string | undefined;
  if (!name) throw new Error("Nenhuma instância do WhatsApp conectada.");
  const { evolutionSendText } = await import("./evolution-text.server");
  const digits = target.replace(/\D/g, "");
  const res = await evolutionSendText(apiKey, name, digits, `🔔 ${message.title}\n${message.body}\n\nAbrir no Pipeflow: ${message.url}`);
  if (!res.ok) throw new Error(`WhatsApp recusou o aviso (${res.status}).`);
}

/**
 * Envia uma notificação pelos canais ligados para o evento. Reserva cada envio antes
 * (deduplicação por eventKey + canal) e registra o resultado. Nunca lança erro.
 */
export async function dispatchNotification(
  db: Db,
  input: { event: NotificationEvent; eventKey: string; message: NotificationMessage; channel?: NotificationChannel },
): Promise<void> {
  const channels = input.channel ? [input.channel] : await loadPrefs(db, input.event);
  if (!channels.length) return;
  const targets = await loadTargets(db);
  for (const channel of channels) {
    let claim: string | null = null;
    try {
      const c = await db.rpc("claim_crm_notification", {
        p_event_key: input.eventKey, p_event: input.event, p_channel: channel,
        p_title: input.message.title, p_body: input.message.body, p_url: input.message.url,
      });
      claim = (c.data as string | null) ?? null;
      if (!claim) continue; // já enviada ou em andamento
      if (channel === "push") await sendPushChannel(db, input.message);
      else if (channel === "email") await sendEmailChannel(db, targets.email, input.message);
      else await sendWhatsAppChannel(targets.whatsapp, input.message);
      await db.rpc("finish_crm_notification", { p_id: claim, p_status: "sent", p_error: "" });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : "Falha no envio.").slice(0, 300);
      if (claim) await db.rpc("finish_crm_notification", { p_id: claim, p_status: "failed", p_error: msg });
    }
  }
}

/** Atalho para o evento "resposta de e-mail da prospecção". */
export async function notifyEmailReply(
  db: Db,
  input: { gmailMessageId: string; contact: string; company: string; subject: string; leadId: string | null },
): Promise<void> {
  await dispatchNotification(db, {
    event: "email_reply",
    eventKey: replyEventKey(input.gmailMessageId),
    message: replyNotification(input),
  });
}

/**
 * Aviso personalizado do bloco "Enviar notificação" da automação (caminho "Sim" de "Respondeu?").
 * É uma escolha explícita do desenho: sai no canal configurado no bloco, mesmo com a preferência geral desligada.
 */
export async function notifyAutomationReply(
  db: Db,
  input: { gmailMessageId: string; contact: string; company: string; flowId: string | null },
): Promise<void> {
  if (!input.flowId) return;
  const a = await db.from("crm_automations").select("compiled").eq("flow_id", input.flowId).in("state", ["test", "active"]).limit(1).maybeSingle();
  const notify = (a.data?.compiled as { onReplyNotify?: { channel: NotificationChannel; message: string } | null } | null)?.onReplyNotify;
  if (!notify?.message?.trim()) return;
  await dispatchNotification(db, {
    event: "email_reply",
    eventKey: automationReplyEventKey(input.gmailMessageId),
    channel: notify.channel,
    message: {
      title: "Automação — resposta recebida",
      body: automationNotification(notify.message, { contact: input.contact, company: input.company }),
      url: "/automacoes",
    },
  });
}
