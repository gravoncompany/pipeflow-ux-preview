import { BarChart3, LayoutDashboard, Megaphone, Route as RouteIcon, Share2, Sparkles } from "lucide-react";
import type { AreaMenuGroup } from "@/components/crm/AreaLayout";

export const MARKETING_GROUPS: readonly AreaMenuGroup[] = [
  {
    items: [
      { to: "/marketing", label: "Visão Geral", icon: LayoutDashboard },
      { to: "/marketing/campanhas", label: "Campanhas", icon: Megaphone },
      { to: "/marketing/fontes", label: "Fontes de Aquisição", icon: Share2 },
      { to: "/marketing/funil", label: "Funil de Conversão", icon: RouteIcon },
      { to: "/marketing/eventos", label: "Eventos e Conversões", icon: BarChart3 },
      { to: "/marketing/analises", label: "Análises IA", icon: Sparkles },
    ],
  },
] as const;
