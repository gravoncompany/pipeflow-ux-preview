import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.object({ from: date, to: date }).refine((p) => p.from <= p.to, "Período inválido.");

/** Guarda compartilhada: exige sessão completa do CRM antes de qualquer leitura/escrita. */
async function guarded<T>(fn: (db: Awaited<ReturnType<typeof admin>>) => Promise<T>): Promise<T | { needsAuth: true }> {
  const { hasFullCrmSession } = await import("./crm-session.server");
  const secret = process.env["CRM_SESSION_SECRET"];
  if (!secret || !(await hasFullCrmSession(secret))) return { needsAuth: true as const };
  return fn(await admin());
}
async function admin() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }

export const getMarketingOverview = createServerFn({ method: "POST" }).inputValidator((i) => period.parse(i)).handler(({ data }) =>
  guarded(async (db) => (await import("./marketing.server")).marketingOverview(db, data.from, data.to)));

export const getMarketingCampaigns = createServerFn({ method: "POST" }).inputValidator((i) => period.parse(i)).handler(({ data }) =>
  guarded(async (db) => (await import("./marketing.server")).marketingCampaigns(db, data.from, data.to)));

export const getMarketingSources = createServerFn({ method: "POST" }).inputValidator((i) => period.parse(i)).handler(({ data }) =>
  guarded(async (db) => (await import("./marketing.server")).marketingSources(db, data.from, data.to)));

export const getMarketingFunnel = createServerFn({ method: "POST" }).inputValidator((i) => period.parse(i)).handler(({ data }) =>
  guarded(async (db) => (await import("./marketing.server")).marketingFunnel(db, data.from, data.to)));

export const getMarketingEvents = createServerFn({ method: "POST" }).inputValidator((i) => period.parse(i)).handler(({ data }) =>
  guarded(async (db) => (await import("./marketing.server")).marketingEvents(db, data.from, data.to)));

export const getMarketingAnalysis = createServerFn({ method: "POST" }).inputValidator((i) => period.parse(i)).handler(({ data }) =>
  guarded(async (db) => (await import("./marketing.server")).marketingAnalysis(db, data.from, data.to)));

export const getMarketingAiNarrative = createServerFn({ method: "POST" }).inputValidator((i) => period.parse(i)).handler(({ data }) =>
  guarded(async (db) => {
    const m = await import("./marketing.server");
    const analysis = await m.marketingAnalysis(db, data.from, data.to);
    return m.marketingAiNarrative({ periodo: data, achados: analysis.findings, visao: analysis.overview.summary, fontes: analysis.sources, funil: analysis.funnel.steps, eventos: analysis.eventSummary });
  }));

export const discoverMarketingAccounts = createServerFn({ method: "POST" }).handler(() =>
  guarded(async (db) => (await import("./marketing.server")).discoverIntegrations(db)));

export const setMarketingIntegration = createServerFn({ method: "POST" }).inputValidator((i) => z.object({
  platform: z.enum(["meta", "google"]), accountId: z.string().max(40), accountName: z.string().max(200), active: z.boolean(),
}).strict().parse(i)).handler(({ data }) =>
  guarded(async (db) => { await (await import("./marketing.server")).setIntegration(db, data); return { ok: true as const }; }));

export const saveMarketingEventMapping = createServerFn({ method: "POST" }).inputValidator((i) => z.object({
  id: z.string().uuid(), metaEvent: z.string().max(40), googleAction: z.string().max(80), active: z.boolean(),
}).strict().parse(i)).handler(({ data }) =>
  guarded(async (db) => { await (await import("./marketing.server")).saveEventMapping(db, data); return { ok: true as const }; }));
