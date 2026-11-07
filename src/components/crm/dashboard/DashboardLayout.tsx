import type { ReactNode } from "react";
import { LayoutDashboard, LineChart } from "lucide-react";
import { AreaLayout } from "@/components/crm/AreaLayout";

/** Área Dashboard: Visão geral abre primeiro; Insights mostra uma análise por vez. */
export const DASHBOARD_GROUPS = [
  { items: [
    { to: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
    { to: "/dashboard/insights", label: "Insights", icon: LineChart },
  ] },
] as const;

export function DashboardLayout({ children }: { children: ReactNode }) {
  return <AreaLayout title="Dashboard" groups={DASHBOARD_GROUPS}>{children}</AreaLayout>;
}
