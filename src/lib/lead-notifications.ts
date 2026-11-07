import type { Lead, HistoryEntry } from "./crm-types";
export type LeadNotification = { id: string; lead: Lead; entry: HistoryEntry; timestamp: number };
export function leadNotifications(leads: Lead[]): LeadNotification[] {
  return leads.flatMap((lead) => (lead.history ?? []).filter((entry) => entry?.id && entry.text?.trim()).map((entry, index) => ({ id: `${lead.id}:${entry.id}`, lead, entry, timestamp: Date.parse(entry.date) || 0, index })))
    .sort((a, b) => b.timestamp - a.timestamp || (a.lead.id === b.lead.id ? a.index - b.index : a.lead.name.localeCompare(b.lead.name)));
}
export function latestLeadUpdate(lead: Lead) { return leadNotifications([lead])[0]?.entry ?? null; }
export function updateKind(entry: HistoryEntry) { return entry.kind === "note" || /anotaç|anotac/i.test(entry.text) ? "Anotação" : /→|etapa|qualifica/i.test(entry.text) ? "Movimentação" : "Atualização"; }
export function notificationDate(date: string) {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return "Data não informada";
  return new Date(timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", ...(date.length > 10 ? { timeStyle: "short" as const } : {}) });
}