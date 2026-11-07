// Período do Dashboard guardado no endereço, para Visão geral e Insights usarem o mesmo filtro.
import { PERIOD_PRESETS, presetRange, type PeriodPreset } from "./dashboard";

export type DashboardSearch = { p?: PeriodPreset; de?: string; ate?: string };
export const INSIGHT_TABS = ["funis", "outbound", "ia"] as const;
export type InsightTab = (typeof INSIGHT_TABS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDashboardSearch(search: Record<string, unknown>): DashboardSearch {
  const p = PERIOD_PRESETS.some((x) => x.id === search.p) ? (search.p as PeriodPreset) : undefined;
  const de = typeof search.de === "string" && DAY.test(search.de) ? search.de : undefined;
  const ate = typeof search.ate === "string" && DAY.test(search.ate) ? search.ate : undefined;
  return { p, de, ate };
}

/** Período efetivo: padrão "Últimos 30 dias"; o personalizado só vale com datas válidas e em ordem. */
export function resolvePeriod(s: DashboardSearch, today: string): { from: string; to: string } | null {
  if (!today) return null;
  const preset = s.p ?? "30d";
  if (preset !== "custom") return presetRange(preset, today);
  return s.de && s.ate && s.de <= s.ate ? { from: s.de, to: s.ate } : null;
}
