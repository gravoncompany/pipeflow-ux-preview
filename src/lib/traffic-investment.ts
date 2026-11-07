import { z } from "zod";

export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

/** Returns the YYYY-MM month key when the range covers exactly one calendar month, else null. */
export function fullMonthKey(from: string, to: string): string | null {
  const m = /^(\d{4})-(\d{2})-01$/.exec(from);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  return to === last ? `${m[1]}-${m[2]}` : null;
}

export type MediaCost = { status: "not-informed" | "no-conversions" | "ok"; value: number | null };

const cost = (investment: number | null, denominator: number): MediaCost => {
  if (investment == null) return { status: "not-informed", value: null };
  if (denominator === 0) return { status: "no-conversions", value: null };
  return { status: "ok", value: investment / denominator };
};

/** Media costs for the selected pipeline and period. Investment zero is a real value, distinct from not informed. */
export function mediaCosts(input: {
  investment: number | null;
  leads: number;
  qualified: number;
  meetings: number;
  clients: number;
}) {
  return {
    perLead: cost(input.investment, input.leads),
    perQualified: cost(input.investment, input.qualified),
    perMeeting: cost(input.investment, input.meetings),
    perClient: cost(input.investment, input.clients),
  };
}

export const mediaCostLabel = (c: MediaCost, brl: (v: number) => string) =>
  c.status === "not-informed" ? "Investimento não informado" : c.status === "no-conversions" ? "Sem conversões para calcular" : brl(c.value!);
