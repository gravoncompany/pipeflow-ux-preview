import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { goalData, monthKey, duplicateGoal, type GoalData } from "./commercial-goals";

const COMPANY = "crm:1";
/** "main" = original pipeline (pipeline_id null); otherwise a sales_pipelines uuid. */
const pipelineKey = z.union([z.literal("main"), z.string().uuid()]);
async function checkPipeline(db: Awaited<ReturnType<typeof admin>>, key: string) {
  if (key === "main") return;
  const { data } = await db.from("sales_pipelines").select("id").eq("id", key).eq("archived", false).maybeSingle();
  if (!data) throw new Error("Funil não encontrado.");
}

async function admin() {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com acesso completo para usar as Metas Comerciais.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Row = { month: string; data: unknown; notes: string; action_plan: string; updated_by: string; updated_at: string };
const toDto = (r: Row) => ({ month: r.month, data: goalData.parse(r.data) as GoalData, notes: r.notes, actionPlan: r.action_plan, updatedBy: r.updated_by, updatedAt: r.updated_at });

export const listGoalMonths = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ pipeline: pipelineKey }).parse(i))
  .handler(async ({ data: input }) => {
  const db = await admin();
  const { data, error } = await db.from("commercial_goals").select("month").eq("company_key", COMPANY).eq("pipeline_key", input.pipeline).order("month");
  if (error) throw new Error("Não foi possível carregar os meses.");
  return (data ?? []).map((r) => r.month);
});

export const getGoal = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ month: monthKey, pipeline: pipelineKey }).parse(i))
  .handler(async ({ data }) => {
    const db = await admin();
    await checkPipeline(db, data.pipeline);
    const { data: row, error } = await db.from("commercial_goals").select("month,data,notes,action_plan,updated_by,updated_at").eq("company_key", COMPANY).eq("month", data.month).eq("pipeline_key", data.pipeline).maybeSingle();
    if (error) throw new Error("Não foi possível carregar a meta.");
    // CRM cohort: leads that entered in this month in the original pipeline, measured by current stage.
    const [y, m] = data.month.split("-").map(Number);
    const start = `${data.month}-01`; const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const base = db.from("leads").select("stage");
    const { data: leads, error: le } = await (data.pipeline === "main" ? base.is("pipeline_id", null) : base.eq("pipeline_id", data.pipeline)).gte("entry_date", start).lte("entry_date", end);
    if (le) throw new Error("Não foi possível ler os leads do CRM.");
    const { DEFAULT_STAGES } = await import("./crm-types");
    const order = DEFAULT_STAGES.map((s) => s.id); const q = order.indexOf("qualificacao");
    const list = leads ?? [];
    const crm = { leads: list.length, qualified: list.filter((l) => l.stage !== "perda" && order.indexOf(l.stage) >= q).length, clients: list.filter((l) => l.stage === "fechado").length };
    return { goal: row ? toDto(row as Row) : null, crm };
  });

export const saveGoal = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ month: monthKey, pipeline: pipelineKey, data: goalData, notes: z.string().max(5000), actionPlan: z.string().max(5000), updatedBy: z.string().trim().min(1, "Informe o responsável pela alteração.").max(80), expectedUpdatedAt: z.string().nullable() }).parse(i))
  .handler(async ({ data }) => {
    const db = await admin();
    await checkPipeline(db, data.pipeline);
    const values = { data: data.data, notes: data.notes, action_plan: data.actionPlan, updated_by: data.updatedBy };
    const q = data.expectedUpdatedAt
      ? db.from("commercial_goals").update(values).eq("company_key", COMPANY).eq("month", data.month).eq("pipeline_key", data.pipeline).eq("updated_at", data.expectedUpdatedAt)
      : db.from("commercial_goals").insert({ ...values, company_key: COMPANY, month: data.month, pipeline_key: data.pipeline });
    const { data: row, error } = await q.select("month,data,notes,action_plan,updated_by,updated_at").maybeSingle();
    if (error?.code === "23505") throw new Error("Já existe uma meta para este mês e funil. Recarregue antes de salvar.");
    if (error) throw new Error("Não foi possível salvar a meta.");
    if (!row) throw new Error("A meta foi alterada em outro lugar. Recarregue antes de salvar.");
    return toDto(row as Row);
  });

export const duplicateGoalMonth = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ pipeline: pipelineKey, from: monthKey, to: monthKey, updatedBy: z.string().trim().min(1, "Informe o responsável pela alteração.").max(80) }).parse(i))
  .handler(async ({ data }) => {
    if (data.from === data.to) throw new Error("Escolha um mês diferente.");
    const db = await admin();
    const { data: src, error } = await db.from("commercial_goals").select("data").eq("company_key", COMPANY).eq("month", data.from).eq("pipeline_key", data.pipeline).maybeSingle();
    if (error || !src) throw new Error("Meta de origem não encontrada.");
    // Insert only: never overwrite an existing month.
    const { error: ie } = await db.from("commercial_goals").insert({ company_key: COMPANY, month: data.to, pipeline_key: data.pipeline, data: duplicateGoal(goalData.parse(src.data)), updated_by: data.updatedBy });
    if (ie?.code === "23505") throw new Error("O mês de destino já tem meta; nada foi sobrescrito.");
    if (ie) throw new Error("Não foi possível duplicar a meta.");
    return { month: data.to };
  });

export const deleteGoal = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ month: monthKey, pipeline: pipelineKey }).parse(i))
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db.from("commercial_goals").delete().eq("company_key", COMPANY).eq("month", data.month).eq("pipeline_key", data.pipeline);
    if (error) throw new Error("Não foi possível excluir a meta.");
    return { ok: true };
  });
