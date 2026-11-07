import type { ReactNode } from "react";
import { AreaLayout } from "@/components/crm/AreaLayout";
import { MARKETING_GROUPS } from "./marketing-nav";

/** Layout da área Marketing: menu lateral azul com os seis submenus, conteúdo à direita. */
export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <AreaLayout title="Marketing" groups={MARKETING_GROUPS} onLogout={() => { window.location.href = "/"; }}>
      <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </AreaLayout>
  );
}
