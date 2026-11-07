import { test } from "node:test";
import assert from "node:assert/strict";
import { executeLearningWork } from "./knowledge-learning";
import type { Analysis } from "./whatsapp-analysis";

const analysis: Analysis = { qualification: "inconclusive", summary: "Conversa comercial", interestEvidence: [], opportunity: "unclear", opportunityReason: "", serviceAssessment: "insufficient_data", failures: [], nextAction: "Revisar atendimento", limitations: "Mídia sem transcrição" };
const insight = { insights: [{ kind: "service_failure" as const, text: "Revisar o acompanhamento comercial." }], dataWarning: "" };
function fixtures() {
  const calls: string[] = [];
  const deps: Parameters<typeof executeLearningWork>[1] = {
    analyze: async () => { calls.push("analyze"); return analysis; },
    synthesize: async () => { calls.push("synthesize"); return insight; },
    saveAnalysis: async () => { calls.push("saveAnalysis"); },
    saveInsights: async () => { calls.push("saveInsights"); },
    publish: async () => { calls.push("publish"); },
  };
  return { calls, deps };
}
test("learning processes each stored history chunk, including beyond sixty conversations, without publishing early", async () => {
  const { calls, deps } = fixtures();
  for (let id = 0; id < 65; id++) await executeLearningWork({ kind: "analysis", itemId: id, messages: [] }, deps);
  assert.equal(calls.filter(c => c === "analyze").length, 65);
  assert.equal(calls.filter(c => c === "saveAnalysis").length, 65);
  assert.equal(calls.includes("publish"), false);
});
test("a failed analysis stops before persistence or publication", async () => {
  const { calls, deps } = fixtures();
  deps.analyze = async () => { throw new Error("403"); };
  await assert.rejects(executeLearningWork({ kind: "analysis", itemId: 1, messages: [] }, deps), /403/);
  assert.deepEqual(calls, []);
});
test("bounded synthesis persists progress with one model call and rejects oversized batches", async () => {
  const { calls, deps } = fixtures();
  let offset = 0;
  deps.saveInsights = async (_, value) => { offset = value; };
  await executeLearningWork({ kind: "synthesis", analyses: Array(20).fill(analysis), offset: 40 }, deps);
  assert.equal(offset, 60);
  assert.deepEqual(calls, ["synthesize"]);
  await assert.rejects(executeLearningWork({ kind: "synthesis", analyses: Array(21).fill(analysis), offset: 60 }, deps), /inválido/);
});
test("publication does not make another AI call", async () => {
  const { calls, deps } = fixtures();
  await executeLearningWork({ kind: "publish" }, deps);
  assert.deepEqual(calls, ["publish"]);
});