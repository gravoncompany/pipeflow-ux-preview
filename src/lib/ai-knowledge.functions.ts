import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  decisionRate,
  salesByMonth,
  type KnowledgeInsight,
  type KnowledgeKind,
} from "./ai-knowledge";
import { analysisSchema } from "./whatsapp-analysis";
import { phoneKey } from "./phone";

export type LearningStatus = { id: string; status: string; phase: string; conversations: number; messages: number; completed: number; total: number; error: string | null };

export const getLearningStatus = createServerFn({ method: "POST" }).handler(async (): Promise<LearningStatus | null> => {
  if (!(await requireFull())) return null;
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: run, error } = await db.from("ai_learning_runs").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Não foi possível carregar o progresso.");
  if (!run) return null;
  const [all, done] = await Promise.all([
    db.from("ai_learning_items").select("id", { count: "exact", head: true }).eq("run_id", run.id),
    db.from("ai_learning_items").select("id", { count: "exact", head: true }).eq("run_id", run.id).not("result", "is", null),
  ]);
  if (all.error || done.error) throw new Error("Não foi possível carregar o progresso.");
  return { id: run.id, status: run.status, phase: run.phase, conversations: run.conversation_count, messages: run.message_count, total: all.count ?? 0, completed: done.count ?? 0, error: run.error };
});

export const startLearning = createServerFn({ method: "POST" }).handler(async () => {
  if (!(await requireFull())) throw new Error("Entre com acesso completo.");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data, error } = await db.rpc("start_ai_learning");
  if (error) throw new Error("Não foi possível iniciar o aprendizado.");
  return { id: data };
});

export const advanceLearning = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ id: z.string().uuid() }).strict().parse(i))
  .handler(async ({ data }) => {
    if (!(await requireFull())) throw new Error("Entre com acesso completo.");
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Aprendizado por IA não configurado.");
    const { processLearningStep } = await import("./knowledge-learning.server");
    await processLearningStep(apiKey, data.id);
    return { ok: true };
  });

async function requireFull() {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  return Boolean(secret && (await hasFullCrmSession(secret)));
}

export type KnowledgeOverview = {
  needsAuth: boolean;
  insights: KnowledgeInsight[];
  generatedAt: string | null;
  generation: number;
  analysesUsed: number;
  decisions: { confirmed: number; cancelled: number; rate: number | null };
  sales: { month: string; count: number }[];
  totalClosed: number;
  analysesCount: number;
  knowledgeSharing: boolean;
};

const emptyOverview: KnowledgeOverview = {
  needsAuth: false,
  insights: [],
  generatedAt: null,
  generation: 0,
  analysesUsed: 0,
  decisions: { confirmed: 0, cancelled: 0, rate: null },
  sales: [],
  totalClosed: 0,
  analysesCount: 0,
  knowledgeSharing: false,
};

export const getKnowledgeOverview = createServerFn({ method: "POST" }).handler(
  async (): Promise<KnowledgeOverview> => {
    if (!(await requireFull())) return { ...emptyOverview, needsAuth: true };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const [knowledge, analyses, actions, leads, settings] = await Promise.all([
      db.from("ai_knowledge").select("*").eq("company_key", "crm:1").eq("entry_type", "generated").order("created_at", { ascending: false }).limit(200),
      db.from("whatsapp_analyses").select("result,analyzed_at"),
      db.from("analysis_qualification_actions").select("status"),
      db.from("leads").select("stage,entry_date"),
      db.from("gravon_ai_test_settings").select("crm_knowledge_enabled").eq("id", 1).maybeSingle(),
    ]);
    if (knowledge.error || analyses.error || actions.error || leads.error)
      throw new Error("Não foi possível carregar o conhecimento.");
    const rows = knowledge.data ?? [];
    const latestGeneration = rows[0]?.generation ?? 0;
    const insights: KnowledgeInsight[] = rows
      .filter((r) => r.generation === latestGeneration)
      .map((r) => ({
        id: r.id,
        kind: r.kind as KnowledgeKind,
        text: r.text,
        sources: r.sources,
        createdAt: r.created_at,
      }));
    const confirmed = (actions.data ?? []).filter((a) => a.status === "confirmed").length;
    const cancelled = (actions.data ?? []).filter((a) => a.status === "cancelled").length;
    const leadRows = (leads.data ?? []).map((l) => ({ stage: l.stage, entryDate: l.entry_date ?? "" }));
    return {
      needsAuth: false,
      insights,
      generatedAt: rows[0]?.created_at ?? null,
      generation: latestGeneration,
      analysesUsed: rows[0]?.sources ?? 0,
      decisions: { confirmed, cancelled, rate: decisionRate(confirmed, cancelled) },
      sales: salesByMonth(leadRows, 6),
      totalClosed: leadRows.filter((l) => l.stage === "fechado").length,
      analysesCount: (analyses.data ?? []).filter((a) => analysisSchema.safeParse(a.result).success).length,
      knowledgeSharing: settings.data?.crm_knowledge_enabled === true,
    };
  },
);

