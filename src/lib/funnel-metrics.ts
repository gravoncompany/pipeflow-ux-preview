import { DEFAULT_STAGES } from "./crm-types";

export const FUNNEL_STEPS = [
  { key: "total", label: "Leads novos", from: null },
  { key: "resp", label: "Responderam", from: "contato-realizado" },
  { key: "qual", label: "Qualificados", from: "qualificacao" },
  { key: "reun", label: "Reunião agendada", from: "reuniao-agendada" },
  { key: "fech", label: "Fechados", from: "fechado" },
];

/** Entry-date cohort, measured by current stages, not historical transitions. */
export function funnelMetrics(total: number, stages: { stage: string; count: number }[]) {
  const order = DEFAULT_STAGES.map((s) => s.id);
  let previous = total;
  return FUNNEL_STEPS.map((step) => {
    const threshold = step.from ? order.indexOf(step.from) : -1;
    const count = step.from
      ? stages
          .filter((s) => s.stage !== "perda" && order.indexOf(s.stage) >= threshold)
          .reduce((n, s) => n + s.count, 0)
      : total;
    const row = {
      ...step,
      count,
      ofTotal: total ? (count / total) * 100 : 0,
      ofPrev: previous ? (count / previous) * 100 : 0,
      hasTotalBase: total > 0,
      hasPreviousBase: previous > 0,
    };
    previous = count;
    return row;
  });
}
