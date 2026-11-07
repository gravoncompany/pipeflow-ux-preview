import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { mainFunnelStages, referenceError, referenceInput, type ReferenceMessage, type ReferencePipeline } from "./reference-messages";
import { pipelineStages } from "./pipelines";

const COLS = "id,body,match_mode,source,pipeline_id,stage_id,active,revision,updated_at";

export const getReferenceMessages = createServerFn({ method: "POST" }).handler(async () => {
  const { crmAdmin, withAdminAccess } = await import("./crm-agent-admin.server");
  return withAdminAccess(async () => {
    const a = await crmAdmin();
    const [refs, pipes, captures] = await Promise.all([
      a.db.from("crm_reference_messages").select(COLS).order("created_at"),
      a.db.from("sales_pipelines").select("id,name,stages").eq("archived", false).order("created_at"),
      a.db.from("crm_reference_captures").select("message_id,pipeline_id,lead_id,source,status,created_at").order("created_at", { ascending: false }).limit(20),
    ]);
    const failure = refs.error ?? captures.error ?? pipes.error;
    if (failure) {
      const { isMissingSchema, MIGRATIONS_PENDING } = await import("./crm-agent-access");
      console.error("reference_messages_load_failed", { code: String(failure.code ?? "").slice(0, 12) });
      throw new Error(isMissingSchema(failure) ? MIGRATIONS_PENDING : "Não foi possível carregar as mensagens de referência.");
    }
    const pipelines: ReferencePipeline[] = [{ id: null, name: "Funil principal", stages: mainFunnelStages() },
      ...(pipes.data ?? []).map((p: any) => ({ id: p.id as string, name: p.name as string, stages: pipelineStages.parse(p.stages) }))];
    return { references: (refs.data ?? []) as ReferenceMessage[], pipelines, captures: (captures.data ?? []) as { message_id: string; pipeline_id: string | null; lead_id: string | null; source: string; status: string; created_at: string }[] };
  });
});

export const saveReferenceMessage = createServerFn({ method: "POST" }).inputValidator((i) => referenceInput.parse(i)).handler(async ({ data }) => {
  const { crmAdmin } = await import("./crm-agent-admin.server");
  const a = await crmAdmin();
  if (data.pipelineId === null && !mainFunnelStages().some((s) => s.id === data.stageId)) throw new Error("A etapa escolhida não existe no Funil principal.");
  const { data: row, error } = await a.db.rpc("save_crm_reference_message", {
    p_actor: a.userId, p_id: data.id, p_revision: data.revision, p_body: data.body, p_mode: data.matchMode, p_source: data.source,
    p_pipeline: data.pipelineId, p_stage: data.stageId, p_active: data.active,
  });
  if (error) {
    const { isMissingSchema, MIGRATIONS_PENDING } = await import("./crm-agent-access");
    throw new Error(isMissingSchema(error) ? MIGRATIONS_PENDING : referenceError(error));
  }
  return row as ReferenceMessage;
});

export const deleteReferenceMessage = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative() }).strict().parse(i))
  .handler(async ({ data }) => {
    const { crmAdmin } = await import("./crm-agent-admin.server");
    const a = await crmAdmin();
    const { error } = await a.db.rpc("delete_crm_reference_message", { p_id: data.id, p_revision: data.revision });
    if (error) throw new Error(referenceError(error));
    return { ok: true };
  });
