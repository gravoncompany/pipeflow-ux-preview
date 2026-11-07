import { createServerFn } from "@tanstack/react-start";

export type AgentFunnelSummary = { pipelineId: string | null; name: string; enabled: boolean; audience: "test" | "all"; blocked: boolean };

/** Lists every active funnel (Funil principal + additional pipelines) with its own agent state, for the panel's funnel selector. */
export const getCommercialAgentOverview = createServerFn({ method: "POST" }).handler(async () => {
  const { crmAdmin, withAdminAccess } = await import("./crm-agent-admin.server");
  return withAdminAccess(async () => {
    const a = await crmAdmin();
    const [pipes, settings] = await Promise.all([
      a.db.from("sales_pipelines").select("id,name,created_at").eq("archived", false).order("created_at", { ascending: true }),
      a.db.from("crm_agent_settings").select("pipeline_id,enabled,audience,blocked_reason"),
    ]);
    if (pipes.error || settings.error) throw new Error("Não foi possível carregar os funis do agente.");
    const byPipe = new Map<string | null, any>(((settings.data ?? []) as any[]).map((s) => [s.pipeline_id ?? null, s]));
    const summary = (pipelineId: string | null, name: string): AgentFunnelSummary => {
      const s = byPipe.get(pipelineId);
      return { pipelineId, name, enabled: s?.enabled === true, audience: s?.audience === "all" ? "all" : "test", blocked: Boolean(s?.blocked_reason) };
    };
    const funnels = [summary(null, "Funil principal"), ...((pipes.data ?? []) as any[]).map((p) => summary(String(p.id), String(p.name)))];
    return { funnels };
  });
});
