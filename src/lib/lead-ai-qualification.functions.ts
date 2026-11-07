import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { QualificationView } from "./lead-ai-qualification";

async function access() {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  return Boolean(secret && (await hasFullCrmSession(secret)));
}

/** Status map for the Pipeline cards (only leads that entered Qualificação in the main funnel). */
export const listLeadQualifications = createServerFn({ method: "POST" }).handler(async () => {
  if (!(await access())) return { authorized: false as const, statuses: {} as Record<string, "em_analise" | "qualificado">, meta: {} as Record<string, string> };
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const [{ data, error }, { data: events }] = await Promise.all([
    db.from("lead_ai_qualifications").select("lead_id,status").limit(5000),
    db.from("meta_capi_lead_events").select("lead_id,status").eq("company_key", "crm:1").eq("event_name", "QualifiedLead").limit(5000),
  ]);
  if (error) throw new Error("Não foi possível ler a qualificação da Gravon IA.");
  const meta: Record<string, string> = {};
  for (const e of events ?? []) meta[e.lead_id] = e.status;
  const statuses: Record<string, "em_analise" | "qualificado"> = {};
  for (const r of data ?? []) statuses[r.lead_id] = r.status === "qualificado" ? "qualificado" : "em_analise";
  return { authorized: true as const, statuses, meta };
});

export const getLeadQualification = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ leadId: z.string().uuid() }).parse(i))
  .handler(async ({ data }): Promise<{ authorized: boolean; view: QualificationView | null }> => {
    if (!(await access())) return { authorized: false, view: null };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const [{ data: q, error }, { data: ev }] = await Promise.all([
      db.from("lead_ai_qualifications").select("status,state,summary,fit_reason,evidence,assessed_at,qualified_at").eq("lead_id", data.leadId).maybeSingle(),
      db.from("meta_capi_lead_events").select("status,pixel_id").eq("lead_id", data.leadId).eq("event_name", "QualifiedLead").maybeSingle(),
    ]);
    if (error) throw new Error("Não foi possível ler a qualificação da Gravon IA.");
    if (!q) return { authorized: true, view: null };
    const evidence = z.array(z.object({ messageId: z.string(), quote: z.string() })).safeParse(q.evidence);
    return { authorized: true, view: {
      status: q.status === "qualificado" ? "qualificado" : "em_analise", state: q.state, summary: q.summary, fitReason: q.fit_reason,
      evidence: evidence.success ? evidence.data : [], assessedAt: q.assessed_at, qualifiedAt: q.qualified_at,
      meta: ev ? { status: ev.status, pixelId: ev.pixel_id } : null,
    } };
  });

/** Summary for the Meta settings page. */
export const getQualifiedLeadEventsSummary = createServerFn({ method: "POST" }).handler(async () => {
  if (!(await access())) return { authorized: false as const, counts: {} as Record<string, number> };
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data, error } = await db.from("meta_capi_lead_events").select("status").eq("event_name", "QualifiedLead").limit(10000);
  if (error) throw new Error("Não foi possível ler os eventos preparados.");
  const counts: Record<string, number> = {};
  for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { authorized: true as const, counts };
});
