import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { metaRowsToAdsPayload } from "./meta-funnel-ads";
import { funnelSpendValues } from "@/components/crm/funnel-spend-values";

const account = { ad_account_id: "act_123456", account_name: "Gravon", currency: "BRL", timezone: "America/Sao_Paulo", synced_from: "2026-10-01", last_sync_at: "2026-11-04T12:00:00Z" };
const row = (adset: string, date: string, cents: number, campaign = "111") => ({ ad_account_id: "act_123456", spend_date: date, campaign_id: campaign, campaign_name: "C", adset_id: adset, spend_cents: cents, currency: "BRL", synced_at: "2026-11-04T12:00:00Z" });

describe("funnel spend from the Meta API", () => {
  it("sums ad sets of the same campaign and day once", () => {
    const p = metaRowsToAdsPayload([account], [row("a", "2026-11-01", 1050), row("b", "2026-11-01", 950)]);
    assert.equal(p.rows.length, 1);
    assert.equal(p.rows[0].spend, 20);
  });

  it("counts only campaigns linked to the selected funnel", () => {
    const p = metaRowsToAdsPayload([account], [row("a", "2026-11-01", 10000), row("b", "2026-11-01", 5000, "222")]);
    const links = [{ platform: "meta_ads", account_id: "act_123456", campaign_id: "111", pipeline_key: "main" }];
    const v = funnelSpendValues(p, links, "main", "2026-10-05", "2026-11-04");
    assert.deepEqual(v.currencies, [{ currency: "BRL", amount: 100 }]);
    assert.equal(v.partial, false);
  });

  it("flags periods before the first imported day as partial", () => {
    const p = metaRowsToAdsPayload([account], [row("a", "2026-11-01", 100)]);
    assert.equal(funnelSpendValues(p, [], "main", "2026-09-01", "2026-11-04").partial, true);
  });
});