export const recommendFromKnowledge = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({ phone: z.string().min(8).max(40), start: z.string().max(10).default(""), end: z.string().max(10).default("") }).parse(i),
  )
  .handler(async ({ data }): Promise<{ recommendation: string | null; error: string | null }> => {
    if (!(await requireFull())) return { recommendation: null, error: "Entre com a senha de acesso completo." };
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { recommendation: null, error: "Recomendação por IA não configurada." };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const [analysisRow, knowledge] = await Promise.all([
      db.from("whatsapp_analyses").select("result").eq("phone_key", phoneKey(data.phone)).eq("scope_start", data.start).eq("scope_end", data.end).maybeSingle(),
      db.from("ai_knowledge").select("*").eq("company_key", "crm:1").eq("entry_type", "generated").order("created_at", { ascending: false }).limit(200),
    ]);
    const parsed = analysisSchema.safeParse(analysisRow.data?.result);
    if (!parsed.success) return { recommendation: null, error: "Analise a conversa primeiro para gerar a recomendação." };
    const rows = knowledge.data ?? [];
    const latest = rows[0]?.generation ?? 0;
    const insights: KnowledgeInsight[] = rows
      .filter((r) => r.generation === latest)
      .map((r) => ({ id: r.id, kind: r.kind as KnowledgeKind, text: r.text, sources: r.sources, createdAt: r.created_at }));
    try {
      const { runKnowledgeRecommendation } = await import("./ai/knowledge.server");
      const recommendation = await runKnowledgeRecommendation(apiKey, parsed.data, insights);
      if (!recommendation) return { recommendation: null, error: "Recomendação indisponível." };
      return { recommendation, error: null };
    } catch {
      return { recommendation: null, error: "Não foi possível gerar a recomendação. Tente novamente mais tarde." };
    }
  });

export const setKnowledgeSharing = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ enabled: z.boolean() }).strict().parse(input))
  .handler(async ({ data }) => {
    if (!(await requireFull())) return { ok: false, error: "Entre com acesso completo." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings, error: readError } = await supabaseAdmin
      .from("gravon_ai_test_settings")
      .select("enabled,crm_read_enabled,crm_read_revision")
      .eq("id", 1)
      .maybeSingle();
    if (readError || !settings) return { ok: false, error: "Configuração indisponível." };
    if (data.enabled && (!settings.enabled || !settings.crm_read_enabled || !settings.crm_read_revision))
      return { ok: false, error: "Ative primeiro respostas e leitura no seu WhatsApp." };
    const { data: changed, error } = await supabaseAdmin
      .from("gravon_ai_test_settings")
      .update({
        crm_knowledge_enabled: data.enabled,
        crm_knowledge_read_revision: data.enabled ? settings.crm_read_revision : "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .eq("crm_read_revision", settings.crm_read_revision)
      .select("id");
    if (error || changed?.length !== 1) return { ok: false, error: "Configuração alterada; tente novamente." };
    return { ok: true, error: null };
  });
