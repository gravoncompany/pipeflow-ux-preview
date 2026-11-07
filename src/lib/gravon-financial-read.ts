import { z } from "zod";
import { FINANCE_YEAR, type FinanceMonth } from "./finance";
import { validateCountInput } from "./gravon-crm-read";

export const funnelInput = z.object({ startDate: z.string(), endDate: z.string() }).strict();
export const financeInput = z
  .object({ year: z.number().int(), startMonth: z.number().int(), endMonth: z.number().int() })
  .strict();
export type FunnelInput = z.infer<typeof funnelInput>;
export type FinanceInput = z.infer<typeof financeInput>;
export type FinanceGrant = {
  instance: string;
  phone: string;
  revision: string;
  readRevision: string;
  authorizedPhone: string;
};

export function validateFunnelInput(raw: unknown): FunnelInput {
  const input = funnelInput.parse(raw);
  validateCountInput({ stage: null, ...input });
  return input;
}
export function validateFinanceInput(raw: unknown): FinanceInput {
  const input = financeInput.parse(raw);
  if (
    input.year !== FINANCE_YEAR ||
    input.startMonth < 1 ||
    input.endMonth > 12 ||
    input.startMonth > input.endMonth
  )
    throw new Error("Somente meses de 2026 estão disponíveis.");
  return input;
}
export function financeProjection(months: FinanceMonth[], input: FinanceInput) {
  if (months.length !== 12) throw new Error("Meses indisponíveis.");
  const selected = months.slice(input.startMonth - 1, input.endMonth).map((m, i) => {
    if (
      !["value", "empty", "error"].includes(m.status) ||
      (m.status === "value" && (typeof m.value !== "number" || !Number.isFinite(m.value))) ||
      (m.status !== "value" && m.value !== null)
    )
      throw new Error("Valor inválido.");
    return {
      month: input.startMonth + i,
      label: m.month.slice(0, 40),
      value: m.value,
      status: m.status,
    };
  });
  const complete = selected.every((m) => m.status === "value");
  const knownSubtotal = selected.reduce((s, m) => s + (m.value ?? 0), 0);
  return { months: selected, complete, total: complete ? knownSubtotal : null, knownSubtotal };
}
