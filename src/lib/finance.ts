export const FINANCE_YEAR = 2026;
export const FINANCE_SHEET = "2026";
export const FINANCE_MONTH_RANGE = "'2026'!D1:O1";
export const FINANCE_REVENUE_RANGE = "'2026'!D52:O52";
export const FINANCE_TRAFFIC_RANGE = "'2026'!D55:O55";
export const FINANCE_SPREADSHEET = "1IgEXlYyPR8DbTu_DI7X3EC7T7pkxy54beG5Sy66-Qqk";

export type FinanceMonth = { month: string; short: string; value: number | null; status: "value" | "empty" | "error"; cell: string };

export function mapFinanceMonths(labels: unknown[], values: unknown[], row = 52): FinanceMonth[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = String(labels[i] ?? "").trim();
    const raw = values[i];
    const valid = typeof raw === "number" && Number.isFinite(raw);
    return {
      month,
      short: month.slice(0, 3),
      value: valid ? raw : null,
      status: valid ? "value" : raw == null || raw === "" ? "empty" : "error",
      cell: `${String.fromCharCode(68 + i)}${row}`,
    };
  });
}