import { z } from "zod";
import type { HistoryEntry } from "./crm-types";

export const CALL_RESULTS = { answered: "Atendida", unanswered: "Não atendeu", busy: "Ocupada", unknown: "Resultado não informado" } as const;
export function interactionDate(value: string) { return new Date(`${value}:00-03:00`); }
export const interactionSchema = z.object({
  leadId: z.string().uuid(), id: z.string().uuid(),
  type: z.enum(["interaction", "whatsapp_call"]),
  date: z.string().datetime({ offset: true }),
  result: z.enum(["answered", "unanswered", "busy", "unknown"]),
  note: z.string().trim().max(4000), responsible: z.string().trim().max(160),
}).strict().refine(i => i.type === "whatsapp_call" || i.note.length > 0, "Informe a interação.");

export function callText(direction: string, result: keyof typeof CALL_RESULTS) {
  const label = direction === "outgoing" ? "Ligação realizada pelo WhatsApp" : direction === "incoming" ? "Ligação recebida pelo WhatsApp" : "Ligação pelo WhatsApp — direção não informada";
  return `${label} — ${CALL_RESULTS[result]}`;
}

export function manualEntry(input: z.infer<typeof interactionSchema>): HistoryEntry {
  return { id: input.id, date: input.date, kind: input.type,
    text: input.type === "whatsapp_call" ? [callText("unknown", input.result), input.note && `Observação: ${input.note}`, input.responsible && `Responsável informado: ${input.responsible}`].filter(Boolean).join("\n") : input.note,
    ...(input.type === "whatsapp_call" ? { result: input.result, direction: "unknown", note: input.note, responsible: input.responsible, source: "manual" } : {}),
  };
}

const callSchema = z.object({ id: z.string().min(1).max(200), from: z.string().min(1).max(80), status: z.string().min(1).max(80), date: z.union([z.string().max(80), z.number()]).optional(), isGroup: z.boolean().optional(), isVideo: z.boolean().optional() }).passthrough();

/** Evolution 2.3.7 forwards Baileys call objects. Unknown fields never imply direction or outcome. */
export function parseEvolutionCall(value: unknown) {
  const parsed = callSchema.safeParse(value);
  if (!parsed.success) return null;
  const c = parsed.data;
  const status = c.status.toLowerCase();
  const result: keyof typeof CALL_RESULTS = status === "accept" ? "answered" : "unknown";
  const d = c.date === undefined ? null : new Date(typeof c.date === "number" && c.date < 1e12 ? c.date * 1000 : c.date);
  return { id: c.id, jid: c.from, state: status, date: d && Number.isFinite(d.getTime()) ? d.toISOString() : "", result,
    direction: "unknown", group: c.isGroup === true || c.from.endsWith("@g.us") };
}