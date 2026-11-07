import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateEmailMetrics, periodBounds } from "./outbound-email-metrics";

const { start, end } = periodBounds("2026-11-05", "2026-11-05");
const runs = [
  { id: "r1", automation_id: "a", enrollment_id: "e1", source: "trigger", finished_at: null, cancelled_at: null },
  { id: "r2", automation_id: "a", enrollment_id: "e2", source: "manual", finished_at: null, cancelled_at: null },
  { id: "r3", automation_id: "a", enrollment_id: "e3", source: "test", finished_at: null, cancelled_at: null },
];
const at = "2026-11-05T15:00:00Z";
const messages = [
  { id: "m1", enrollment_id: "e1", state: "accepted", created_at: at },
  { id: "m1", enrollment_id: "e1", state: "accepted", created_at: at },
  { id: "m2", enrollment_id: "e2", state: "reserved", created_at: at },
  { id: "m3", enrollment_id: "e2", state: "failed", created_at: at },
  { id: "m4", enrollment_id: "e3", state: "accepted", created_at: at },
  { id: "m5", enrollment_id: "e1", state: "accepted", created_at: "2026-11-06T03:30:00Z" },
];
const events = [
  { run_id: "r1", kind: "click", created_at: at },
  { run_id: "r1", kind: "click", created_at: at },
  { run_id: "r2", kind: "reply", created_at: at },
];
const base = { runs, messages, events, liveEnrollments: new Set(["e1", "e3"]), automationIds: new Set(["a"]), start, end };

test("enviados ignoram pendentes, testes, duplicados e fora do dia de Brasília", () => {
  const r = aggregateEmailMetrics({ ...base, mode: "all" });
  assert.equal(r.sent, 1);
  assert.equal(r.failed, 1);
});
test("cliques totais e únicos", () => {
  const r = aggregateEmailMetrics({ ...base, mode: "all" });
  assert.equal(r.clicksTotal, 2);
  assert.equal(r.clicksUnique, 1);
});
test("filtro manual e contatos ativos sem testes", () => {
  const r = aggregateEmailMetrics({ ...base, mode: "manual" });
  assert.equal(r.sent, 0);
  assert.equal(r.replies, 1);
  assert.equal(aggregateEmailMetrics({ ...base, mode: "all" }).activeContacts, 1);
});
