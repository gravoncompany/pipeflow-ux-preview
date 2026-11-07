import { z } from "zod";

/** Fluxos de E-mail: tipos e regras puras (sem banco, sem rede). */
export const FLOW_MAX_STEPS = 10;
/** Teto diário de envios automáticos dos fluxos, abaixo do limite do plano gratuito da Brevo (300/dia), somando campanhas. */
export const FLOW_DAILY_LIMIT = 250;
/** Envios por execução do agendador (a cada 10 minutos). */
export const FLOW_BATCH_PER_RUN = 10;
/** Sugestões de resposta geradas pela IA por execução. */
export const FLOW_SUGGESTIONS_PER_RUN = 5;

export const flowStep = z.object({
  day: z.number().int().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  /** Campos opcionais usados pelas Automações (horas além do dia, IA por etapa, botão e assinatura). */
  hours: z.number().int().min(0).max(23).optional(),
  ai: z.boolean().optional(),
  cta: z.string().max(60).optional(),
  signature: z.boolean().optional(),
}).strict();
export type FlowStep = z.infer<typeof flowStep>;
/** Momento da etapa em horas a partir da entrada no fluxo (mesma regra do banco). */
export const stepOffsetHours = (s: Pick<FlowStep, "day" | "hours">) => (Math.max(s.day, 1) - 1) * 24 + (s.hours ?? 0);

export const flowInput = z.object({
  id: z.string().uuid().nullable(),
  revision: z.number().int().min(0),
  name: z.string().trim().min(2).max(150),
  steps: z.array(flowStep).min(1).max(FLOW_MAX_STEPS)
    .refine((s) => s.every((x, i) => i === 0 || stepOffsetHours(x) > stepOffsetHours(s[i - 1])), "Os dias das etapas precisam ser crescentes."),
  aiEnabled: z.boolean(),
  approveAi: z.boolean(),
}).strict();
export type FlowInput = z.infer<typeof flowInput>;

export type FlowState = "draft" | "active" | "paused" | "archived";
export type EnrollmentStatus = "active" | "awaiting_reply" | "in_conversation" | "paused" | "finished" | "stopped";

export type EmailFlow = {
  id: string; name: string; steps: FlowStep[]; ai_enabled: boolean; ai_approved_revision: number | null;
  ai_approved_at: string | null; state: FlowState; revision: number; created_at: string; updated_at: string;
  send_days: number[]; send_start: string; send_end: string; max_messages: number;
  /** Preenchido quando o fluxo é gerado por uma Automação (editar só pela Central de Automações). */
  automation_id?: string | null;
};

export const FLOW_STATE_LABEL: Record<FlowState, string> = { draft: "Rascunho", active: "Ativo", paused: "Pausado", archived: "Arquivado" };
export const ENROLLMENT_LABEL: Record<EnrollmentStatus, string> = {
  active: "Em sequência",
  awaiting_reply: "Aguardando resposta personalizada",
  in_conversation: "Em conversa (humano)",
  paused: "Pausado",
  finished: "Sequência concluída",
  stopped: "Encerrado",
};

export function aiApproved(f: Pick<EmailFlow, "ai_enabled" | "ai_approved_revision" | "revision">) {
  return f.ai_enabled && f.ai_approved_revision === f.revision;
}

export const DEFAULT_FLOW_STEPS: FlowStep[] = [
  { day: 1, subject: "{{empresa}}: uma ideia para organizar seus atendimentos", body: "Olá, {{nome}}!\n\nSou da Gravon Company. Ajudamos empresas como a {{empresa}} a organizar contatos, propostas e retornos em um CRM personalizado com IA.\n\nPosso te mostrar em uma demonstração de 15 minutos?" },
  { day: 3, subject: "Re: {{empresa}}", body: "Olá, {{nome}}! Passando para saber se faz sentido conversarmos 15 minutos sobre o CRM com IA da Gravon." },
  { day: 7, subject: "Ainda faz sentido, {{nome}}?", body: "Olá, {{nome}}! Sei que a rotina é corrida. Se preferir, me diga o melhor horário e eu me adapto." },
  { day: 12, subject: "Última tentativa", body: "Olá, {{nome}}! Esta é minha última mensagem por aqui. Se um dia quiser conhecer o CRM com IA da Gravon, é só responder este e-mail." },
];

