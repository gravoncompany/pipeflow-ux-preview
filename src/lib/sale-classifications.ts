import { z } from "zod";

/** Sale classification shared helpers — browser-safe, no server imports. */

export const SALE_TYPES = [
  { id: "novo", label: "Cliente novo" },
  { id: "renovacao", label: "Renovação" },
  { id: "adicional", label: "Venda adicional" },
] as const;

export type SaleType = (typeof SALE_TYPES)[number]["id"];
export const saleTypeSchema = z.enum(["novo", "renovacao", "adicional"]);
export const saleTypeLabel = (t: SaleType) => SALE_TYPES.find((s) => s.id === t)?.label ?? t;

export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
/** "main" = original pipeline (pipeline_id null); otherwise a sales_pipelines uuid. */
export const pipelineKey = z.union([z.literal("main"), z.string().uuid()]);

export type ClosingRow = {
  leadId: string;
  name: string;
  company: string;
  customerKey: string;
  entryDate: string;
  closedAt: string | null;
  dateBasis: "closed_at" | "entry_date";
  potentialValue: number;
  saleType: SaleType | null;
  firstAcquisition: boolean | null;
  closedOn: string | null;
  classifiedBy: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  revision: number | null;
};

export type SaleReview = {
  closings: ClosingRow[];
  pending: number;
  newCustomers: number;
};

/** Effective closing date for period filtering: recorded transition date, else entry date. */
export function closingDate(lead: { closed_at: string | null; entry_date: string }): {
  date: string;
  basis: "closed_at" | "entry_date";
} {
  return lead.closed_at
    ? { date: lead.closed_at, basis: "closed_at" }
    : { date: lead.entry_date, basis: "entry_date" };
}

export function inPeriod(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/**
 * Unique new customers: distinct customers whose confirmed FIRST acquisition
 * (sale_type novo + first_acquisition) happened in the period, in the selected
 * pipeline, on a lead still closed. Renewals and add-on sales never count;
 * a customer counts once even with opportunities in several funnels.
 */
export function countNewCustomers(
  rows: { customerKey: string; saleType: SaleType; firstAcquisition: boolean; closedOn: string }[],
  from: string,
  to: string,
): number {
  const keys = rows
    .filter((r) => r.saleType === "novo" && r.firstAcquisition && inPeriod(r.closedOn, from, to))
    .map((r) => r.customerKey);
  return new Set(keys).size;
}

export type FirstAcquisitionDecision =
  | { conflict: false; firstAcquisition: boolean }
  | { conflict: true };

/**
 * A customer counts as new only at the first confirmed acquisition.
 * Prior confirmed first acquisition → warn and require explicit review;
 * if the user keeps "cliente novo" anyway, it is stored but never counts as first.
 */
export function decideFirstAcquisition(
  saleType: SaleType,
  priorFirstAcquisitions: number,
  confirmedAfterWarning: boolean,
): FirstAcquisitionDecision {
  if (saleType !== "novo") return { conflict: false, firstAcquisition: false };
  if (priorFirstAcquisitions === 0) return { conflict: false, firstAcquisition: true };
  if (!confirmedAfterWarning) return { conflict: true };
  return { conflict: false, firstAcquisition: false };
}
