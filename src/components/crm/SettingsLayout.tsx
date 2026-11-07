import type { ReactNode } from "react";
import { AreaLayout } from "@/components/crm/AreaLayout";

export { SETTINGS_GROUPS } from "./settings-nav";
import { SETTINGS_GROUPS } from "./settings-nav";

/** Casca das páginas de Configurações: menu principal + menu branco lateral + conteúdo à direita. */
export function SettingsLayout({ children }: { children: ReactNode }) {
  return <AreaLayout title="Configurações" groups={SETTINGS_GROUPS}>{children}</AreaLayout>;
}
