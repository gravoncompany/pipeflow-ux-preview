/** Parses a recipient CSV (comma or semicolon). Returns raw phone + name/company; normalization happens later. */
export function parseRecipientCsv(text: string): { raw: string; name: string; company: string }[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const split = (l: string) => { const out: string[] = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur.trim()); cur = ""; } else cur += ch; } out.push(cur.trim()); return out; };
  const head = split(lines[0]).map(h => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const find = (...keys: string[]) => head.findIndex(h => keys.some(k => h.includes(k)));
  let p = find("telefone", "whatsapp", "celular", "numero", "phone", "fone");
  const n = find("nome", "name"), c = find("empresa", "company");
  let start = 1;
  if (p < 0) { if (/\d{8,}/.test(lines[0].replace(/\D/g, ""))) { p = 0; start = 0; } else return []; }
  return lines.slice(start, 5001).map(split).map(cols => ({ raw: cols[p] ?? "", name: n >= 0 ? cols[n] ?? "" : "", company: c >= 0 ? cols[c] ?? "" : "" })).filter(r => r.raw);
}
