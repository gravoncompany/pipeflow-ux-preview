import { parseReceiptRoster, type SheetClient } from "./receipt-sheet";
const SHEET = "1IgEXlYyPR8DbTu_DI7X3EC7T7pkxy54beG5Sy66-Qqk";
export function createReceiptRosterReader(fetcher: typeof fetch = fetch) {
 let cache: { expires: number; rows: SheetClient[] } | null = null;
 return async (gatewayKey?: string, sheetsKey?: string) => {
  if (!gatewayKey || !sheetsKey) return { rows: [], error: "Conexão com a planilha indisponível." };
  if (cache && cache.expires > Date.now()) return { rows: cache.rows, error: null };
  const url = new URL(`https://connector-gateway.lovable.dev/google_sheets/v4/spreadsheets/${SHEET}`);
  url.searchParams.set("ranges", "'2026'!A1:D100");
  url.searchParams.set("includeGridData", "true");
  url.searchParams.set("fields", "sheets.data.rowData.values(formattedValue,effectiveValue,effectiveFormat.backgroundColor)");
  try {
   const response = await fetcher(url, { headers: { Authorization: `Bearer ${gatewayKey}`, "X-Connection-Api-Key": sheetsKey }, redirect: "manual", signal: AbortSignal.timeout(15000) });
   if (!response.ok) return { rows: [], error: `Não foi possível conferir os clientes da planilha (${response.status}).` };
   const data = await response.json() as { sheets?: { data?: { rowData?: Parameters<typeof parseReceiptRoster>[0] }[] }[] };
   const rows = parseReceiptRoster(data.sheets?.[0]?.data?.[0]?.rowData ?? []);
   if (!rows.length) throw new Error("empty roster");
   cache = { expires: Date.now() + 300000, rows };
   return { rows, error: null };
  } catch { return { rows: [], error: "Não foi possível conferir os clientes da planilha. Tente atualizar novamente." }; }
 };
}
export const readReceiptRoster = createReceiptRosterReader();