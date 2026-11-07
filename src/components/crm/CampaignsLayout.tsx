import type { ReactNode } from "react";
import { Mail, MessageCircle, Workflow, Zap } from "lucide-react";
import { AreaLayout } from "@/components/crm/AreaLayout";

/** Área Campanhas: e-mail e WhatsApp separados, com Fluxos de E-mail e Automações no mesmo submenu. */
export const CAMPAIGN_GROUPS = [
  { label: "Campanhas", items: [
    { to: "/campanhas", label: "Campanhas de E-mail", icon: Mail },
    { to: "/campanhas/whatsapp", label: "Campanhas de WhatsApp", icon: MessageCircle },
  ] },
  { label: "Automação", items: [
    { to: "/fluxos-email", label: "Fluxos de E-mail", icon: Workflow },
    { to: "/automacoes", label: "Automações", icon: Zap, nested: true },
  ] },
] as const;

export function CampaignsLayout({ children }: { children: ReactNode }) {
  return <AreaLayout title="Campanhas" groups={CAMPAIGN_GROUPS}>{children}</AreaLayout>;
}
