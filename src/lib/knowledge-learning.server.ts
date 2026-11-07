import { analysisSchema, type AnalysisMessage } from "./whatsapp-analysis";
import { knowledgeOutputSchema } from "./ai-knowledge";
import { executeLearningWork, LEARNING_SYNTHESIS_BATCH, type LearningWork } from "./knowledge-learning";
import { compactAnalysis, runKnowledgeGeneration } from "./ai/knowledge.server";
import { runConversationAnalysis } from "./ai/whatsapp-analysis.server";
import type { Json } from "@/integrations/supabase/types";

export async function processLearningStep(apiKey: string, id: string) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const token = crypto.randomUUID();
  const { data: claimed, error: claimError } = await db.rpc("claim_ai_learning", { p_run: id, p_token: token });
  if (claimError) throw new Error("Não foi possível reservar o aprendizado.");
  if (!claimed) return;
  async function commit(args: { p_item?: number; p_result?: Json; p_insights?: Json; p_offset?: number; p_publish?: boolean }) {
    const { data, error } = await db.rpc("commit_ai_learning", {
      p_run: id, p_token: token, ...args,
    });
    if (error || !data) throw new Error("Não foi possível salvar o progresso do aprendizado.");
  }
  try {
    const { data: control, error: controlError } = await db.from("whatsapp_ai_control").select("blocked_status,blocked_message").eq("id", 1).maybeSingle();
    if (controlError) throw new Error("Não foi possível verificar a disponibilidade da IA.");
    if (control?.blocked_status) throw new Error(control.blocked_message || "Aprendizado pausado. Verifique o acesso à IA.");
    const { data: run, error: runError } = await db.from("ai_learning_runs").select("*").eq("id", id).single();
    if (runError || !run) throw new Error("Aprendizado indisponível.");
    const { data: pending, error: pendingError } = await db.from("ai_learning_items").select("id,messages").eq("run_id", id).is("result", null).order("id").limit(1);
    if (pendingError) throw new Error("Não foi possível ler as conversas.");
    let work: LearningWork;
    if (pending?.[0]) work = { kind: "analysis", itemId: pending[0].id, messages: pending[0].messages };
    else {
      const { data: results, error } = await db.from("ai_learning_items").select("result").eq("run_id", id).order("id").range(run.insight_offset, run.insight_offset + LEARNING_SYNTHESIS_BATCH - 1);
      if (error) throw new Error("Não foi possível reunir as análises.");
      work = results?.length ? { kind: "synthesis", analyses: results.map(r => analysisSchema.parse(r.result)), offset: run.insight_offset } : { kind: "publish" };
    }
    await executeLearningWork(work, {
      analyze: async (messages) => {
        const result = await runConversationAnalysis(apiKey, messages as AnalysisMessage[]);
        result.limitations = `${result.limitations} Trecho sequencial do histórico; mensagens longas podem estar divididas. Mídias não transcritas.`;
        return result;
      },
      synthesize: async (analyses) => {
        const [{ data: actions, error: ae }, { data: leads, error: le }] = await Promise.all([
          db.from("analysis_qualification_actions").select("status"), db.from("leads").select("stage,entry_date"),
        ]);
        if (ae || le) throw new Error("Não foi possível ler as métricas comerciais.");
        const { salesByMonth } = await import("./ai-knowledge");
        const previous = knowledgeOutputSchema.safeParse({ insights: run.insights, dataWarning: "" });
        return runKnowledgeGeneration(apiKey, {
          analyses: analyses.map(compactAnalysis),
          previousInsights: previous.success ? previous.data.insights : [],
          decisions: { confirmed: (actions ?? []).filter(a => a.status === "confirmed").length, cancelled: (actions ?? []).filter(a => a.status === "cancelled").length },
          salesByMonth: salesByMonth((leads ?? []).map(l => ({ stage: l.stage, entryDate: l.entry_date ?? "" })), 6),
          totalLeads: leads?.length ?? 0, closedLeads: (leads ?? []).filter(l => l.stage === "fechado").length,
        });
      },
      saveAnalysis: (item, result) => commit({ p_item: item, p_result: result }),
      saveInsights: (result, offset) => commit({ p_insights: result.insights, p_offset: offset }),
      publish: () => commit({ p_publish: true }),
    });
  } catch (e) {
    const failure = e as { statusCode?: number };
    const status = failure.statusCode;
    const message = status === 402 ? "Créditos de IA insuficientes. Aprendizado pausado." : status === 403 || status === 404 ? "Acesso à IA indisponível. Aprendizado pausado." : e instanceof Error && !status ? e.message : "Não foi possível continuar o aprendizado. Nenhuma geração parcial foi publicada.";
    if (status === 402 || status === 403 || status === 404) await db.from("whatsapp_ai_control").upsert({ id: 1, blocked_status: status, blocked_message: message, blocked_kind: status === 402 ? "credits" : "access", updated_at: new Date().toISOString() });
    await db.from("ai_learning_runs").update({ status: "paused", error: message, lease_until: null, lease_token: null }).eq("id", id).eq("lease_token", token);
    throw new Error(message);
  }
}