// Central de Notificações — regras puras (sem banco nem rede).
// Catálogo de eventos/canais, preferências padrão (tudo desligado), montagem das
// mensagens e chaves de deduplicação. Nenhuma notificação sai sem preferência ligada.

export const NOTIFICATION_CHANNELS = ["push", "email", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const NOTIFICATION_CHANNEL_LABEL: Record<NotificationChannel, string> = {
  push: "Notificação no aplicativo (push)",
  email: "E-mail",
  whatsapp: "WhatsApp",
};

export const NOTIFICATION_EVENTS = ["email_reply", "diagnosis_received"] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const NOTIFICATION_EVENT_LABEL: Record<NotificationEvent, string> = {
  email_reply: "Resposta de e-mail da prospecção",
  diagnosis_received: "Formulário de diagnóstico recebido",
};

export type NotificationPref = { event: NotificationEvent; channel: NotificationChannel; enabled: boolean };

/** Grade completa de preferências; padrão é tudo desligado. */
export function defaultPrefs(saved: readonly { event: string; channel: string; enabled: boolean }[] = []): NotificationPref[] {
  const on = new Set(saved.filter((p) => p.enabled).map((p) => `${p.event}:${p.channel}`));
  const out: NotificationPref[] = [];
  for (const event of NOTIFICATION_EVENTS)
    for (const channel of NOTIFICATION_CHANNELS)
      out.push({ event, channel, enabled: on.has(`${event}:${channel}`) });
  return out;
}

/** Canais ligados para um evento, na ordem push → e-mail → WhatsApp. */
export function enabledChannels(prefs: readonly NotificationPref[], event: NotificationEvent): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((c) => prefs.some((p) => p.event === event && p.channel === c && p.enabled));
}

export type NotificationMessage = { title: string; body: string; url: string };

/** Texto curto e seguro: sem quebras de linha, sem HTML, tamanho limitado. */
export function cleanSnippet(value: string, max = 180): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Notificação de resposta de e-mail da prospecção; tocar abre o card do contato. */
export function replyNotification(input: { contact: string; company: string; subject: string; leadId: string | null }): NotificationMessage {
  const who = cleanSnippet(input.company || input.contact, 60) || "Contato";
  return {
    title: `Resposta de e-mail — ${who}`,
    body: cleanSnippet(input.subject ? `Assunto: ${input.subject}` : `Resposta de ${input.contact}`, 180),
    url: input.leadId ? `/?lead=${encodeURIComponent(input.leadId)}` : "/conversas",
  };
}

/** Chave de deduplicação: uma notificação por mensagem do Gmail por canal. */
export function replyEventKey(gmailMessageId: string): string {
  return `email-reply:${gmailMessageId.slice(0, 200)}`;
}

/** Chave para a notificação personalizada do bloco "Enviar notificação" da automação. */
export function automationReplyEventKey(gmailMessageId: string): string {
  return `auto-reply-notify:${gmailMessageId.slice(0, 200)}`;
}

/** Mensagem personalizada do construtor de automações (variáveis simples do contato). */
export function automationNotification(template: string, v: { contact: string; company: string }): string {
  const filled = template
    .replace(/\{\{\s*nome\s*\}\}/gi, v.contact)
    .replace(/\{\{\s*empresa\s*\}\}/gi, v.company);
  return cleanSnippet(filled, 300) || "Resposta recebida na automação.";
}

export const isNotificationChannel = (v: unknown): v is NotificationChannel =>
  typeof v === "string" && (NOTIFICATION_CHANNELS as readonly string[]).includes(v);
export const isNotificationEvent = (v: unknown): v is NotificationEvent =>
  typeof v === "string" && (NOTIFICATION_EVENTS as readonly string[]).includes(v);
