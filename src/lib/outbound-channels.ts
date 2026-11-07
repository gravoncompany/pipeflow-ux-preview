// Prospecção Outbound por canal — cálculo puro sobre registros reais do CRM/Evolution/Brevo.
// Cada lead do Outbound tem um único canal de origem (o primeiro contato registrado), então o funil
// consolidado nunca conta o mesmo lead duas vezes.
import { DEFAULT_STAGES } from "./crm-types";
import { inRange, isQualified, ok, unavailable, integration, type Metric } from "./dashboard";

export type ChannelLead = { id: string; stage: string; entryDate: string };
export type Dated = { leadId: string; at: string };
export type SentEmail = Dated & { messageId: string | null };
export type SentWhatsApp = Dated & { delivered: boolean; read: boolean };
/** Eventos do Brevo por messageId; null = consulta indisponível. */
export type EmailEvents = { byMessage: Map<string, Set<string>>; failed: number } | null;

export type ChannelInputs = {
  leads: ChannelLead[];
  emails: SentEmail[];
  emailEvents: EmailEvents;
  diagnosisClicks: Dated[];
  forms: Dated[];
  emailReplies: Dated[];
  waOut: SentWhatsApp[];
  waIn: Dated[];
};

export type OriginChannel = "email" | "whatsapp" | "none";
export const ORIGIN_LABEL: Record<OriginChannel, string> = { email: "E-mail", whatsapp: "WhatsApp", none: "Sem contato registrado" };

const ORDER = DEFAULT_STAGES.map((s) => s.id);
export const hasMeeting = (stage: string) => stage !== "perda" && ORDER.indexOf(stage) >= ORDER.indexOf("reuniao-agendada");

/** Data de São Paulo (AAAA-MM-DD) de um instante ISO. */
export const spDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const inPeriod = (iso: string, from: string, to: string) => inRange(spDay(iso), from, to);

function firstBy(rows: Dated[]) {
  const m = new Map<string, string>();
  for (const r of rows) { const cur = m.get(r.leadId); if (!cur || r.at < cur) m.set(r.leadId, r.at); }
  return m;
}
/** Leads únicos com evento no período, ocorrido depois do primeiro contato do canal. */
function uniqueAfter(rows: Dated[], first: Map<string, string>, from: string, to: string) {
  const s = new Set<string>();
  for (const r of rows) { const f = first.get(r.leadId); if (f && r.at >= f && inPeriod(r.at, from, to)) s.add(r.leadId); }
  return s.size;
}

/** Canal de origem: o primeiro contato registrado (e-mail ou WhatsApp); empate fica com o e-mail. */
export function originChannel(leadId: string, firstEmail: Map<string, string>, firstWa: Map<string, string>): OriginChannel {
  const e = firstEmail.get(leadId), w = firstWa.get(leadId);
  if (e && (!w || e <= w)) return "email";
  return w ? "whatsapp" : "none";
}

export function outboundChannels(input: ChannelInputs, from: string, to: string) {
  const firstEmail = firstBy(input.emails);
  const firstWa = firstBy(input.waOut);

  // ---- E-mail
  const sentEmails = input.emails.filter((e) => inPeriod(e.at, from, to));
  const ev = input.emailEvents;
  const withId = sentEmails.filter((e) => e.messageId);
  const evCount = (names: string[]) => withId.filter((e) => names.some((n) => ev!.byMessage.get(e.messageId!)?.has(n))).length;
  const evNote = ev && ev.failed ? ` Brevo não respondeu para ${ev.failed} mensagem(ns); elas ficam fora da contagem.` : "";
  const brevoOff = "Não foi possível consultar os eventos no Brevo agora. Tente atualizar.";
  const email: Record<string, Metric> = {
    sent: ok(sentEmails.length, "E-mails aceitos pelo Brevo para cards do Outbound (prospecção, fluxos e campanhas)."),
    delivered: !sentEmails.length ? ok(0) : ev ? ok(evCount(["delivered"]), `Entregas confirmadas pelo Brevo.${evNote}`) : integration(brevoOff),
    opened: !sentEmails.length ? ok(0) : ev ? ok(evCount(["opened", "uniqueOpened"]), `Aberturas registradas pelo Brevo (aberturas automáticas da Apple não contam).${evNote}`) : integration(brevoOff),
    diagnosisClicks: ok(uniqueAfter(input.diagnosisClicks, firstEmail, from, to), "Leads que clicaram no link rastreado do diagnóstico."),
    forms: ok(uniqueAfter(input.forms, firstEmail, from, to), "Leads que preencheram o diagnóstico depois de receber e-mail."),
    replies: ok(uniqueAfter(input.emailReplies, firstEmail, from, to), "Leads que responderam por e-mail (Gmail conectado)."),
  };

  // ---- WhatsApp
  const sentWa = input.waOut.filter((m) => inPeriod(m.at, from, to));
  const receipts = sentWa.filter((m) => m.delivered || m.read).length;
  const receiptNote = receipts ? "" : " A Evolution ainda não registrou confirmações para estas mensagens.";
  const whatsapp: Record<string, Metric> = {
    sent: ok(sentWa.length, "Mensagens enviadas aos contatos do Outbound (CRM e celular conectado)."),
    delivered: ok(receipts, `Confirmações de entrega recebidas pela Evolution.${receiptNote}`),
    read: ok(sentWa.filter((m) => m.read).length, `Confirmações de leitura recebidas pela Evolution.${receiptNote}`),
    replies: ok(uniqueAfter(input.waIn, firstWa, from, to), "Leads que responderam depois do primeiro envio."),
    forms: ok(uniqueAfter(input.forms, firstWa, from, to), "Leads que preencheram o diagnóstico depois de contato por WhatsApp."),
  };

  // ---- Funil consolidado: coorte de entrada no Outbound, um canal por lead.
  const cohort = input.leads.filter((l) => inRange(l.entryDate, from, to));
  const blank = () => ({ leads: 0, qualified: 0, meetings: 0, customers: 0 });
  const rows: Record<OriginChannel, ReturnType<typeof blank>> = { email: blank(), whatsapp: blank(), none: blank() };
  for (const l of cohort) {
    const r = rows[originChannel(l.id, firstEmail, firstWa)];
    r.leads++;
    if (isQualified(l.stage)) r.qualified++;
    if (hasMeeting(l.stage)) r.meetings++;
    if (l.stage === "fechado") r.customers++;
  }
  const total = (["email", "whatsapp", "none"] as const).reduce((t, k) => ({
    leads: t.leads + rows[k].leads, qualified: t.qualified + rows[k].qualified, meetings: t.meetings + rows[k].meetings, customers: t.customers + rows[k].customers,
  }), blank());
  return {
    email, whatsapp,
    funnel: { total, byChannel: (["email", "whatsapp", "none"] as const).map((k) => ({ channel: k, label: ORIGIN_LABEL[k], ...rows[k] })) },
  };
}

export const outboundUnavailable = () => unavailable("Funil Outbound não encontrado.");
