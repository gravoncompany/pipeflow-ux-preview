import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { dateKey, fullMonthKey } from "./traffic-investment";
import { goalData } from "./commercial-goals";

const COMPANY = "crm:1";
/** "main" = original pipeline (pipeline_id null); otherwise a sales_pipelines uuid. */
const pipelineKey = z.union([z.literal("main"), z.string().uuid()]);
const rangeBase = z.object({ pipeline: pipelineKey, from: dateKey, to: dateKey });
const range = rangeBase.refine((r) => r.from <= r.to, { message: "A data inicial deve ser anterior à final." });

async function admin() {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com acesso completo para usar o investimento em tráfego.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function checkPipeline(db: Awaited<ReturnType<typeof admin>>, key: string) {
  if (key === "main") return;
  const { data } = await db.from("sales_pipelines").select("id").eq("id", key).eq("archived", false).maybeSingle();
  if (!data) throw new Error("Funil não encontrado.");
}

type InvestmentDto = {
  amount: number | null;
  source: "metas" | "periodo" | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

/** Reads the investment for a pipeline and period. A full-calendar-month range reuses the Metas Comerciais record when one exists, so the same value is never stored twice. */
export const getTrafficInvestment = createServerFn({ method: "POST" })
  .inputValidator((i) => range.parse(i))
  .handler(async ({ data }): Promise<InvestmentDto> => {
    const db = await admin();
    await checkPipeline(db, data.pipeline);
    const month = fullMonthKey(data.from, data.to);
    if (month) {
      const { data: goal, error } = await db
        .from("commercial_goals")
        .select("data,updated_by,updated_at")
        .eq("company_key", COMPANY)
        .eq("month", month)
        .eq("pipeline_key", data.pipeline)
        .maybeSingle();
      if (error) throw new Error("Não foi possível ler o investimento das Metas Comerciais.");
      if (goal) {
        const parsed = goalData.parse(goal.data);
        return { amount: parsed.actual.adSpend, source: "metas", updatedBy: goal.updated_by || null, updatedAt: goal.updated_at };
      }
    }
    const { data: row, error } = await db
      .from("traffic_investments")
      .select("amount,updated_by,updated_at")
      .eq("company_key", COMPANY)
      .eq("pipeline_key", data.pipeline)
      .eq("from_date", data.from)
      .eq("to_date", data.to)
      .maybeSingle();
    if (error) throw new Error("Não foi possível ler o investimento em tráfego.");
    if (!row) return { amount: null, source: null, updatedBy: null, updatedAt: null };
    return { amount: row.amount == null ? null : Number(row.amount), source: "periodo", updatedBy: row.updated_by || null, updatedAt: row.updated_at };
  });

export const saveTrafficInvestment = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    rangeBase
      .extend({
        amount: z.number().finite().min(0, "Valores não podem ser negativos.").nullable(),
        updatedBy: z.string().trim().min(1, "Informe o responsável pela alteração.").max(80),
      })
      .refine((r) => r.from <= r.to, { message: "A data inicial deve ser anterior à final." })
      .parse(i),
  )
  .handler(async ({ data }): Promise<InvestmentDto> => {
    const db = await admin();
    await checkPipeline(db, data.pipeline);
    const month = fullMonthKey(data.from, data.to);
    if (month) {
      const { data: goal, error } = await db
        .from("commercial_goals")
        .select("data")
        .eq("company_key", COMPANY)
        .eq("month", month)
        .eq("pipeline_key", data.pipeline)
        .maybeSingle();
      if (error) throw new Error("Não foi possível ler o investimento das Metas Comerciais.");
      if (goal) {
        // Same source as Metas Comerciais: update only adSpend, preserving every other field.
        const parsed = goalData.parse(goal.data);
        parsed.actual.adSpend = data.amount;
        const { data: row, error: ue } = await db
          .from("commercial_goals")
          .update({ data: parsed, updated_by: data.updatedBy })
          .eq("company_key", COMPANY)
          .eq("month", month)
          .eq("pipeline_key", data.pipeline)
          .select("data,updated_by,updated_at")
          .single();
        if (ue || !row) throw new Error("Não foi possível salvar o investimento.");
        return { amount: goalData.parse(row.data).actual.adSpend, source: "metas", updatedBy: row.updated_by || null, updatedAt: row.updated_at };
      }
    }
    const { data: row, error } = await db
      .from("traffic_investments")
      .upsert(
        { company_key: COMPANY, pipeline_key: data.pipeline, from_date: data.from, to_date: data.to, amount: data.amount, updated_by: data.updatedBy },
        { onConflict: "company_key,pipeline_key,from_date,to_date" },
      )
      .select("amount,updated_by,updated_at")
      .single();
    if (error || !row) throw new Error("Não foi possível salvar o investimento.");
    return { amount: row.amount == null ? null : Number(row.amount), source: "periodo", updatedBy: row.updated_by || null, updatedAt: row.updated_at };
  });
