import { test } from "node:test";
import assert from "node:assert/strict";
import { presetRange, fullMonths, bucketOf, commercialMetrics, financialMetrics, originGroup, type DashLead } from "./dashboard";

const lead = (over: Partial<DashLead>): DashLead => ({ id: crypto.randomUUID(), entryDate: "2026-11-02", stage: "lead-novo", pipelineId: null, closedAt: null, source: "Zapier", utmSource: "", utmMedium: "", tags: [], ...over });

test("period presets use inclusive São Paulo days", () => {
  assert.deepEqual(presetRange("7d", "2026-11-03"), { from: "2026-10-28", to: "2026-11-03" });
  assert.deepEqual(presetRange("month", "2026-11-03"), { from: "2026-11-01", to: "2026-11-03" });
  assert.deepEqual(presetRange("prev-month", "2026-03-10"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(presetRange("today", "2026-11-03"), { from: "2026-11-03", to: "2026-11-03" });
});

test("the monthly spreadsheet only fills whole months inside the period", () => {
  assert.deepEqual(fullMonths("2026-10-01", "2026-11-03"), ["2026-10"]);
  assert.deepEqual(fullMonths("2026-11-01", "2026-11-03"), []);
});

test("weekly buckets start on Monday", () => {
  assert.equal(bucketOf("2026-11-05", "week"), "2026-11-02");
  assert.equal(bucketOf("2026-11-05", "month"), "2026-11");
});

test("qualified counts stages from Qualificação on, never Perda; sales use the closing date", () => {
  const m = commercialMetrics([
    lead({ stage: "qualificacao" }), lead({ stage: "perda" }), lead({ stage: "aguardando-decisao" }),
    lead({ stage: "fechado", entryDate: "2026-09-01", closedAt: "2026-11-02" }), lead({ stage: "tentando-contato" }),
  ], "2026-11-01", "2026-11-03");
  assert.equal(m.received, 4);
  assert.equal(m.qualified, 2);
  assert.equal(m.negotiation, 1);
  assert.equal(m.sales, 1);
});

test("missing revenue or expenses never become zero; result needs both", () => {
  const f = financialMetrics({ revenue: { total: null, source: null, note: "" }, expenses: { total: 500, note: "" }, investment: { total: null, source: null, note: "Conecte" }, newCustomers: 2, pendingClassifications: 0 }, 10, 2);
  assert.equal(f.revenue.state, "unavailable");
  assert.equal(f.result.value, null);
  assert.equal(f.cpl.state, "integration");
});

test("ROI, cost per lead and CAC use only identified investment and confirmed customers", () => {
  const f = financialMetrics({ revenue: { total: 3000, source: "crm", note: "" }, expenses: { total: 1000, note: "" }, investment: { total: 1000, source: "portal", note: "" }, newCustomers: 2, pendingClassifications: 0 }, 20, 3);
  assert.equal(f.result.value, 2000);
  assert.equal(f.roi.value, 200);
  assert.equal(f.cpl.value, 50);
  assert.equal(f.cac.value, 500);
  assert.equal(f.ticket.value, 1000);
  const pending = financialMetrics({ revenue: { total: 3000, source: "crm", note: "" }, expenses: { total: 0, note: "" }, investment: { total: 1000, source: "portal", note: "" }, newCustomers: 2, pendingClassifications: 1 }, 20, 3);
  assert.equal(pending.cac.value, null);
});

test("origins come only from recorded source, UTM or tags", () => {
  assert.equal(originGroup(lead({ utmSource: "facebook" }), null), "Meta Ads");
  assert.equal(originGroup(lead({ tags: ["google-ads"] }), null), "Google Ads");
  assert.equal(originGroup(lead({ source: "Prospecção B2B" }), null), "Prospecção B2B");
  assert.equal(originGroup(lead({ source: "Zapier" }), null), "Zapier");
});
