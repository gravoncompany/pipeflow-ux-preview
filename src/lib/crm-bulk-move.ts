import { assertCrmLeadWrite } from "./crm-leads-access";
import type { CrmSessionLevel } from "./crm-session-token";

// Movimentação em massa (lógica testável). O acesso ao banco é injetado; a server function liga ao Supabase.
export type BulkMoveRow = { id: string; stage: string; pipeline_id: string | null; history: unknown; gravon_change_revision: number };
export type BulkMoveDeps = {
  pipelineStages(id: string): Promise<{ name: string; stages: { id: string; title: string }[] } | null>;
  readLeads(ids: string[]): Promise<BulkMoveRow[]>;
  // Atualização atômica condicionada ao estado lido; devolve false se o card mudou (nenhuma linha afetada).
  updateLead(old: BulkMoveRow, patch: { stage: string; pipeline_id: string | null; history: unknown[] }): Promise<boolean>;
  now?: () => string; newId?: () => string;
};
export type BulkMoveInput = { ids: string[]; pipelineId: string | null; stage: string; stageTitle: string; pipelineName: string };
export type BulkMoveResult = { moved: number; unchanged: number; failed: { id: string; reason: string }[] };

export async function runBulkMove(deps: BulkMoveDeps, level: CrmSessionLevel, data: BulkMoveInput): Promise<BulkMoveResult> {
  if (data.stage === "fechado") throw new Error("Fechar venda exige a classificação no card; mova individualmente.");
  let destinationTitle = data.stageTitle, destinationPipeline = data.pipelineName;
  if (data.pipelineId) {
    const pipeline = await deps.pipelineStages(data.pipelineId);
    if (!pipeline) throw new Error("Funil de destino indisponível.");
    const target = pipeline.stages.find(s => s.id === data.stage);
    if (!target) throw new Error("A etapa escolhida não pertence ao funil de destino.");
    destinationTitle = target.title; destinationPipeline = pipeline.name;
  }
  const ids = [...new Set(data.ids)];
  const byId = new Map((await deps.readLeads(ids)).map(r => [r.id, r]));
  const result: BulkMoveResult = { moved: 0, unchanged: 0, failed: [] };
  const now = (deps.now ?? (() => new Date().toISOString()))(), newId = deps.newId ?? (() => crypto.randomUUID());
  for (const id of ids) {
    const old = byId.get(id);
    if (!old) { result.failed.push({ id, reason: "card não encontrado" }); continue; }
    if (old.stage === data.stage && (old.pipeline_id ?? null) === data.pipelineId) { result.unchanged++; continue; }
    try { assertCrmLeadWrite(level, { stage: old.stage, pipeline_id: old.pipeline_id }, { stage: data.stage, pipelineId: data.pipelineId }); }
    catch { result.failed.push({ id, reason: "sem permissão para esta etapa ou funil" }); continue; }
    const history = Array.isArray(old.history) ? old.history : [];
    const entry = { id: `bulk-move:${newId()}`, date: now, kind: "movimentacao", source: "Pipeflow",
      text: `Movido em massa para ${destinationPipeline} · ${destinationTitle} (antes: ${old.pipeline_id ? "outro funil" : "funil principal"} · ${old.stage}).` };
    const ok = await deps.updateLead(old, { stage: data.stage, pipeline_id: data.pipelineId, history: [...history, entry] }).catch(() => false);
    if (!ok) { result.failed.push({ id, reason: "o card foi alterado por outra pessoa; atualize e tente de novo" }); continue; }
    result.moved++;
  }
  return result;
}
