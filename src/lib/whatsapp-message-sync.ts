import { phoneDigits, phoneKey, sameWhatsAppNumber } from "./phone";

export const SEND_STATE_LABELS: Record<string, string> = {
  received: "Solicitação recebida",
  sending: "Solicitação de envio registrada",
  accepted: "Aceita pela Evolution · entrega não confirmada",
  delivered: "Entrega confirmada",
  error: "Erro",
  unknown: "Resultado indeterminado · sem reenvio",
  sync_error: "Aceita pela Evolution · falha ao sincronizar",
  skipped: "Ignorado",
  ok: "Registro anterior · confirmação não informada",
};

export type AcceptedMessage = {
  messageId: string;
  instance: string;
  remoteJid: string;
  phoneKey: string;
  body: string;
  acceptedAt: string;
};

export function normalizeAcceptedMessage(raw: unknown, expected: {
  instance: string; number: string; body: string; acceptedAt: string;
}): AcceptedMessage | null {
  if (!raw || typeof raw !== "object" || !("key" in raw)) return null;
  const key = raw.key;
  if (!key || typeof key !== "object" || !("id" in key) || !("remoteJid" in key)) return null;
  if (typeof key.id !== "string" || !key.id.trim() || key.id.length > 200) return null;
  if (typeof key.remoteJid !== "string" || !/^\d{10,15}@s\.whatsapp\.net$/.test(key.remoteJid)) return null;
  if (!("fromMe" in key) || key.fromMe !== true) return null;
  // Authorization permits only the Brazilian mobile ninth-digit variant, never loose phoneKey matching.
  if (!sameWhatsAppNumber(key.remoteJid, expected.number) || !expected.instance) return null;
  return { messageId: key.id, remoteJid: key.remoteJid, instance: expected.instance,
    phoneKey: phoneKey(key.remoteJid), body: expected.body, acceptedAt: expected.acceptedAt };
}

export type OpenInstance = { name: string; number: string };
export function openInstances(raw: unknown): OpenInstance[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const nested = value.instance && typeof value.instance === "object" ? value.instance : {};
    const state = value.connectionStatus ?? nested.status;
    const name = value.name ?? nested.instanceName;
    const number = value.number || value.ownerJid || nested.ownerJid;
    if (state !== "open" || typeof name !== "string" || typeof number !== "string") return [];
    const digits = phoneDigits(number);
    return /^\d{10,15}$/.test(digits) ? [{ name, number: digits }] : [];
  });
}

export function selectTestInstance(raw: unknown, instance: string, authorizedPhone: string) {
  const matches = openInstances(raw).filter((i) => i.name === instance && sameWhatsAppNumber(i.number, authorizedPhone));
  return matches.length === 1 ? matches[0] : null;
}

export function explicitDeliveryUpdate(value: unknown): { messageId: string; remoteJid: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const key = row.key && typeof row.key === "object" ? row.key as Record<string, unknown> : row;
  const update = row.update && typeof row.update === "object" ? row.update as Record<string, unknown> : row;
  // Only explicit named acknowledgement states; numeric statuses are not guessed.
  if (!["DELIVERY_ACK", "READ", "PLAYED"].includes(String(update.status))) return null;
  const id = key.id ?? row.keyId;
  if (typeof id !== "string" || !id || id.length > 200 || typeof key.remoteJid !== "string" || !/^\d{10,15}@s\.whatsapp\.net$/.test(key.remoteJid)) return null;
  return { messageId: id, remoteJid: key.remoteJid };
}

export function chronologicalMessages<T extends { sent_at: string; message_id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.message_id.localeCompare(b.message_id));
}