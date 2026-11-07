import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.object({ from: day, to: day }).strict()
  .refine((r) => r.from <= r.to, "Período inválido.")
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86400000 <= 400, "Escolha um período de até 400 dias.");

/** Full CRM session only: the Dashboard discloses financial data (same rule as Financeiro). */
async function fullAccess() {
  const { requireCrmLeadSession } = await import("./crm-leads.server");
  const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET).catch(() => null);
  return level === "full";
}

export const getDashboard = createServerFn({ method: "POST" }).inputValidator((i) => range.parse(i)).handler(async ({ data }) => {
  if (!(await fullAccess())) return { needsAuth: true as const };
  const { loadDashboard } = await import("./dashboard.server");
  const result = await loadDashboard({ companyKey: "crm:1" }, data.from, data.to);
  if (!(await fullAccess())) return { needsAuth: true as const };
  return { needsAuth: false as const, data: result };
});

export const analyzeDashboard = createServerFn({ method: "POST" }).inputValidator((i) => range.parse(i)).handler(async ({ data }) => {
  if (!(await fullAccess())) throw new Error("Entre com a senha de acesso completo.");
  const { loadDashboard } = await import("./dashboard.server");
  const { analyzeDashboardMetrics } = await import("./ai/dashboard-analysis.server");
  const span = Date.parse(data.to) - Date.parse(data.from) + 86400000;
  const prevTo = new Date(Date.parse(data.from) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(prevTo) - span + 86400000).toISOString().slice(0, 10);
  const [current, previous] = await Promise.all([
    loadDashboard({ companyKey: "crm:1" }, data.from, data.to),
    loadDashboard({ companyKey: "crm:1" }, prevFrom, prevTo),
  ]);
  const compact = (d: typeof current) => ({ period: d.period, financial: d.financial, commercial: d.commercial, outbound: d.outbound, gravonIa: d.ai, funnels: d.funnels, origins: d.origins, pendingSaleClassifications: d.pendingClassifications });
  const analysis = await analyzeDashboardMetrics({ atual: compact(current), anterior: compact(previous) });
  if (!(await fullAccess())) throw new Error("Entre com a senha de acesso completo.");
  return { analysis, generatedAt: new Date().toISOString() };
});

/** Bloco "Hoje": operação do dia (independente do período escolhido nos indicadores). */
export const getDashboardToday = createServerFn({ method: "POST" }).handler(async () => {
  if (!(await fullAccess())) return { needsAuth: true as const };
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { buildToday } = await import("./dashboard-today");
  const { todaySaoPaulo } = await import("./dashboard");
  const today = todaySaoPaulo();
  const from = new Date(Date.parse(`${today}T00:00:00-03:00`) - 86_400_000).toISOString();
  const to = new Date(Date.parse(`${today}T00:00:00-03:00`) + 2 * 86_400_000).toISOString();
  const leads: any[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error } = await db.from("leads").select("id,name,company,stage,pipeline_id,whatsapp,next_action,next_action_date").order("id").range(offset, offset + 999);
    if (error) throw new Error("Não foi possível carregar os leads de hoje.");
    leads.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const [messages, appts, pipes] = await Promise.all([
    db.from("whatsapp_messages").select("phone_key,from_me,sent_at").order("sent_at", { ascending: false }).limit(5000),
    db.from("crm_appointments").select("id,lead_id,summary,starts_at,ends_at,status").eq("status", "scheduled").gte("starts_at", from).lt("starts_at", to).order("starts_at").limit(200),
    db.from("sales_pipelines").select("id,name"),
  ]);
  if (messages.error || appts.error || pipes.error) throw new Error("Não foi possível carregar a operação de hoje.");
  const result = buildToday({
    today,
    leads: leads.map((l) => ({ id: l.id, name: l.name ?? "", company: l.company ?? "", stage: l.stage, pipelineId: l.pipeline_id, whatsapp: l.whatsapp ?? "", nextAction: l.next_action ?? "", nextActionDate: l.next_action_date })),
    messages: (messages.data ?? []).map((m: any) => ({ phoneKey: m.phone_key ?? "", fromMe: Boolean(m.from_me), sentAt: m.sent_at })),
    appointments: (appts.data ?? []).map((a: any) => ({ id: a.id, leadId: a.lead_id, summary: a.summary, startsAt: a.starts_at, endsAt: a.ends_at, status: a.status })),
    pipelineNames: Object.fromEntries((pipes.data ?? []).map((p: any) => [p.id, p.name])),
  });
  if (!(await fullAccess())) return { needsAuth: true as const };
  return { needsAuth: false as const, data: result };
});

export const getOutboundChannels = createServerFn({ method: "POST" }).inputValidator((i) => range.parse(i)).handler(async ({ data }) => {
  if (!(await fullAccess())) return { needsAuth: true as const };
  const { loadOutboundChannels } = await import("./outbound-channels.server");
  const result = await loadOutboundChannels(data.from, data.to);
  if (!(await fullAccess())) return { needsAuth: true as const };
  return { needsAuth: false as const, data: result };
});

export const getDashboardGrowth = createServerFn({ method: "POST" }).inputValidator(i => range.parse(i)).handler(async ({data}) => {
  if (!(await fullAccess())) return {needsAuth:true as const};
  const {loadGrowth} = await import('./dashboard-growth.server');
  const result = await loadGrowth(data.from,data.to);
  if (!(await fullAccess())) return {needsAuth:true as const};
  return {needsAuth:false as const,data:result};
});

export const analyzeDashboardGrowth = createServerFn({method:'POST'}).inputValidator(i=>range.parse(i)).handler(async ({data}) => {
  if (!(await fullAccess())) throw new Error('Entre com a senha de acesso completo.');
  const {loadGrowth} = await import('./dashboard-growth.server');
  const {analyzeDashboardMetrics} = await import('./ai/dashboard-analysis.server');
  const growth = await loadGrowth(data.from,data.to);
  const analysis = await analyzeDashboardMetrics({tipo:'crescimento recorrente contratado', ...growth});
  if (!(await fullAccess())) throw new Error('Entre com a senha de acesso completo.');
  return {analysis,generatedAt:new Date().toISOString()};
});
