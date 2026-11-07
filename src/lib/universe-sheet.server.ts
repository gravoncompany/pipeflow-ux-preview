import { FINANCE_SPREADSHEET } from "./finance";
import { UNIVERSE_RANGES, parseUniverseSheet, type SheetMonth } from "./universe-sheet";

// Leitura somente leitura da planilha pelo conector Google Sheets do Lovable (mesmas credenciais do Financeiro, só no
// servidor). Cache curto; "forçar" ignora o cache (botão Sincronizar). Erros nunca viram valores.
export type UniverseSheetData = { revenue: SheetMonth[]; traffic: SheetMonth[]; syncedAt: string | null; error: string | null };
export function createUniverseSheetReader(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: { expires: number; data: UniverseSheetData } | null = null;
  return async (gatewayKey: string | undefined, sheetsKey: string | undefined, force = false): Promise<UniverseSheetData> => {
    const empty = (error: string): UniverseSheetData => ({ revenue: [], traffic: [], syncedAt: null, error });
    if (!gatewayKey || !sheetsKey) return empty("A conexão com o Google Sheets não está disponível no servidor.");
    if (!force && cached && cached.expires > now()) return cached.data;
    const url = new URL(`https://connector-gateway.lovable.dev/google_sheets/v4/spreadsheets/${FINANCE_SPREADSHEET}/values:batchGet`);
    for (const range of [UNIVERSE_RANGES.months, UNIVERSE_RANGES.revenue, UNIVERSE_RANGES.traffic]) url.searchParams.append("ranges", range);
    url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    try {
      const response = await fetcher(url, { headers: { Authorization: `Bearer ${gatewayKey}`, "X-Connection-Api-Key": sheetsKey }, signal: AbortSignal.timeout(10_000), redirect: "manual" });
      if (!response.ok) { await response.body?.cancel(); return empty(`Não foi possível ler o Google Sheets (HTTP ${response.status}).`); }
      const data = (await response.json()) as { valueRanges?: { values?: unknown[][] }[] };
      const parsed = parseUniverseSheet(data.valueRanges?.[0]?.values?.[0] ?? [], data.valueRanges?.[1]?.values ?? [], data.valueRanges?.[2]?.values ?? []);
      if (!parsed.ok) return empty(parsed.error);
      const result: UniverseSheetData = { revenue: parsed.revenue, traffic: parsed.traffic, syncedAt: new Date(now()).toISOString(), error: null };
      cached = { expires: now() + 60_000, data: result };
      return result;
    } catch { return empty("Não foi possível ler a planilha agora. Tente sincronizar novamente."); }
  };
}
const reader = createUniverseSheetReader();
export function readUniverseSheet(force = false) { return reader(process.env.LOVABLE_API_KEY, process.env.GOOGLE_SHEETS_API_KEY, force); }
