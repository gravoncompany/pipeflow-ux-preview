import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateMetaInsights, periodRange } from "./client-meta-metrics";

test("conversas não viram leads e custo por conversa usa só conversas", () => {
  const m = aggregateMetaInsights([{ spend: "300", impressions: "10000", reach: "4000", inline_link_clicks: "100", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "30" }] }], 1)!;
  assert.equal(m.conversations, 30);
  assert.equal(m.costPerConversation, 10);
  assert.equal(m.leads, 0);
  assert.equal(m.costPerLead, null);
  assert.equal(m.reach, 4000);
  assert.equal(m.ctr, 1);
});
test("alcance indisponível com mais de uma conta; resultados ausentes ficam indisponíveis", () => {
  const m = aggregateMetaInsights([{ spend: "10", reach: "5" }, { spend: "20", reach: "7" }], 2)!;
  assert.equal(m.spend, 30);
  assert.equal(m.reach, null);
  assert.equal(m.results, null);
});
test("períodos", () => {
  const now = new Date("2026-11-05T15:00:00Z");
  assert.deepEqual(periodRange("last_7d", now), { since: "2026-10-30", until: "2026-11-05" });
  assert.deepEqual(periodRange("this_month", now), { since: "2026-11-01", until: "2026-11-05" });
  assert.deepEqual(periodRange("yesterday", now), { since: "2026-11-04", until: "2026-11-04" });
});
