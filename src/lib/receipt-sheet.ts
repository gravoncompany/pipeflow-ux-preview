export type SheetClient = { row: number; name: string; service: string; amount: number | null; date: string; frequency: "mensal" | "quinzenal" | "semanal" | "outros" };
type Cell = { formattedValue?: string; effectiveValue?: { numberValue?: number }; effectiveFormat?: { backgroundColor?: { red?: number; green?: number; blue?: number } } };
export const receiptNameKey = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function parseReceiptRoster(rows: { values?: Cell[] }[]): SheetClient[] {
 let section: "annual" | "short" | null = null;
 const result: SheetClient[] = [];
 for (const [index, row] of rows.entries()) {
  const cells = row.values ?? [], name = cells[0]?.formattedValue?.trim() ?? "";
  if (receiptNameKey(name) === "nomedocliente") { section = section === null ? "annual" : "short"; continue; }
  if (section === "short" && !name && typeof cells[2]?.effectiveValue?.numberValue === "number") break;
  if (!name || !section || /^(valor total|total)/i.test(name)) continue;
  const color = cells[0]?.effectiveFormat?.backgroundColor;
  const green = !!color && (color.green ?? 0) > (color.red ?? 0) + 0.08 && (color.green ?? 0) > (color.blue ?? 0) + 0.08;
  const date = cells[3]?.formattedValue?.trim() ?? "";
  const value = cells[2]?.effectiveValue?.numberValue;
  result.push({ row: index + 1, name, service: cells[1]?.formattedValue?.trim() ?? "", amount: typeof value === "number" && value > 0 ? Math.round(value * 100) : null, date, frequency: section === "annual" ? green ? "mensal" : "outros" : /quinzenal/i.test(date) ? "quinzenal" : "semanal" });
 }
 return result;
}
export function matchReceiptClient(name: string, clients: { id: string; trade_name: string }[]) {
 const matches = clients.filter(c => receiptNameKey(c.trade_name) === receiptNameKey(name));
 return matches.length === 1 ? matches[0] : null;
}