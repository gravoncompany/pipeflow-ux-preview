// Merges what is already linked to a lead into one chronological list (newest first). Pure; no data access.
type HistoryEntry = { id: string; date?: string; text: string; kind?: string };
type Message = { id: string; fromMe: boolean; body: string; sentAt: string; mediaType?: string | null };
type Email = { id: string; direction: string; subject?: string; body?: string; date: string | null; status?: string };

export type TimelineItem = {
  key: string; source: "history" | "whatsapp" | "email"; direction?: "in" | "out";
  date: string | null; label: string; title?: string; text: string; removableId?: string;
};

const time = (d: string | null | undefined) => { const t = d ? Date.parse(d) : NaN; return Number.isFinite(t) ? t : -Infinity; };

export function buildLeadTimeline(input: { history: HistoryEntry[]; messages: Message[]; emails: Email[] }): TimelineItem[] {
  const items: TimelineItem[] = [
    ...input.history.map((h): TimelineItem => ({
      key: `h:${h.id}`, source: "history", date: h.date ?? null, label: "Histórico comercial", text: h.text,
      // Audited calls and interactions are never removable from the card (same rule as before).
      removableId: h.kind !== "whatsapp_call" && h.kind !== "interaction" ? h.id : undefined,
    })),
    ...input.messages.map((m): TimelineItem => ({
      key: `w:${m.id}`, source: "whatsapp", direction: m.fromMe ? "out" : "in", date: m.sentAt,
      label: m.fromMe ? "WhatsApp · enviada" : "WhatsApp · cliente", text: m.body || (m.mediaType ? `[${m.mediaType}]` : ""),
    })),
    ...input.emails.map((e): TimelineItem => ({
      key: `e:${e.id}`, source: "email", direction: e.direction === "in" ? "in" : "out", date: e.date,
      label: `E-mail · ${e.direction === "in" ? "recebido" : "enviado"}${e.status ? ` · ${e.status}` : ""}`, title: e.subject || "(sem assunto)", text: e.body ?? "",
    })),
  ];
  return items.sort((a, b) => time(b.date) - time(a.date));
}
