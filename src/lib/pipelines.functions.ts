import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { pipelineName, pipelineStages } from "./pipelines";

export const listPipelines = createServerFn({ method: "GET" }).handler(async () => {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com acesso completo para gerenciar funis.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("sales_pipelines").select("id,name,stages").eq("archived", false).order("created_at");
  if (error) throw new Error("Não foi possível carregar os funis.");
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, stages: pipelineStages.parse(p.stages) }));
});

export const savePipeline = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid().optional(), name: pipelineName, stages: pipelineStages }).parse(input))
  .handler(async ({ data }) => {
    const secret = process.env.CRM_SESSION_SECRET;
    const { hasFullCrmSession } = await import("./crm-session.server");
    if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com acesso completo para gerenciar funis.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.id) {
      const { data: leads, error } = await supabaseAdmin.from("leads").select("stage").eq("pipeline_id", data.id);
      if (error) throw new Error("Não foi possível verificar as etapas.");
      if (leads?.some((lead) => !data.stages.some((stage) => stage.id === lead.stage))) throw new Error("Mova os leads desta coluna antes de excluí-la.");
    }
    const query = data.id
      ? supabaseAdmin.from("sales_pipelines").update({ name: data.name, stages: data.stages }).eq("id", data.id).eq("archived", false)
      : supabaseAdmin.from("sales_pipelines").insert({ name: data.name, stages: data.stages });
    const { data: result, error } = await query.select("id,name,stages").single();
    if (error || !result) throw new Error(error?.code === "23505" ? "Já existe um funil com esse nome." : "Não foi possível salvar o funil.");
    return { id: result.id, name: result.name, stages: pipelineStages.parse(result.stages) };
  });