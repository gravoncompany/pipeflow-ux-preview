import type { ReactNode } from "react";
import { MapPin, Landmark, Upload, ClipboardCheck, Send, Instagram } from "lucide-react";
import { AreaLayout } from "./AreaLayout";
export const B2B_GROUPS = [{ items: [
  { to: "/prospeccao-b2b", label: "Google Maps", icon: MapPin },
  { to: "/prospeccao-b2b/instagram", label: "Instagram", icon: Instagram },
  { to: "/prospeccao-b2b/receita-federal", label: "Receita Federal", icon: Landmark },
  { to: "/prospeccao-b2b/importar-listas", label: "Importar Listas", icon: Upload },
  { to: "/prospeccao-b2b/revisar", label: "Revisar Selecionadas", icon: ClipboardCheck },
  { to: "/prospeccao-b2b/primeiro-contato", label: "Primeiro Contato", icon: Send },
] }] as const;
export function B2bLayout({ children }: { children: ReactNode }) {
  return <AreaLayout title="Prospecção B2B" groups={B2B_GROUPS}>{children}</AreaLayout>;
}