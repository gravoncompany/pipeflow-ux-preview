import type { PROJECT_STATUSES } from "./crm-projects";

// Melhorias do Pipeflow: as telas agrupam os status já existentes dos projetos internos.
// Bloqueado fica em Pendentes (ainda não está andando); Em teste conta como Em andamento.
type Status = keyof typeof PROJECT_STATUSES;
export type ImprovementView = "pendentes" | "andamento" | "concluidas";

export const IMPROVEMENT_VIEWS: readonly { key: ImprovementView; to: string; label: string; statuses: readonly Status[] }[] = [
  { key: "pendentes", to: "/projetos", label: "Pendentes", statuses: ["planejado", "bloqueado", "em_desenvolvimento", "em_teste"] },
  { key: "andamento", to: "/projetos/em-andamento", label: "Em andamento", statuses: ["em_desenvolvimento", "em_teste"] },
  { key: "concluidas", to: "/projetos/concluidas", label: "Concluídas", statuses: ["concluido"] },
];

// O menu de Projetos mostra só Pendentes e Concluídas; Em andamento segue acessível pelo link direto.
export const MENU_VIEWS = IMPROVEMENT_VIEWS.filter((v) => v.key !== "andamento");

export const improvementStatuses = (view: ImprovementView): readonly Status[] =>
  IMPROVEMENT_VIEWS.find((v) => v.key === view)?.statuses ?? [];

export const nextStepLabel = (nextAction: string | null | undefined) => nextAction?.trim() || "A definir";