/* ------------------------------ Respostas (Gmail) ------------------------------ */

/** Endereço de um cabeçalho From/To ("Nome <a@b.com>" ou "a@b.com"), minúsculo. */
export function headerAddress(value: string) {
  const m = value.match(/<([^<>\s]+@[^<>\s]+)>/) ?? value.match(/([^\s<>",;]+@[^\s<>",;]+)/);
  return m ? m[1].trim().toLowerCase() : "";
}

/** Pedido explícito para não receber contatos. Conservador: só frases claras. */
export function isOptOut(text: string) {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\bdescadastr|\bunsubscribe\b|remov(a|er|am)[^.\n]{0,40}(lista|e-?mail|contato)|nao (quero|desejo|tenho interesse em) (mais )?receber|para(r|m)? de (me )?(enviar|mandar)|nao me (envie|mande)|pare de enviar/.test(t);
}

/** Remove o texto citado de mensagens anteriores (linhas com ">" e o bloco "Em ... escreveu:"). */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*(Em|On) .{4,200}(escreveu|wrote):\s*$/i.test(line) || /^-{2,}\s*(Mensagem original|Original Message)/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function decodeBase64Url(data: string) {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
/** Texto da mensagem: prefere text/plain; usa text/html sem tags como alternativa. */
export function gmailText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const find = (p: GmailPart, type: string): string => {
    if (p.mimeType === type && p.body?.data) return decodeBase64Url(p.body.data);
    for (const c of p.parts ?? []) { const r = find(c, type); if (r) return r; }
    return "";
  };
  const plain = find(payload, "text/plain");
  if (plain) return plain;
  const html = find(payload, "text/html");
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

/**
 * Consulta do Gmail para respostas dos contatos depois do primeiro envio. Procura em toda a caixa
 * (inclusive arquivadas, spam e lixeira), porque e-mails do Titan buscados por POP podem não ficar
 * na Caixa de entrada; na dúvida, é mais seguro pausar a sequência do que enviar outro follow-up.
 */
export function gmailReplyQuery(contacts: string[], afterEpochSeconds: number) {
  const unique = [...new Set(contacts.map((c) => c.toLowerCase()))].filter((c) => /^[^@\s"()]+@[^@\s"()]+$/.test(c));
  return `in:anywhere -in:drafts -in:sent after:${Math.max(0, Math.floor(afterEpochSeconds))} from:(${unique.join(" OR ")})`;
}

/** Endereços que a caixa conectada recebe: o principal e os aliases confirmados (ex.: Titan buscado por POP). */
export type GmailMailbox = { address: string; aliases: string[] };

/** Endereço de respostas usado nas campanhas e fluxos: o configurado em Campanhas ou, sem ele, o remetente. */
export function effectiveReplyTo(settings: { reply_to: string; sender_email: string }) {
  return (settings.reply_to || settings.sender_email).trim().toLowerCase();
}

/** A leitura só é confiável se o endereço de respostas for o da caixa conectada ou um alias confirmado dela. */
export function replyAddressMonitored(replyTo: string, mailbox: GmailMailbox) {
  const r = replyTo.trim().toLowerCase();
  return Boolean(r) && [mailbox.address, ...mailbox.aliases].some((a) => a.trim().toLowerCase() === r);
}

export type FoundReply = { id: string; from: string; internalDate: number };

/**
 * Escolhe quais mensagens contam como resposta de cada inscrição: remetente igual ao contato,
 * recebida depois do início da sequência, ainda não registrada e nunca enviada por um endereço da própria Gravon.
 */
export function matchReplies<R extends FoundReply, E extends { started_at: string }>(
  replies: R[], byContact: Map<string, E>, own: string[], seen: Set<string>,
): { reply: R; enrollment: E }[] {
  const ownSet = new Set(own.map((a) => a.toLowerCase()));
  const out: { reply: R; enrollment: E }[] = [];
  for (const r of replies) {
    const e = byContact.get(r.from.toLowerCase());
    if (!e || seen.has(r.id) || ownSet.has(r.from.toLowerCase()) || r.internalDate < Date.parse(e.started_at)) continue;
    out.push({ reply: r, enrollment: e });
  }
  return out;
}

/** Envios das últimas 24h acima do teto param os fluxos até a janela liberar. */
export function remainingDailyQuota(sentLast24h: number, limit = FLOW_DAILY_LIMIT) {
  return Math.max(0, limit - Math.max(0, sentLast24h));
}

/* ------------------------- Agente Comercial: janela de envio ------------------------- */

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Horário inválido.");
export const flowScheduleInput = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  start: hhmm,
  end: hhmm,
  maxMessages: z.number().int().min(1).max(FLOW_MAX_STEPS),
}).strict().refine((s) => s.start < s.end, "O horário final precisa ser depois do inicial.");
export type FlowScheduleInput = z.infer<typeof flowScheduleInput>;

