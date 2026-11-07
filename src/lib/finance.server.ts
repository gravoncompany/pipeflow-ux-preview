import {
  FINANCE_SPREADSHEET,
  FINANCE_MONTH_RANGE,
  FINANCE_REVENUE_RANGE,
  FINANCE_TRAFFIC_RANGE,
  mapFinanceMonths,
  type FinanceMonth,
} from "./finance";

export type FinanceResponse = {
  months: FinanceMonth[];
  traffic: FinanceMonth[];
  updatedAt: string | null;
  error: string | null;
  needsAuth: boolean;
};

/** Callers MUST authorize before invoking this reader, including cache hits. */
export function createFinanceReader(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: { expires: number; result: FinanceResponse } | null = null;
  return async (
    gatewayKey: string | undefined,
    sheetsKey: string | undefined,
  ): Promise<FinanceResponse> => {
    if (!gatewayKey || !sheetsKey)
      return {
        months: [],
        traffic: [],
        updatedAt: null,
        error: "A conexão com o Google Sheets não está disponível.",
        needsAuth: false,
      };
    if (cached && cached.expires > now()) return cached.result;
    const url = new URL(
      `https://connector-gateway.lovable.dev/google_sheets/v4/spreadsheets/${FINANCE_SPREADSHEET}/values:batchGet`,
    );
    for (const range of [FINANCE_MONTH_RANGE, FINANCE_REVENUE_RANGE, FINANCE_TRAFFIC_RANGE])
      url.searchParams.append("ranges", range);
    url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    try {
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${gatewayKey}`, "X-Connection-Api-Key": sheetsKey },
      });
      if (!response.ok) {
        console.error(`Google Sheets [${response.status}]: ${await response.text()}`);
        return {
          months: [],
          traffic: [],
          updatedAt: null,
          error: `Não foi possível ler o Google Sheets (${response.status}).`,
          needsAuth: false,
        };
      }
      const data = (await response.json()) as { valueRanges?: { values?: unknown[][] }[] };
      const labels = data.valueRanges?.[0]?.values?.[0];
      if (!labels || labels.length !== 12) throw new Error("Os 12 meses não foram encontrados.");
      const result: FinanceResponse = {
        months: mapFinanceMonths(labels, data.valueRanges?.[1]?.values?.[0] ?? []),
        traffic: mapFinanceMonths(labels, data.valueRanges?.[2]?.values?.[0] ?? [], 55),
        updatedAt: new Date(now()).toISOString(),
        error: null,
        needsAuth: false,
      };
      cached = { expires: now() + 60_000, result };
      return result;
    } catch {
      return {
        months: [],
        traffic: [],
        updatedAt: null,
        error: "Não foi possível ler a planilha. Tente atualizar novamente.",
        needsAuth: false,
      };
    }
  };
}

const reader = createFinanceReader();
export async function readFinance(): Promise<FinanceResponse> {
  return reader(process.env.LOVABLE_API_KEY, process.env.GOOGLE_SHEETS_API_KEY);
}
