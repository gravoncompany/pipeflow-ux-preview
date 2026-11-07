import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGoogleMetrics, parseMetaMetrics } from "./ads-metrics";
import { safeBaseUrl } from "./custom-integrations";
test("Meta: CPC, CTR e custo por lead", () => {
  const m = parseMetaMetrics({ spend: "100", impressions: "10000", clicks: "200", reach: "8000", actions: [{ action_type: "lead", value: "10" }, { action_type: "onsite_conversion.lead_grouped", value: "10" }] }, "BRL", 2);
  assert.equal(m.cpc, 0.5); assert.equal(m.ctr, 2); assert.equal(m.results, 10); assert.equal(m.costPerResult, 10); assert.equal(m.reach, 8000);
});
test("Google: custo em micros e sem alcance", () => {
  const m = parseGoogleMetrics({ metrics: { costMicros: 50_000_000, clicks: 25, impressions: 1000, conversions: 5 } }, "BRL", 1);
  assert.equal(m.spend, 50); assert.equal(m.reach, null); assert.equal(m.costPerResult, 10);
});
test("sem cliques não calcula CPC", () => assert.equal(parseMetaMetrics({ spend: "10" }, "BRL", 0).cpc, null));
test("URL privada ou http é recusada", () => { assert.equal(safeBaseUrl("http://api.x.com"), false); assert.equal(safeBaseUrl("https://192.168.0.1"), false); assert.equal(safeBaseUrl("https://api.x.com/v1"), true); });