/** "08:00:00" → "08:00" (o banco devolve segundos). */
export const shortTime = (t: string) => t.slice(0, 5);

/** Dia da semana (0=domingo) e horário "HH:MM" em Brasília. */
export function saoPauloClock(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, time: `${get("hour").padStart(2, "0")}:${get("minute").padStart(2, "0")}` };
}

/** Mesma regra da reserva no banco: dia permitido e início ≤ agora < fim, no horário de Brasília. */
export function inSendWindow(f: { send_days: number[]; send_start: string; send_end: string }, at = new Date()) {
  const { day, time } = saoPauloClock(at);
  return f.send_days.includes(day) && time >= shortTime(f.send_start) && time < shortTime(f.send_end);
}

export function windowLabel(f: { send_days: number[]; send_start: string; send_end: string }) {
  const days = f.send_days.length === 7 ? "todos os dias" : [...f.send_days].sort().map((d) => WEEKDAYS[d]).join(", ");
  const s = shortTime(f.send_start), e = shortTime(f.send_end);
  return s === "00:00" && e === "24:00" ? `${days}, qualquer horário` : `${days}, ${s}–${e}`;
}

/* ------------------------- Caixa de entrada sincronizada ------------------------- */

/** Mensagens destinadas ao endereço comercial (Titan encaminhado ao Gmail), fora de spam/lixeira/enviados. */
export function businessInboxQuery(address: string, afterEpochSeconds: number) {
  const a = address.trim().toLowerCase();
  return `in:anywhere -in:sent -in:drafts -in:chats -in:spam -in:trash after:${Math.max(0, Math.floor(afterEpochSeconds))} {to:${a} cc:${a} deliveredto:${a}}`;
}
/** Mensagens vindas de contatos que já têm card, para qualquer endereço da caixa. */
export function knownContactsQuery(contacts: string[], afterEpochSeconds: number) {
  const unique = [...new Set(contacts.map((c) => c.toLowerCase()))].filter((c) => /^[^@\s"()]+@[^@\s"()]+$/.test(c));
  return `in:anywhere -in:sent -in:drafts -in:chats -in:spam -in:trash after:${Math.max(0, Math.floor(afterEpochSeconds))} from:(${unique.join(" OR ")})`;
}

export type InboundHeaders = { from: string; listUnsubscribe: string; precedence: string; autoSubmitted: string };
const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|n[aã]o-?_?respond[ae]r?|mailer-daemon|postmaster|bounces?|notifica[cç](o|õ)es|notifications?|newsletters?|news|alerts?|avisos?)([+._-].*)?$/i;

/**
 * Decide se uma mensagem entra no CRM. Remetentes com card sempre entram (exceto devoluções automáticas);
 * desconhecidos só entram se não forem automáticos (listas, newsletters, avisos), evitando importar a caixa inteira.
 */
export function shouldImportInbound(h: InboundHeaders, knownContact: boolean, own: string[]) {
  const from = h.from.toLowerCase();
  if (!from || own.some((o) => o.toLowerCase() === from)) return false;
  const local = from.split("@")[0];
  if (/^(mailer-daemon|postmaster)$/.test(local)) return false;
  if (knownContact) return true;
  if (AUTOMATED_LOCAL.test(local)) return false;
  if (h.listUnsubscribe.trim()) return false;
  if (/^(bulk|list|junk|auto_reply)$/i.test(h.precedence.trim())) return false;
  if (h.autoSubmitted.trim() && !/^no$/i.test(h.autoSubmitted.trim())) return false;
  return true;
}

/** Identificadores citados em In-Reply-To/References ("<a@b> <c@d>"). */
export function referencedIds(inReplyTo: string, references: string) {
  return [...new Set(`${inReplyTo} ${references}`.match(/<[^<>\s]+>/g) ?? [])].slice(0, 30);
}
