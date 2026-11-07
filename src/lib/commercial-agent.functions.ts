import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { agentError, agentSettingsInput, withinBusinessHours } from "./commercial-agent";
import { mainFunnelStages } from "./reference-messages";
import { pipelineStages } from "./pipelines";
import type { Stage } from "./crm-types";

export type AgentRunView = { id: string; leadId: string | null; phone: string; status: string; reason: string | null; reply: string | null; decision: string | null; qualification: string | null; createdAt: string };
export type AgentHoldView = { contactKey: string; phone: string; reason: string; updatedAt: string };
export type AgentAuditView = { event: string; reason: string | null; createdAt: string };

const pipelineKey = z.object({ pipelineId: z.string().uuid().nullable() }).strict();

export type AgentSettingsView = {
  revision: number; enabled: boolean; audience: "test" | "all"; instance: string; senderPhone: string; recipients: string[]; allowedStages: string[];
  instructions: string; servedRegions: string[]; excludedRegions: string[]; services: string[]; requirements: string;
  stageMap: { novo?: string; atendimento?: string; qualificado?: string }; autoMove: boolean; moveStages: string[] | null; handoffKeywords: string[]; pauseOnHumanReply: boolean;
  humanPauseHours: number; businessDays: number[]; dayStart: string; dayEnd: string; maxRepliesPerContactDay: number; maxRepliesPerDay: number;
  maxReplyChars: number; maxMessageAgeMinutes: number; blockedReason: string | null; updatedAt: string | null;
};
export const DEFAULT_AGENT_SETTINGS: AgentSettingsView = {
  revision: 0, enabled: false, audience: "test", instance: "", senderPhone: "", recipients: [], allowedStages: [], instructions: "",
  servedRegions: [], excludedRegions: [], services: [], requirements: "", stageMap: {}, autoMove: true, moveStages: null, handoffKeywords: [], pauseOnHumanReply: true,
  humanPauseHours: 24, businessDays: [1, 2, 3, 4, 5], dayStart: "08:00", dayEnd: "18:00", maxRepliesPerContactDay: 10, maxRepliesPerDay: 100,
  maxReplyChars: 600, maxMessageAgeMinutes: 10, blockedReason: null, updatedAt: null,
};
const hhmm = (t: string) => String(t ?? "").slice(0, 5);
function view(row: any): AgentSettingsView {
  if (!row) return DEFAULT_AGENT_SETTINGS;
  return { revision: Number(row.revision), enabled: row.enabled, audience: row.audience, instance: row.instance, senderPhone: row.sender_phone, recipients: row.recipients ?? [],
    allowedStages: row.allowed_stages ?? [], instructions: row.instructions ?? "", servedRegions: row.served_regions ?? [], excludedRegions: row.excluded_regions ?? [],
    services: row.services ?? [], requirements: row.qualification_requirements ?? "", stageMap: row.stage_map ?? {}, autoMove: row.auto_move, moveStages: row.move_stages ?? null,
    handoffKeywords: row.handoff_keywords ?? [], pauseOnHumanReply: row.pause_on_human_reply, humanPauseHours: row.human_pause_hours,
    businessDays: row.business_days ?? [], dayStart: hhmm(row.day_start), dayEnd: hhmm(row.day_end), maxRepliesPerContactDay: row.max_replies_per_contact_day,
    maxRepliesPerDay: row.max_replies_per_day, maxReplyChars: row.max_reply_chars, maxMessageAgeMinutes: row.max_message_age_minutes,
    blockedReason: row.blocked_reason ?? null, updatedAt: row.updated_at ?? null };
}
export const maskPhone = (p: string) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length < 6 ? "••••" : `${d.slice(0, d.length - 8)} •••• ${d.slice(-4)}`; };

async function stagesOf(db: any, pipelineId: string | null): Promise<{ name: string; stages: Stage[] }> {
  if (pipelineId === null) return { name: "Funil principal", stages: mainFunnelStages() };
  const { data, error } = await db.from("sales_pipelines").select("name,stages").eq("id", pipelineId).eq("archived", false).maybeSingle();
  if (error || !data) throw new Error("Funil não encontrado ou arquivado.");
  return { name: data.name, stages: pipelineStages.parse(data.stages) };
}

