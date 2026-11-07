// Semana do calendário da Agenda, sempre no fuso de São Paulo (mesmo fuso usado pelo agendamento).
export const AGENDA_TZ = "America/Sao_Paulo";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: AGENDA_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Dia (AAAA-MM-DD) e minutos desde 00:00 de um instante, no relógio de São Paulo. */
export function spClock(iso: string) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Segunda-feira da semana que contém o dia informado. */
export function weekStartOf(day: string) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}
export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

/** Limites UTC da semana (00:00 de segunda a 00:00 da segunda seguinte em São Paulo). */
export const weekBounds = (start: string) => ({
  from: new Date(`${start}T00:00:00-03:00`).toISOString(),
  to: new Date(`${addDays(start, 7)}T00:00:00-03:00`).toISOString(),
});

export type AgendaItem = { key: string; kind: "crm" | "google"; id: string; summary: string; subtitle: string; start: string; end: string; allDay: boolean };

/** Une reuniões do CRM e eventos do Google Agenda; um evento já registrado pelo CRM aparece uma vez só. */
export function mergeAgendaItems(
  appointments: { id: string; event_id: string; summary: string; starts_at: string; ends_at: string; status: string; lead_id: string }[],
  google: { id: string; summary: string; start: string; end: string; allDay: boolean }[],
  leadNames: Record<string, string>,
): AgendaItem[] {
  const crmEvents = new Set(appointments.map((a) => a.event_id));
  const crm: AgendaItem[] = appointments.filter((a) => a.status === "scheduled").map((a) => ({
    key: `crm:${a.id}`, kind: "crm", id: a.id, summary: a.summary, subtitle: leadNames[a.lead_id] ?? "Lead",
    start: new Date(a.starts_at).toISOString(), end: new Date(a.ends_at).toISOString(), allDay: false,
  }));
  const external: AgendaItem[] = google.filter((e) => !crmEvents.has(e.id)).map((e) => ({
    key: `google:${e.id}`, kind: "google", id: e.id, summary: e.summary, subtitle: "Google Agenda", start: e.start, end: e.end, allDay: e.allDay,
  }));
  return [...crm, ...external].sort((a, b) => a.start.localeCompare(b.start));
}

/** Dias cobertos por um item (eventos de dia inteiro usam a data final exclusiva do Google). */
export function itemDays(item: AgendaItem): string[] {
  if (item.allDay) {
    const out: string[] = [];
    for (let d = item.start.slice(0, 10); d < item.end.slice(0, 10) && out.length < 31; d = addDays(d, 1)) out.push(d);
    return out.length ? out : [item.start.slice(0, 10)];
  }
  return [spClock(item.start).day];
}
