import { FolderOpen, Target, Wallet } from "lucide-react";

export const MANAGEMENT_GROUP = { items: [
  { to: "/metas", label: "Metas Comerciais", icon: Target },
  { to: "/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/projetos", label: "Projetos", icon: FolderOpen },
] } as const;
export const isManagementPath = (path: string) => ["/metas", "/financeiro", "/projetos"].some((p) => path === p || path.startsWith(`${p}/`));