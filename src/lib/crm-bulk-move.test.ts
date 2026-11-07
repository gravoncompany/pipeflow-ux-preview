import { test } from "node:test";
import assert from "node:assert/strict";
import { runBulkMove, type BulkMoveDeps, type BulkMoveRow } from "./crm-bulk-move";

const P = "11111111-1111-4111-8111-111111111111";
function fake(rows: BulkMoveRow[], opts: { stale?: string[] } = {}) {
  const db = new Map(rows.map(r => [r.id, { ...r, tags: ["vip"], email: "a@b.com" }]));
  const deps: BulkMoveDeps = {
    pipelineStages: async id => id === P ? { name: "Outbound", stages: [{ id: "outbound-novo", title: "Novo" }, { id: "outbound-primeiro-contato", title: "Primeiro contato" }] } : null,
    readLeads: async ids => ids.flatMap(id => { const r = db.get(id); return r ? [{ id: r.id, stage: r.stage, pipeline_id: r.pipeline_id, history: r.history, gravon_change_revision: r.gravon_change_revision }] : []; }),
    updateLead: async (old, patch) => {
      const cur = db.get(old.id);
      if (!cur || opts.stale?.includes(old.id) || cur.stage !== old.stage || cur.pipeline_id !== old.pipeline_id || cur.gravon_change_revision !== old.gravon_change_revision) return false;
      db.set(old.id, { ...cur, ...patch, gravon_change_revision: cur.gravon_change_revision + 1 }); return true;
    },
    now: () => "2026-11-03T12:00:00.000Z", newId: () => "x",
  };
  return { db, deps };
}
const lead = (id: string, o: Partial<BulkMoveRow> = {}): BulkMoveRow => ({ id, stage: "lead-novo", pipeline_id: null, history: [{ id: "h1", date: "2026-10-01", text: "Ligação" }], gravon_change_revision: 1, ...o });

test("entre funis: move, preserva histórico, etiquetas e contatos, e registra a movimentação", async () => {
  const { db, deps } = fake([lead("a"), lead("b")]);
  const r = await runBulkMove(deps, "full", { ids: ["a", "b", "a"], pipelineId: P, stage: "outbound-primeiro-contato", stageTitle: "x", pipelineName: "x" });
  assert.deepEqual(r, { moved: 2, unchanged: 0, failed: [] });
  const a = db.get("a")!;
  assert.equal(a.pipeline_id, P); assert.equal(a.stage, "outbound-primeiro-contato"); assert.deepEqual(a.tags, ["vip"]); assert.equal(a.email, "a@b.com");
  const h = a.history as { id: string; text: string }[];
  assert.equal(h.length, 2); assert.equal(h[0].id, "h1"); assert.match(h[1].text, /Movido em massa para Outbound · Primeiro contato \(antes: funil principal · lead-novo\)/);
});
test("mesmo funil (principal), cards já no destino contam como inalterados", async () => {
  const { deps } = fake([lead("a"), lead("b", { stage: "qualificacao" })]);
  assert.deepEqual(await runBulkMove(deps, "full", { ids: ["a", "b"], pipelineId: null, stage: "qualificacao", stageTitle: "Qualificação", pipelineName: "Funil principal" }), { moved: 1, unchanged: 1, failed: [] });
});
test("card alterado por outra pessoa fica como estava e informa o motivo; os demais seguem", async () => {
  const { db, deps } = fake([lead("a"), lead("b")], { stale: ["b"] });
  const r = await runBulkMove(deps, "full", { ids: ["a", "b", "zz"], pipelineId: P, stage: "outbound-novo", stageTitle: "x", pipelineName: "x" });
  assert.equal(r.moved, 1); assert.equal(r.failed.length, 2);
  assert.match(r.failed.find(f => f.id === "b")!.reason, /alterado por outra pessoa/); assert.match(r.failed.find(f => f.id === "zz")!.reason, /não encontrado/);
  assert.equal(db.get("b")!.stage, "lead-novo"); assert.equal(db.get("b")!.pipeline_id, null);
});
test("permissões: acesso limitado não move para outro funil nem para etapas fora das permitidas", async () => {
  const { deps } = fake([lead("a", { stage: "tentando-contato" })]);
  const other = await runBulkMove(deps, "limited", { ids: ["a"], pipelineId: P, stage: "outbound-novo", stageTitle: "x", pipelineName: "x" });
  assert.match(other.failed[0].reason, /sem permissão/);
  const stage = await runBulkMove(deps, "limited", { ids: ["a"], pipelineId: null, stage: "sql", stageTitle: "SQL", pipelineName: "Funil principal" });
  assert.match(stage.failed[0].reason, /sem permissão/);
  assert.equal((await runBulkMove(deps, "limited", { ids: ["a"], pipelineId: null, stage: "contato-realizado", stageTitle: "x", pipelineName: "x" })).moved, 1);
});
test("destino inválido: etapa fora do funil, funil inexistente e 'fechado' são recusados sem mover nada", async () => {
  const { db, deps } = fake([lead("a")]);
  await assert.rejects(runBulkMove(deps, "full", { ids: ["a"], pipelineId: P, stage: "inexistente", stageTitle: "x", pipelineName: "x" }), /não pertence/);
  await assert.rejects(runBulkMove(deps, "full", { ids: ["a"], pipelineId: "22222222-2222-4222-8222-222222222222", stage: "x", stageTitle: "x", pipelineName: "x" }), /indisponível/);
  await assert.rejects(runBulkMove(deps, "full", { ids: ["a"], pipelineId: null, stage: "fechado", stageTitle: "Fechado", pipelineName: "x" }), /classificação/);
  assert.equal(db.get("a")!.stage, "lead-novo");
});
