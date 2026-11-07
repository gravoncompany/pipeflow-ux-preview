import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filter = z.object({ companyKey: z.string().regex(/^crm:\d+$/).optional(), from: date.optional(), to: date.optional() })
  .refine((f) => !f.from || !f.to || f.from <= f.to, "Período inválido.");

export const listMetaConversions = createServerFn({ method: "POST" }).inputValidator((i) => filter.parse(i)).handler(async ({ data }) => {
  const { hasFullCrmSession } = await import("./crm-session.server");
  const secret = process.env["CRM_SESSION_SECRET"];
  if (!secret || !(await hasFullCrmSession(secret))) return { needsAuth: true as const };
  const { listConversions } = await import("./meta-capi-monitor.server");
  return { needsAuth: false as const, ...(await listConversions(data)) };
});

export const getMetaConversion = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i)).handler(async ({ data }) => {
  const { conversionDetail } = await import("./meta-capi-monitor.server");
  return conversionDetail(data.id);
});

export const retryMetaConversion = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i)).handler(async ({ data }) => {
  const { retryConversion } = await import("./meta-capi-monitor.server");
  return retryConversion(data.id);
});
