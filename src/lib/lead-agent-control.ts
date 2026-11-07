// Browser-safe status of the per-contact Gravon IA control (0088). The order mirrors claim_crm_agent:
// funnel configuration and authorized numbers come first; the individual control can only restrict, never widen.
export type AgentControlMode = "active" | "paused" | "disabled";
export type LeadAgentState =
  | "no_lead" | "ambiguous" | "funnel_off" | "funnel_blocked" | "not_authorized" | "stage_not_allowed"
  | "disabled" | "paused" | "human" | "human_recent" | "outside_hours" | "active";
export type LeadAgentTone = "on" | "paused" | "off" | "human" | "neutral";

export type LeadAgentInput = {
  cards: number;
  funnel: { enabled: boolean; blocked: boolean; authorized: boolean; stageAllowed: boolean; openNow: boolean } | null;
  control: { mode: AgentControlMode; pausedUntil: string | null } | null;
  hold: boolean;
  humanRecent: boolean;
  now: Date;
};

/** A pause whose deadline has passed no longer restricts the contact. */
export function effectiveMode(control: LeadAgentInput["control"], now: Date): AgentControlMode {
  if (!control) return "active";
  if (control.mode === "paused") return control.pausedUntil && new Date(control.pausedUntil) > now ? "paused" : "active";
  return control.mode;
}

export function leadAgentState(i: LeadAgentInput): { state: LeadAgentState; label: string; tone: LeadAgentTone } {
  const mode = effectiveMode(i.control, i.now);
  if (i.cards === 0) return { state: "no_lead", label: "Sem card no CRM", tone: "neutral" };
  if (i.cards > 1) return { state: "ambiguous", label: "Mais de um card com agente; IA não responde", tone: "off" };
  if (!i.funnel || !i.funnel.enabled) return { state: "funnel_off", label: "Agente do funil desligado", tone: "off" };
  if (i.funnel.blocked) return { state: "funnel_blocked", label: "Agente do funil pausado", tone: "paused" };
  if (!i.funnel.authorized) return { state: "not_authorized", label: "Número fora dos autorizados do teste", tone: "off" };
  if (!i.funnel.stageAllowed) return { state: "stage_not_allowed", label: "Etapa do card não autorizada", tone: "off" };
  if (mode === "disabled") return { state: "disabled", label: "Desativada para este lead", tone: "off" };
  if (mode === "paused") return { state: "paused", label: "Pausada para este lead", tone: "paused" };
  if (i.hold) return { state: "human", label: "Em atendimento humano", tone: "human" };
  if (i.humanRecent) return { state: "human_recent", label: "Pausada: atendimento humano recente", tone: "human" };
  if (!i.funnel.openNow) return { state: "outside_hours", label: "Fora do horário de atendimento", tone: "paused" };
  return { state: "active", label: "Atendimento automático ativo", tone: "on" };
}

export const PAUSE_OPTIONS = [1, 4, 24, 72] as const;
