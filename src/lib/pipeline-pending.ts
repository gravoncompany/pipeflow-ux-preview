// Pipeline shortcuts reuse the Dashboard "Hoje" lists (same rules, computed server-side) restricted to the open funnel.
import type { DashboardToday } from "./dashboard-today";

export type PendingFilter = "awaiting" | "today" | "overdue";

export function pendingIdsFor(today: Pick<DashboardToday, "awaiting" | "returnsToday" | "overdue"> | null, funnelLeadIds: string[]): Record<PendingFilter, Set<string>> {
  const inFunnel = new Set(funnelLeadIds);
  const pick = (rows: { id: string }[] | undefined) => new Set((rows ?? []).map((r) => r.id).filter((id) => inFunnel.has(id)));
  return { awaiting: pick(today?.awaiting), today: pick(today?.returnsToday), overdue: pick(today?.overdue) };
}
