/** Suggests a task title/due date from a WhatsApp message. Only literal dates/words become a due date. */
export function suggestTaskFromMessage(body: string, sentAt: string): { title: string; dueDate: string | null } {
  const text = body.replace(/\s+/g, " ").trim();
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  const title = first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
  return { title: title.length >= 2 ? title : "Retornar mensagem do cliente", dueDate: literalDue(text, new Date(sentAt)) };
}
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
export function literalDue(text: string, base: Date): string | null {
  const t = text.toLowerCase();
  const m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const day = +m[1], month = +m[2]; let year = m[3] ? +m[3] : base.getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      if (!m[3] && d < new Date(base.getFullYear(), base.getMonth(), base.getDate())) d.setFullYear(year + 1);
      if (d.getDate() === day) return ymd(d);
    }
  }
  const add = (n: number) => { const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n); return ymd(d); };
  if (/\bdepois de amanh[ãa](?!\p{L})/u.test(t)) return add(2);
  if (/\bamanh[ãa](?!\p{L})/u.test(t)) return add(1);
  if (/\bhoje\b/.test(t)) return add(0);
  return null;
}
