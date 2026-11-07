import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { phoneKey } from "./phone";
import { analysisSchema, validateEvidence } from "./whatsapp-analysis";
import { normalizeQualification } from "./analysis-qualification";
import { pipelineStages } from "./pipelines";

const input = z.object({ phone: z.string().min(8).max(40), start: z.string().default(""), end: z.string().default(""), analyzedAt: z.string(), stage: z.object({ id: z.string().min(1).max(80), title: z.string().min(1).max(80) }), tag: z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(80) }) });
export type QualificationProposal = { id: string; leadName: string; stageTitle: string; tagLabel: string; status: string };
export const prepareAnalysisQualification = createServerFn({ method: "POST" }).inputValidator((i) => input.parse(i)).handler(async ({ data }): Promise<QualificationProposal> => {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com acesso completo.");
  if (normalizeQualification(data.tag.label) !== "qualificado" || !["qualificado", "qualificados", "qualificacao"].includes(normalizeQualification(data.stage.title))) throw new Error("Selecione a etiqueta Qualificado e a coluna de qualificação.");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const key = phoneKey(data.phone);
  const { data: saved, error } = await db.from("whatsapp_analyses").select("*").eq("phone_key", key).eq("scope_start", data.start).eq("scope_end", data.end).maybeSingle();
  if (error || !saved || saved.analyzed_at !== data.analyzedAt) throw new Error("A análise mudou. Abra o resultado atualizado.");
  const parsed = analysisSchema.safeParse(saved.result);
  if (!parsed.success) throw new Error("Análise indisponível.");
  const ids = parsed.data.interestEvidence.map((e) => e.messageId);
  const { data: messages, error: messageError } = await db.from("whatsapp_messages").select("message_id,body,from_me,sent_at,media_type").eq("phone_key", key).in("message_id", ids);
  if (messageError || validateEvidence(parsed.data, messages ?? []).qualification !== "qualified") throw new Error("A análise não possui evidência válida de qualificação.");
  const { data: leads, error: leadError } = await db.from("leads").select("id,name,whatsapp,stage,tags,pipeline_id,gravon_change_revision");
  const matches = (leads ?? []).filter((lead) => phoneKey(lead.whatsapp) === key);
  if (leadError || matches.length !== 1) throw new Error(matches.length > 1 ? "Há mais de um card para este número. Identifique o lead no Pipeline antes de qualificar." : "Esta conversa não possui um card vinculado no CRM.");
  const lead = matches[0];
  let stage = data.stage;
  if (lead.pipeline_id) {
    const { data: pipeline } = await db.from("sales_pipelines").select("stages").eq("id", lead.pipeline_id).eq("archived", false).maybeSingle();
    const stages = pipelineStages.safeParse(pipeline?.stages);
    const targets = stages.success ? stages.data.filter((s) => ["qualificado", "qualificados", "qualificacao"].includes(normalizeQualification(s.title))) : [];
    const exact = targets.filter((s) => normalizeQualification(s.title) !== "qualificacao");
    const options = exact.length ? exact : targets;
    if (options.length !== 1) throw new Error("O funil deste lead precisa de uma coluna de qualificação única.");
    stage = options[0];
  }
  const { data: previous } = await db.from("analysis_qualification_actions").select("*").eq("analysis_id", saved.id).eq("fingerprint", saved.fingerprint).eq("analyzed_at", saved.analyzed_at).eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (previous && (previous.status !== "pending" || previous.expected_revision === lead.gravon_change_revision)) return { id: previous.id, leadName: lead.name, stageTitle: previous.target_title, tagLabel: previous.tag_label, status: previous.status };
  const { data: action, error: actionError } = await db.from("analysis_qualification_actions").insert({ analysis_id: saved.id, fingerprint: saved.fingerprint, analyzed_at: saved.analyzed_at, lead_id: lead.id, expected_revision: lead.gravon_change_revision, pipeline_id: lead.pipeline_id, target_stage: stage.id, target_title: stage.title, tag_id: data.tag.id, tag_label: data.tag.label }).select("id,status").single();
  if (actionError || !action) throw new Error("Não foi possível preparar a confirmação. Abra a análise novamente.");
  return { id: action.id, leadName: lead.name, stageTitle: stage.title, tagLabel: data.tag.label, status: action.status };
});

export const resolveAnalysisQualification = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ id: z.string().uuid(), cancel: z.boolean(), notes: z.string().max(8000).default("") }).parse(i)).handler(async ({ data }) => {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com acesso completo.");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: result, error } = await db.rpc("resolve_analysis_qualification_with_notes", { p_id: data.id, p_cancel: data.cancel, p_notes: data.notes });
  if (error) throw new Error("Não foi possível concluir. Nenhuma alteração parcial foi aplicada.");
  return z.object({ status: z.string() }).parse(result);
});