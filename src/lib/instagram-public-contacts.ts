/** Deterministic commercial contact evidence. No network, no guessed numbers. */
export type ContactEvidence = { field: "email" | "phone" | "whatsapp" | "website"; value: string; url: string; method: "instagram" | "site" | "busca" };
export function normalizePublicPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (/^\d{10,11}$/.test(digits) && !raw.trim().startsWith("+")) return `55${digits}`;
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : "";
}
const whatsappHost = (host: string) => /^(?:(?:api|web|www)\.)?whatsapp\.com$|^wa\.me$/i.test(host);
export function whatsappLink(raw: string, depth = 0): { isWhatsapp: boolean; phone: string; original: string } {
  const original = raw.trim().replace(/&amp;|&#38;/gi, "&");
  const empty = { isWhatsapp: false, phone: "", original };
  if (depth > 3 || original.length > 4000) return empty;
  try {
    const url = new URL(/^(?:wa\.me|(?:api|web|www)\.whatsapp\.com|whatsapp\.com)\//i.test(original) ? `https://${original}` : original);
    if (url.username || url.password) return empty;
    if (whatsappHost(url.hostname) && ["https:", "whatsapp:"].includes(url.protocol) || url.protocol === "whatsapp:" && url.hostname === "send") {
      const number = url.searchParams.get("phone") || (url.hostname === "wa.me" ? url.pathname.split("/")[1] : "") || "";
      return { isWhatsapp: true, phone: normalizePublicPhone(number), original };
    }
    if (url.protocol !== "https:") return empty;
    for (const key of ["url", "u", "target", "redirect", "redirect_url", "destination", "link"]) {
      const nested = url.searchParams.get(key);
      if (!nested) continue;
      const match = whatsappLink(nested, depth + 1);
      if (match.isWhatsapp) return { ...match, original };
    }
  } catch { /* malformed URL */ }
  return empty;
}
export function publicLinks(text: string, base = ""): string[] {
  const links = new Set<string>();
  const decoded = text.replace(/&amp;|&#38;/gi, "&");
  const candidates = [...decoded.matchAll(/(?:href|data-href|data-url)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  candidates.push(...[...decoded.matchAll(/(?:https:\/\/|whatsapp:\/\/|wa\.me\/)[^\s<>"']+/gi)].map(m => m[0]));
  for (const candidate of candidates.slice(0, 200)) {
    try { const url = new URL(candidate.startsWith("wa.me/") ? `https://${candidate}` : candidate, base || undefined); if (["https:", "whatsapp:"].includes(url.protocol)) links.add(url.href); } catch { /* invalid */ }
  }
  return [...links].slice(0, 100);
}
export function whatsappEvidence(text: string, source: string, method: ContactEvidence["method"]): ContactEvidence[] {
  return publicLinks(text).flatMap(url => {
    const match = whatsappLink(url);
    return match.phone ? [{ field: "whatsapp" as const, value: match.phone, url: source || match.original, method }] : [];
  }).filter((e, i, all) => all.findIndex(x => x.value === e.value) === i).slice(0, 3);
}
/** Search snippets alone never authorize an association: require an exact profile backlink on the page. */
export function pageMatchesInstagram(html: string, username: string): boolean {
  return publicLinks(html).some(link => {
    try { const u = new URL(link); return /^(www\.)?instagram\.com$/i.test(u.hostname) && u.pathname.replace(/^\/|\/$/g, "").toLowerCase() === username.toLowerCase(); } catch { return false; }
  });
}