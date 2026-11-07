import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { acquisitionValue, funnelSpendValues } from "./funnel-spend-values";
import type { AdsPayload, AdsLink } from "@/lib/portal-ads";

const payload: AdsPayload = {
  rows: [
    {
      platform: "meta_ads",
      account_id: "act_test",
      campaign_id: "one",
      campaign_name: "Same name",
      date: "2026-10-01",
      spend: 3859,
      currency: "BRL",
      timezone_name: "America/Sao_Paulo",
      synced_at: "2026-10-26T12:00:00Z",
    },
    {
      platform: "meta_ads",
      account_id: "act_test",
      campaign_id: "two",
      campaign_name: "Same name",
      date: "2026-10-01",
      spend: 100,
      currency: "USD",
      timezone_name: "America/Sao_Paulo",
      synced_at: "2026-10-26T12:00:00Z",
    },
    {
      platform: "meta_ads",
      account_id: "act_test",
      campaign_id: "one",
      campaign_name: "Same name",
      date: "2026-09-01",
      spend: 900,
      currency: "BRL",
      timezone_name: "America/Sao_Paulo",
      synced_at: "2026-10-26T12:00:00Z",
    },
  ],
  accounts: [],
  monthly_totals: null,
  limitations: [],
};
const links: AdsLink[] = [
  { platform: "meta_ads", account_id: "act_test", campaign_id: "one", pipeline_key: "main" },
  {
    platform: "meta_ads",
    account_id: "act_test",
    campaign_id: "two",
    pipeline_key: "implementation",
  },
];
describe("Funnel acquisition presentation rules", () => {
  it("never invents zero or associations when none exist", () => {
    assert.deepEqual(
      funnelSpendValues(payload, [], "main", "2026-10-01", "2026-10-26").currencies,
      [],
    );
    assert.equal(
      funnelSpendValues(payload, [], "main", "2026-10-01", "2026-10-26").hasLinks,
      false,
    );
  });
  it("selects exact campaign IDs and dates, not names or whole accounts", () => {
    assert.deepEqual(
      funnelSpendValues(payload, links, "main", "2026-10-01", "2026-10-26").currencies,
      [{ currency: "BRL", amount: 3859 }],
    );
    assert.deepEqual(
      funnelSpendValues(payload, links, "implementation", "2026-10-01", "2026-10-26").currencies,
      [{ currency: "USD", amount: 100 }],
    );
  });
  it("keeps currencies separate even within the same funnel", () => {
    assert.equal(
      funnelSpendValues(
        payload,
        links.map((l) => ({ ...l, pipeline_key: "main" })),
        "main",
        "2026-10-01",
        "2026-10-26",
      ).currencies.length,
      2,
    );
  });
  it("keeps absent spend distinct from confirmed zero", () => {
    assert.equal(acquisitionValue(null, 6).state, "missing");
    assert.deepEqual(acquisitionValue(0, 6), { state: "known", value: 0 });
  });
  it("marks a zero denominator not calculable", () => {
    assert.equal(acquisitionValue(3859, 0).state, "zero-denominator");
  });
  it("does not turn won opportunities into verified acquired customers", () => {
    assert.equal(acquisitionValue(3859, null).state, "unverified");
  });
  it("divides known spend by an eligible CRM denominator", () => {
    assert.equal(acquisitionValue(3859, 6).value, 3859 / 6);
  });
  it("blocks the CAC while closings are pending classification", () => {
    assert.deepEqual(acquisitionValue(3859, 2, { cac: true, pending: 3 }), {
      state: "pending",
      value: null,
    });
  });
  it("marks a reviewed period with no new customers as not calculable", () => {
    assert.deepEqual(acquisitionValue(3859, 0, { cac: true, pending: 0 }), {
      state: "no-new",
      value: null,
    });
  });
  it("keeps confirmed zero spend as R$ 0,00 when new customers exist", () => {
    assert.deepEqual(acquisitionValue(0, 2, { cac: true, pending: 0 }), {
      state: "known",
      value: 0,
    });
  });
  it("divides eligible spend by unique new customers", () => {
    assert.equal(acquisitionValue(3859, 2, { cac: true, pending: 0 }).value, 3859 / 2);
  });
  it("signals partial coverage and keeps all-unknown spend absent", () => {
    const data = { ...payload, rows: payload.rows.map((r) => ({ ...r, spend: null })) };
    const result = funnelSpendValues(data, links, "main", "2026-10-01", "2026-10-26");
    assert.equal(result.partial, true);
    assert.equal(result.currencies[0]?.amount, null);
  });
});
