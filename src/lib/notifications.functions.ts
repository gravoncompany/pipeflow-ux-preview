// Central de Notificações — funções do servidor chamadas pela tela de Configurações.
// Todas exigem sessão completa do CRM; nada aqui é público.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCrmLeadSession } from "./crm-leads.server";
import { b2bDb } from "./b2b-prospecting.server";
import { defaultPrefs, isNotificationChannel, isNotificationEvent } from "./notifications";
import { vapidPublicKey } from "./web-push.server";

async function db() {
  await requireCrmLeadSession(process.env.CRM_SESSION_SECRET);
  return b2bDb();
}

/** Chave pública push para o navegador ativar as notificações. */
export const getPushConfig = createServerFn({ method: "GET" }).handler(async () => {
  await db();
  try {
    return { ok: true as const, publicKey: vapidPublicKey() };
  } catch {
    return { ok: false as const, publicKey: "" };
  }
});

export const subscribePush = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({
    endpoint: z.string().url().max(2000),
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(10).max(100),
    userAgent: z.string().max(300).default(""),
  }).strict().parse(i))
  .handler(async ({ data }) => {
    const d = await db();
    const r = await d.from("crm_push_subscriptions").upsert(
      { endpoint: data.endpoint, p256dh: data.p256dh, auth: data.auth, user_agent: data.userAgent, disabled_at: null },
      { onConflict: "endpoint" },
    );
    if (r.error) return { ok: false as const, error: "Não foi possível ativar as notificações neste dispositivo." };
    return { ok: true as const, error: null };
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ endpoint: z.string().url().max(2000) }).strict().parse(i))
  .handler(async ({ data }) => {
    const d = await db();
    await d.from("crm_push_subscriptions").delete().eq("endpoint", data.endpoint);
    return { ok: true as const };
  });

export const getNotificationCenter = createServerFn({ method: "GET" }).handler(async () => {
  const d = await db();
  const [prefs, settings, subs, log] = await Promise.all([
    d.from("crm_notification_prefs").select("event,channel,enabled"),
    d.from("crm_notification_settings").select("email_target,whatsapp_target").eq("id", true).maybeSingle(),
    d.from("crm_push_subscriptions").select("endpoint,user_agent,created_at").is("disabled_at", null).order("created_at", { ascending: false }).limit(20),
    d.from("crm_notification_log").select("id,event,channel,title,status,error,created_at,sent_at").order("created_at", { ascending: false }).limit(30),
  ]);
  return {
    prefs: defaultPrefs(prefs.data ?? []),
    emailTarget: settings.data?.email_target ?? "",
    whatsappTarget: settings.data?.whatsapp_target ?? "",
    devices: (subs.data ?? []).map((s) => ({ endpoint: s.endpoint, userAgent: s.user_agent, createdAt: s.created_at })),
    log: log.data ?? [],
  };
});

export const setNotificationPref = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ event: z.string().max(60), channel: z.string().max(20), enabled: z.boolean() }).strict().parse(i))
  .handler(async ({ data }) => {
    if (!isNotificationEvent(data.event) || !isNotificationChannel(data.channel)) return { ok: false as const, error: "Evento ou canal desconhecido." };
    const d = await db();
    const r = await d.from("crm_notification_prefs").upsert(
      { event: data.event, channel: data.channel, enabled: data.enabled, updated_at: new Date().toISOString() },
      { onConflict: "event,channel" },
    );
    if (r.error) return { ok: false as const, error: "Não foi possível salvar a preferência." };
    return { ok: true as const, error: null };
  });

export const setNotificationTargets = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(254)]),
    whatsapp: z.string().trim().max(30).regex(/^[\d\s()+.-]*$/, "Use apenas números e símbolos de telefone."),
  }).strict().parse(i))
  .handler(async ({ data }) => {
    const d = await db();
    const r = await d.from("crm_notification_settings").upsert(
      { id: true, email_target: data.email, whatsapp_target: data.whatsapp, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    if (r.error) return { ok: false as const, error: "Não foi possível salvar os destinatários." };
    return { ok: true as const, error: null };
  });
