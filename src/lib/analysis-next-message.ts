import { z } from "zod";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(`${v}T12:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v; });
export const nextMessageInput = z.object({ phone: z.string().min(8).max(40), start: calendarDate, end: calendarDate }).strict().refine(v => v.start <= v.end);
export const approveMessageInput = z.object({ id: z.string().uuid(), text: z.string().min(1).max(4000).refine(v => v.trim().length > 0) }).strict();
export type NextMessageDraft = {
  id: string; text: string; name: string; phone: string; instance: string;
  status: string; error: string | null; providerId: string | null;
  approvedAt: string | null; readAt: string | null; deliveredAt: string | null;
  analyzedAt: string; result: import("./whatsapp-analysis").Analysis;
};

export type ProviderMessage = { key: { id: string; fromMe: boolean; remoteJid: string; addressingMode?: string; remoteJidAlt?: string }; messageTimestamp: number | string; message?: Record<string, unknown> };
export function verifyConversationAnchor(rows: ProviderMessage[], expected: { id: string; fromMe: boolean; jid: string }) {
  const exact = rows.filter(r => r.key.id === expected.id);
  if (exact.length !== 1) throw new Error("Não foi encontrado um único ID desta conversa na instância selecionada.");
  const row = exact[0];
  if (!row || row.key.fromMe !== expected.fromMe) throw new Error("A direção da mensagem não coincide com o histórico.");
  const k = row.key;
  if (k.remoteJid !== expected.jid && !(k.addressingMode === "lid" && /^\d{10,20}@lid$/.test(k.remoteJid) && k.remoteJidAlt === expected.jid))
    throw new Error("Número não verificado: LID exige modo lid e número alternativo exato.");
  return row;
}
export function providerConversationVersion(rows: ProviderMessage[]) {
  return canonicalJson(rows.map(r => ({ key: r.key, timestamp: String(r.messageTimestamp), message: r.message ?? null })).sort((a, b) => a.key.id.localeCompare(b.key.id)));
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function withinAnalysisPeriod(sentAt: string, start: string, end: string) {
  const time = new Date(sentAt).getTime();
  return time >= new Date(`${start}T00:00:00-03:00`).getTime() && time <= new Date(`${end}T23:59:59.999-03:00`).getTime();
}
export function maySend(status: string) { return status === "pending"; }
export function nextMessageStatus(d: Pick<NextMessageDraft, "status" | "readAt" | "deliveredAt">) {
  if (d.readAt) return "Leitura confirmada";
  if (d.deliveredAt) return "Entrega confirmada";
  return ({ pending: "Aguardando revisão", sending: "Envio em andamento ou resultado ainda não confirmado · não reenviar", accepted: "Aceita pela Evolution · entrega não confirmada", unknown: "Resultado incerto · não reenviar", failed: "Falha no envio", stale: "Conversa alterada · atualize e revise novamente" } as Record<string, string>)[d.status] ?? d.status;
}