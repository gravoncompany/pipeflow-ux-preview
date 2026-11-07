// Formatação compartilhada de leitura (datas, dias, variações) usada pelas telas redesenhadas.
// Funções puras: não dependem do navegador nem do relógio, exceto quando `asOf` é omitido.

/** "2026-11-07" → "07/11/2026". Valores vazios ou fora do padrão voltam como "—" ou inalterados. */
export function dateBR(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** Diferença em dias inteiros entre duas datas ISO (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

/** Texto curto relativo a hoje: "hoje", "amanhã", "em 3 dias", "há 5 dias". */
export function relativeDay(date: string, asOf: string): string {
  const d = daysBetween(asOf, date);
  if (d === 0) return "hoje";
  if (d === 1) return "amanhã";
  if (d === -1) return "ontem";
  return d > 0 ? `em ${d} dias` : `há ${-d} dias`;
}

/** Variação percentual com uma casa; null quando a base é zero ou ausente. */
export function percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Mês anterior de uma chave "AAAA-MM". */
export function previousMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Dias úteis (seg–sex) de `asOf` até o fim do mês `month` (AAAA-MM), contando hoje; 0 se o mês já passou. */
export function businessDaysLeft(month: string, asOf: string): number {
  if (asOf.slice(0, 7) > month) return 0;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startDay = asOf.slice(0, 7) === month ? Number(asOf.slice(8, 10)) : 1;
  let n = 0;
  for (let d = startDay; d <= last; d++) { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
