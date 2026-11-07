import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionRate, salesByMonth, knowledgeGenerationSchema } from "./ai-knowledge";

test("salesByMonth groups closed leads by entry month and ignores other stages", () => {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const rows = salesByMonth([
    { stage: "fechado", entryDate: `${month}-05` },
    { stage: "fechado", entryDate: `${month}-12` },
    { stage: "qualificacao", entryDate: `${month}-03` },
    { stage: "fechado", entryDate: "2020-01-10" },
    { stage: "fechado", entryDate: "" },
  ], 6);
  assert.equal(rows.length, 6);
  assert.equal(rows.find(r => r.month === month)?.count, 2);
  assert.equal(rows.reduce((n, r) => n + r.count, 0), 2);
});

test("decisionRate returns null without a base and percentages otherwise", () => {
  assert.equal(decisionRate(0, 0), null);
  assert.equal(decisionRate(3, 1), 75);
  assert.equal(decisionRate(0, 2), 0);
});

test("knowledgeGenerationSchema rejects unknown kinds and oversized insight lists", () => {
  assert.equal(knowledgeGenerationSchema.safeParse({ insights: [{ kind: "objection", text: "Preço é a objeção mais citada." }], dataWarning: "" }).success, true);
  assert.equal(knowledgeGenerationSchema.safeParse({ insights: [{ kind: "secret", text: "x".repeat(20) }], dataWarning: "" }).success, false);
  const many = Array.from({ length: 13 }, () => ({ kind: "objection", text: "x".repeat(20) }));
  assert.equal(knowledgeGenerationSchema.safeParse({ insights: many, dataWarning: "" }).success, false);
});
