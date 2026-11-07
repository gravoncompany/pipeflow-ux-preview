// Brazilian WhatsApp numbers may arrive with or without country code and with or
// without the extra 9th digit, so matching uses DDD + last 8 digits.
export function phoneKey(raw: string): string {
  let d = (raw || "").split("@")[0].replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10) return d.slice(-8);
  return d.slice(0, 2) + d.slice(-8);
}

export function phoneDigits(raw: string): string {
  let d = (raw || "").split("@")[0].replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

/** Authorization equivalence: full number, or Brazil's optional mobile ninth digit only. */
export function sameWhatsAppNumber(left: string, right: string): boolean {
  const a = phoneDigits(left);
  const b = phoneDigits(right);
  if (!/^\d{10,15}$/.test(a) || !/^\d{10,15}$/.test(b)) return false;
  if (a === b) return true;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  return /^55[1-9]\d[6-9]\d{7}$/.test(short) &&
    long.length === 13 && long === `${short.slice(0, 4)}9${short.slice(4)}`;
}

const BR_DDDS = new Set([11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99]);
export type WhatsAppTarget = { kind: "phone" | "group" | "lid" | "invalid"; value: string; reason: string };
/** Central campaign normalization: group (@g.us) and @lid ids are kept untouched; only phone numbers get Brazil's 55. Ninth digit is never added/removed. */
export function normalizeWhatsAppTarget(raw: string): WhatsAppTarget {
  const s = (raw || "").trim().toLowerCase();
  if (/^[0-9]{5,40}(-[0-9]+)?@g\.us$/.test(s)) return { kind: "group", value: s, reason: "" };
  if (s.endsWith("@lid")) return { kind: "lid", value: s, reason: "Identificador interno (@lid) sem número de telefone" };
  const explicitIntl = /^\s*(\+|00)/.test(raw || "");
  let d = s.split("@")[0].replace(/\D/g, "");
  if (explicitIntl && d.startsWith("00")) d = d.slice(2);
  if (!explicitIntl && (d.length === 10 || d.length === 11)) d = "55" + d;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = Number(d.slice(2, 4)), local = d.slice(4);
    if (!BR_DDDS.has(ddd)) return { kind: "invalid", value: d, reason: "DDD inválido" };
    if (local.length === 9 && local[0] !== "9") return { kind: "invalid", value: d, reason: "Celular com 9 dígitos deve começar com 9" };
    return { kind: "phone", value: d, reason: "" };
  }
  if (d.startsWith("55")) return { kind: "invalid", value: d, reason: "Quantidade de dígitos inválida" };
  if (/^\d{8,15}$/.test(d) && explicitIntl) return { kind: "phone", value: d, reason: "" };
  return { kind: "invalid", value: d, reason: "Número incompleto ou inválido" };
}
