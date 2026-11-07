import type { Lead } from "./crm-types";

/** Etapas que encerram a negociação: não entram no Potencial. */
export const CLOSED_STAGE = "fechado";
const FINISHED_STAGES = new Set([CLOSED_STAGE, "perda"]);

export type PipelineTotals = { totalLeads: number; closed: number; potential: number; closedValue: number; pendingClosedValue: number };

/**
 * Indicadores do topo do Pipeline, calculados sobre os cards exibidos (funil + filtros).
 * Potencial = valores estimados das negociações em aberto; Valor fechado = valores confirmados em Fechado.
 */
export function pipelineTotals(leads: Pick<Lead, "stage" | "potentialValue" | "closedValue">[]): PipelineTotals {
  let closed = 0, potential = 0, closedValue = 0, pendingClosedValue = 0;
  for (const l of leads) {
    if (l.stage === CLOSED_STAGE) {
      closed += 1;
      if (l.closedValue === null || l.closedValue === undefined) pendingClosedValue += 1;
      else closedValue += l.closedValue;
    } else if (!FINISHED_STAGES.has(l.stage)) potential += l.potentialValue || 0;
  }
  return { totalLeads: leads.length, closed, potential, closedValue, pendingClosedValue };
}
