import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterPipelineLeads, freshPipelineStages, leadPipeline, pipelineStages } from "./pipelines";
import { rowToLead, leadToRow } from "./lead-mapper";

describe("funis separados", () => {
  it("mantém leads antigos no funil original", () => {
    assert.equal(leadPipeline(rowToLead({ id: "old" })), "main");
    assert.equal(leadToRow(rowToLead({ id: "old" })).pipeline_id, null);
  });
  it("separa cards por funil sem duplicar", () => {
    const leads = [rowToLead({ id: "a" }), rowToLead({ id: "b", pipeline_id: "sales" })];
    assert.deepEqual(filterPipelineLeads(leads, "main").map((l) => l.id), ["a"]);
    assert.deepEqual(filterPipelineLeads(leads, "sales").map((l) => l.id), ["b"]);
    assert.equal(leadToRow(leads[1]).pipeline_id, "sales");
  });
  it("cria etapas independentes e exige ao menos uma", () => {
    const one = freshPipelineStages();
    const two = freshPipelineStages();
    one[0].title = "Outro";
    assert.equal(two[0].title, "Lead Novo");
    assert.equal(pipelineStages.safeParse([]).success, false);
    assert.equal(pipelineStages.safeParse([two[0], two[0]]).success, false);
  });
});