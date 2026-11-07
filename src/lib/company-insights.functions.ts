import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { saveIgResearchInput } from "./company-insights";

const leadId = z.string().uuid();

/** Card view: the saved analysis summary (full CRM access only). */
export const getCompanyInsight = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ leadId }).strict().parse(v))
  .handler(async ({ data }) => {
    const { deskLeadAccess } = await import("./lead-deskdata.server");
    const { level } = await deskLeadAccess(data.leadId, false);
    if (level !== "full") return { allowed: false as const, view: null };
    const { readInsight } = await import("./company-insights.server");
    return { allowed: true as const, view: await readInsight(data.leadId) };
  });

/** Runs one analysis on request. Reads only public sources; never changes the lead or sends anything. */
export const runCompanyInsight = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ leadId }).strict().parse(v))
  .handler(async ({ data }) => {
    const { deskLeadAccess } = await import("./lead-deskdata.server");
    await deskLeadAccess(data.leadId, true);
    const { analyzeCompany } = await import("./company-insights.server");
    return analyzeCompany(data.leadId);
  });

/** Bulk list: which of these cards already have an analysis. */
export const getCompanyInsightStatus = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ leadIds: z.array(leadId).max(200) }).strict().parse(v))
  .handler(async ({ data }) => {
    const { requireB2bAccess, b2bDb } = await import("./b2b-prospecting.server");
    await requireB2bAccess();
    if (!data.leadIds.length) return [];
    const r = await (await b2bDb()).from("b2b_company_insights").select("lead_id,status,analyzed_at").in("lead_id", data.leadIds);
    if (r.error) throw new Error("Status das análises indisponível.");
    return (r.data ?? []).map((x) => ({ leadId: x.lead_id as string, status: x.status as string, analyzedAt: x.analyzed_at as string | null }));
  });

export const getIgResearch = createServerFn({ method: "POST" }).handler(async () => {
  const { researchOverview } = await import("./company-insights.server");
  return researchOverview();
});
export const saveIgResearch = createServerFn({ method: "POST" }).inputValidator((i) => saveIgResearchInput.parse(i)).handler(async ({ data }) => {
  const { saveResearch } = await import("./company-insights.server");
  return saveResearch(data);
});
export const testIgResearch = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z0-9._]{1,30}$/, "Use só o nome do perfil, sem @.") }).strict().parse(i))
  .handler(async ({ data }) => {
    const { testResearch } = await import("./company-insights.server");
    return testResearch(data.username);
  });
export const removeIgResearch = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ revision: z.number().int().positive() }).strict().parse(i)).handler(async ({ data }) => {
  const { removeResearch } = await import("./company-insights.server");
  return removeResearch(data.revision);
});
