// Bloco "Hoje" do Dashboard — regras puras (sem acesso a banco), sempre no dia de São Paulo.
// Os critérios reaproveitam os do CRM: "aguardando resposta" = última mensagem do WhatsApp é do cliente
// (mesmo critério de "Conversas sem resposta"); retorno = data da próxima ação do card.
import { phoneKey } from "./phone";

export const FINAL_STAGES = ["fechado", "perda"];

export type TodayLeadRow = { id: string; name: string; company: string; stage: string; pipelineId: string | null; whatsapp: string; nextAction: string; nextActionDate: string | null };
export type TodayMessage = { phoneKey: string; fromMe: boolean; sentAt: string };
export type TodayAppointment = { id: string; leadId: string; summary: string; startsAt: string; endsAt: string; status: string };

export type TodayLead = { id: string; name: string; company: string; stage: string; pipelineId: string | null; pipelineName: string; detail: string; at: string };
export type TodayMeeting = { id: string; summary: string; leadName: string; startsAt: string; endsAt: string };

const spDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export function buildToday(input: {
  today: string;
  leads: TodayLeadRow[];
  messages: TodayMessage[];
  appointments: TodayAppointment[];
  pipelineNames: Record<string, string>;
}) {
  const { today, leads } = input;
  const open = leads.filter((l) => !FINAL_STAGES.includes(l.stage));
  const pipelineName = (id: string | null) => (id ? input.pipelineNames[id] ?? "Funil" : "Funil principal");
  const base = (l: TodayLeadRow) => ({ id: l.id, name: l.name || "Lead sem nome", company: l.company, stage: l.stage, pipelineId: l.pipelineId, pipelineName: pipelineName(l.pipelineId) });

  // Última mensagem por contato (mensagens podem vir fora de ordem).
  const last = new Map<string, TodayMessage>();
  for (const m of input.messages) {
    if (m.phoneKey.length < 8) continue;
    const cur = last.get(m.phoneKey);
    if (!cur || m.sentAt > cur.sentAt) last.set(m.phoneKey, m);
  }
  const awaiting: TodayLead[] = [];
  const seen = new Set<string>();
  for (const l of open) {
    const key = phoneKey(l.whatsapp || "");
    if (key.length < 8 || seen.has(key)) continue;
    const m = last.get(key);
    if (!m || m.fromMe) continue;
    seen.add(key);
    awaiting.push({ ...base(l), detail: "Última mensagem do cliente", at: m.sentAt });
  }
  awaiting.sort((a, b) => b.at.localeCompare(a.at));

  const dated = open.filter((l) => l.nextActionDate);
  const returnsToday: TodayLead[] = dated.filter((l) => l.nextActionDate!.slice(0, 10) === today)
    .map((l) => ({ ...base(l), detail: l.nextAction.trim() || "Retorno programado", at: l.nextActionDate!.slice(0, 10) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const overdue: (TodayLead & { daysLate: number })[] = dated.filter((l) => l.nextActionDate!.slice(0, 10) < today)
    .map((l) => ({ ...base(l), detail: l.nextAction.trim() || "Retorno programado", at: l.nextActionDate!.slice(0, 10), daysLate: daysBetween(l.nextActionDate!.slice(0, 10), today) }))
    .sort((a, b) => b.daysLate - a.daysLate);

  const names = new Map(leads.map((l) => [l.id, l.name]));
  const meetings: TodayMeeting[] = input.appointments
    .filter((a) => a.status === "scheduled" && spDay(a.startsAt) === today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((a) => ({ id: a.id, summary: a.summary, leadName: names.get(a.leadId) ?? "Lead", startsAt: a.startsAt, endsAt: a.endsAt }));

  return { today, awaiting, returnsToday, overdue, meetings };
}
export type DashboardToday = ReturnType<typeof buildToday>;
