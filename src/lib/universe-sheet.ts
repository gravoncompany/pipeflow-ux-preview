import { expectedAwards, universeMetrics, type Journey, type UniverseAward, type UniverseReceipt } from "./gravon-universe";

// Gravon Universe alimentado pela planilha oficial (temporária) — somente leitura.
// Estrutura verificada da aba "2026": linha 1 E–P = Janeiro…Dezembro; linha 51 E–P = rótulo "Valor Total" e linha 52 =
// valores; linha 54 E–P = rótulo "Tráfego" e linha 55 = valores. Os rótulos são conferidos a cada leitura: se a planilha
// mudar de formato, a leitura falha com aviso (nunca lê a linha errada nem inventa valores).
export const UNIVERSE_SHEET_TAB = "2026";
export const UNIVERSE_SHEET_YEAR = 2026;
export const UNIVERSE_RANGES = { months: "'2026'!E1:P1", revenue: "'2026'!E51:P52", traffic: "'2026'!E54:P55" } as const;
export const UNIVERSE_MONTHLY_GOAL_CENTS = 50_000 * 100;
const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Valor monetário da célula em centavos: número (UNFORMATTED_VALUE) ou texto pt-BR ("R$ 18.334,00"). Vazio → null.
export function cellToCents(v: unknown): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : "invalid";
  const s = String(v).replace(/R\$/i, "").replace(/\s/g, "");
  if (!s) return null;
  if (!/^-?[\d.]+(,\d{1,2})?$/.test(s) && !/^-?\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : "invalid";
}
export type SheetMonth = { month: string; label: string; cents: number | null; cell: string };
export type SheetParse = { ok: true; revenue: SheetMonth[]; traffic: SheetMonth[] } | { ok: false; error: string };
export function parseUniverseSheet(header: unknown[], revenue: unknown[][], traffic: unknown[][]): SheetParse {
  if (header.length !== 12 || header.some((h, i) => norm(h) !== MONTHS[i])) return { ok: false, error: "A linha de meses (E1:P1) da aba 2026 não corresponde a Janeiro…Dezembro. A estrutura da planilha mudou." };
  const labelOk = (row: unknown[] | undefined, label: string) => Boolean(row && row.length > 0 && row.every(c => c === "" || c === null || norm(c) === label) && row.some(c => norm(c) === label));
  if (!labelOk(revenue[0], "valor total")) return { ok: false, error: "O rótulo \"Valor Total\" não está mais na linha 51 (E–P). A estrutura da planilha mudou." };
  if (!labelOk(traffic[0], "trafego")) return { ok: false, error: "O rótulo \"Tráfego\" não está mais na linha 54 (E–P). A estrutura da planilha mudou." };
  const rows = (values: unknown[] | undefined, line: number): SheetMonth[] | string => {
    const out: SheetMonth[] = [];
    for (let i = 0; i < 12; i++) {
      const c = cellToCents(values?.[i]);
      if (c === "invalid") return `Valor não numérico em ${String.fromCharCode(69 + i)}${line}.`;
      out.push({ month: `${UNIVERSE_SHEET_YEAR}-${String(i + 1).padStart(2, "0")}`, label: String(header[i]).trim(), cents: c, cell: `${String.fromCharCode(69 + i)}${line}` });
    }
    return out;
  };
  const r = rows(revenue[1], 52), t = rows(traffic[1], 55);
  if (typeof r === "string") return { ok: false, error: r };
  if (typeof t === "string") return { ok: false, error: t };
  return { ok: true, revenue: r, traffic: t };
}
// Converte os meses da planilha em recebimentos confirmados no formato do Universe (um por mês com valor), para que as
// regras originais (universeMetrics, journeyProgress, expectedAwards) funcionem sem mudança. Mês vazio não gera registro.
export function sheetReceipts(months: SheetMonth[], asOf: string): UniverseReceipt[] {
  return months.filter(m => m.cents !== null && m.cents > 0).map(m => {
    const [y, mo] = m.month.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const date = m.month === asOf.slice(0, 7) ? asOf : last;
    return { id: `sheet:${m.month}`, amount: m.cents as number, date, description: `Planilha ${UNIVERSE_SHEET_TAB} · Valor Total · ${m.label}`, origin: "Google Sheets", reference: `sheet-${UNIVERSE_SHEET_TAB}-${m.cell}`, status: "confirmada" as const, revision: 0, editable: false };
  }).filter(r => r.date <= asOf);
}
export function sheetAwards(receipts: UniverseReceipt[], targets: Record<Journey, number[]>, asOf: string): UniverseAward[] {
  return expectedAwards(receipts, targets, asOf).map(a => ({ ...a, awarded_at: asOf }));
}
export type UniverseCard = { monthLabel: string; month: string; revenueCents: number | null; goalCents: number; percent: number; remainingCents: number };
export function universeCard(months: SheetMonth[], asOf: string, goalCents = UNIVERSE_MONTHLY_GOAL_CENTS): UniverseCard {
  const cur = months.find(m => m.month === asOf.slice(0, 7));
  const value = cur?.cents ?? null;
  const percent = value === null ? 0 : Math.max(0, Math.min(100, Math.floor((value / goalCents) * 100)));
  return { month: asOf.slice(0, 7), monthLabel: cur?.label ?? asOf.slice(0, 7), revenueCents: value, goalCents, percent, remainingCents: value === null ? goalCents : Math.max(0, goalCents - value) };
}
export function sheetMetrics(months: SheetMonth[], asOf: string) { return universeMetrics(sheetReceipts(months, asOf), asOf); }

// Formato esperado pela interface do laboratório (MonthValue / FinanceMonth): rótulo do mês, valor em reais e status.
export function toFinanceMonths(months: SheetMonth[]): { month: string; short: string; value: number | null; status: "value" | "empty"; cell: string }[] {
  return months.map(m => ({ month: m.label, short: m.label.slice(0, 3), value: m.cents === null ? null : m.cents / 100, status: m.cents === null ? "empty" as const : "value" as const, cell: m.cell }));
}
