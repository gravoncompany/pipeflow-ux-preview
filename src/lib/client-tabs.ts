import { Activity, Brain, Building2, ClipboardList, FileText, FolderKanban, History, LayoutDashboard, MessagesSquare, Target, Wallet } from "lucide-react";
export const CLIENT_TABS = [
  { key: "visao", label: "Visão geral", icon: LayoutDashboard }, { key: "cadastro", label: "Cadastro", icon: Building2 }, { key: "projetos", label: "Projetos", icon: FolderKanban }, { key: "historico", label: "Histórico", icon: History }, { key: "conhecimento", label: "Conhecimento", icon: Brain }, { key: "planejamento", label: "Planejamento", icon: Target }, { key: "documentos", label: "Documentos", icon: FileText }, { key: "conversas", label: "Conversas", icon: MessagesSquare }, { key: "registros", label: "Registros e Tarefas", icon: ClipboardList }, { key: "financeiro", label: "Financeiro", icon: Wallet }, { key: "posvenda", label: "Customer Success", icon: Activity },
] as const;
export type ClientTabKey = typeof CLIENT_TABS[number]["key"];
export const isClientTab = (v: unknown): v is ClientTabKey => CLIENT_TABS.some(t => t.key === v);
/**
 * As 11 abas da ficha agrupadas em 5 seções (Cadastro fica no botão do cabeçalho).
 * Endereços antigos (?aba=conversas, ?aba=financeiro…) continuam válidos e abrem a seção certa.
 */
export const CLIENT_GROUPS = [
  { key: "visao", label: "Visão geral", icon: LayoutDashboard, tabs: ["visao"] },
  { key: "relacionamento", label: "Relacionamento", icon: MessagesSquare, tabs: ["conversas", "registros", "historico"] },
  { key: "entregas", label: "Entregas", icon: FolderKanban, tabs: ["projetos", "planejamento", "documentos"] },
  { key: "financeiro", label: "Financeiro", icon: Wallet, tabs: ["financeiro"] },
  { key: "inteligencia", label: "Inteligência", icon: Brain, tabs: ["posvenda", "conhecimento"] },
] as const satisfies readonly { key: string; label: string; icon: unknown; tabs: readonly ClientTabKey[] }[];
export type ClientGroupKey = typeof CLIENT_GROUPS[number]["key"];
export type ClientSection = ClientTabKey | ClientGroupKey;
export const isClientSection = (v: unknown): v is ClientSection => isClientTab(v) || CLIENT_GROUPS.some((g) => g.key === v);

/** Resolve o valor de ?aba= para a seção (grupo) e a aba interna exibida. */
export function resolveClientSection(v: ClientSection | undefined): { group: ClientGroupKey; tab: ClientTabKey } {
  if (!v) return { group: "visao", tab: "visao" };
  if (v === "cadastro") return { group: "visao", tab: "cadastro" };
  const asGroup = CLIENT_GROUPS.find((g) => g.key === v);
  if (asGroup) return { group: asGroup.key, tab: asGroup.tabs[0] };
  const owner = CLIENT_GROUPS.find((g) => (g.tabs as readonly string[]).includes(v));
  return { group: owner?.key ?? "visao", tab: v as ClientTabKey };
}