export const getCommercialAgent = createServerFn({ method: "POST" }).inputValidator((i) => pipelineKey.parse(i)).handler(async ({ data }) => {
  const { crmAgentAdmin, withAdminAccess } = await import("./crm-agent-admin.server");
  return withAdminAccess(async () => {
  const a = await crmAgentAdmin();
  const funnel = await stagesOf(a.db, data.pipelineId);
  const base = a.db.from("crm_agent_settings").select("*");
  const { data: row, error } = await (data.pipelineId === null ? base.is("pipeline_id", null) : base.eq("pipeline_id", data.pipelineId)).maybeSingle();
  if (error) {
    const { isMissingSchema, MIGRATIONS_PENDING } = await import("./crm-agent-access");
    console.error("commercial_agent_load_failed", { code: String(error.code ?? "").slice(0, 12) });
    throw new Error(isMissingSchema(error) ? MIGRATIONS_PENDING : "Não foi possível carregar o agente deste funil.");
  }
  const settings = view(row);
  // Brazil has no DST since 2019: São Paulo midnight is always -03:00.
  const dayStart = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })}T00:00:00-03:00`).toISOString();
  const [runs, holds, audit, knowledge] = row ? await Promise.all([
    a.db.from("crm_agent_runs").select("id,lead_id,phone,status,reason,reply,decision_result,created_at,analysis").eq("settings_id", row.id).order("created_at", { ascending: false }).limit(25),
    a.db.from("crm_agent_holds").select("contact_key,reason,updated_at").eq("active", true).order("updated_at", { ascending: false }).limit(50),
    a.db.from("crm_agent_audit").select("event,detail,created_at").eq("settings_id", row.id).order("created_at", { ascending: false }).limit(30),
    a.db.from("ai_knowledge").select("id", { count: "exact", head: true }).eq("company_key", "crm:1").eq("entry_type", "manual"),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, await a.db.from("ai_knowledge").select("id", { count: "exact", head: true }).eq("company_key", "crm:1").eq("entry_type", "manual")];
  if ([runs, holds, audit, knowledge].some((q: any) => q.error)) throw new Error("Não foi possível carregar o status do agente.");
  const today = (runs.data ?? []).filter((r: any) => r.created_at >= dayStart);
  return {
    pipelineId: data.pipelineId, pipelineName: funnel.name, stages: funnel.stages, settings,
    channels: a.channels.map((c) => ({ instance: c.instance, phone: c.phone, masked: maskPhone(c.phone) })),
    knowledgeCount: knowledge.count ?? 0,
    openNow: withinBusinessHours(new Date(), settings.businessDays, settings.dayStart, settings.dayEnd),
    today: { answered: today.filter((r: any) => ["accepted", "completed"].includes(r.status)).length, human: today.filter((r: any) => r.status === "human").length, skipped: today.filter((r: any) => r.status === "skipped").length },
    runs: ((runs.data ?? []) as any[]).map((r: any): AgentRunView => ({ id: r.id, leadId: r.lead_id, phone: maskPhone(r.phone), status: r.status, reason: r.reason, reply: r.reply, decision: r.decision_result,
      qualification: r.analysis?.qualification?.status ?? null, createdAt: r.created_at })),
    holds: ((holds.data ?? []) as any[]).map((h: any): AgentHoldView => ({ contactKey: h.contact_key as string, phone: maskPhone(h.contact_key), reason: h.reason as string, updatedAt: h.updated_at as string })),
    audit: ((audit.data ?? []) as any[]).map((e: any): AgentAuditView => ({ event: e.event as string, reason: (e.detail?.reason ?? e.detail?.result ?? null) as string | null, createdAt: e.created_at as string })),
  };
  });
});

export const saveCommercialAgent = createServerFn({ method: "POST" }).inputValidator((i) => agentSettingsInput.parse(i)).handler(async ({ data }) => {
  const { crmAgentAdmin } = await import("./crm-agent-admin.server");
  const a = await crmAgentAdmin();
  const funnel = await stagesOf(a.db, data.pipelineId);
  const ids = new Set(funnel.stages.map((s) => s.id));
  if (data.allowedStages.some((s) => !ids.has(s)) || Object.values(data.stageMap).some((s) => s && !ids.has(s)) || (data.moveStages ?? []).some((s) => !ids.has(s))) throw new Error("Há etapas que não existem neste funil.");
  let senderPhone = "";
  if (data.instance) {
    const channel = a.channels.find((c) => c.instance === data.instance);
    if (!channel) throw new Error("Escolha um WhatsApp vinculado à sua conta administrativa.");
    senderPhone = channel.phone;
  }
  if (data.enabled) {
    const { verifyLiveSender } = await import("./commercial-agent.server");
    try { await verifyLiveSender(data.instance, senderPhone); }
    catch { throw new Error("O WhatsApp escolhido não está conectado com o número vinculado à sua conta. Nada foi ativado."); }
  }
  const { pipelineId, revision, ...config } = data;
  const { data: row, error } = await a.db.rpc("save_crm_agent_settings", { p_actor: a.userId, p_pipeline: pipelineId, p_revision: revision, p_config: { ...config, senderPhone } });
  if (error) {
    const { isMissingSchema, MIGRATIONS_PENDING } = await import("./crm-agent-access");
    throw new Error(isMissingSchema(error) ? MIGRATIONS_PENDING : agentError(error));
  }
  return view(row);
});

export const releaseCommercialAgentHold = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ contactKey: z.string().regex(/^\d{8,12}$/), confirmed: z.literal(true) }).strict().parse(i))
  .handler(async ({ data }) => {
    const { crmAgentAdmin } = await import("./crm-agent-admin.server");
    const a = await crmAgentAdmin();
    const { error } = await a.db.rpc("release_crm_agent_hold", { p_contact: data.contactKey, p_actor: a.userId });
    if (error) throw new Error(agentError(error, "Não foi possível devolver o contato ao agente."));
    return { ok: true };
  });
