import { sameWhatsAppNumber } from "./phone";

export type WhatsAppGroup = { jid: string; name: string; size: number | null; announce: boolean; canPost: boolean; reason: string };
export function normalizeGroups(list: unknown, owner: string, requirePermission = false): WhatsAppGroup[] {
  if (!Array.isArray(list) || list.length > 10000) throw new Error("invalid_groups");
  const groups = new Map<string, WhatsAppGroup>();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const g = raw as Record<string, unknown>;
    const jid = String(g.id ?? "");
    if (!/^[0-9]{5,40}(-[0-9]+)?@g\.us$/.test(jid)) continue;
    const parts = Array.isArray(g.participants) ? g.participants as Record<string, unknown>[] : null;
    const me = parts?.find(p => owner && [p.phoneNumber, p.id].some(v => typeof v === "string" && sameWhatsAppNumber(v.split("@")[0], owner)));
    const known = Boolean(parts && owner), announce = g.announce === true;
    const admin = me?.admin === "admin" || me?.admin === "superadmin";
    const canPost = known ? Boolean(me) && (!announce || admin) : !requirePermission;
    const reason = !known ? "Participação será verificada antes do envio." : !me ? "A conta conectada não participa deste grupo." : announce && !admin ? "Somente administradores podem enviar mensagens neste grupo." : "";
    groups.set(jid, { jid, name: String(g.subject ?? "").slice(0, 200) || "Grupo sem nome", size: typeof g.size === "number" ? g.size : parts?.length ?? null, announce, canPost, reason });
  }
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name, "pt-BR"));
}