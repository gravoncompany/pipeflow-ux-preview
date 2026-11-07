import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import {
  adsRange,
  adsRow,
  uniqueAdsRows,
  aggregateAds,
  pipelineAds,
  adsCost,
  adsPartial,
  type AdsPayload,
} from "./portal-ads";
import { signPortalBody } from "./portal-signing.server";
import { fetchAgencyAds } from "./portal-ads.server";

const row = adsRow.parse({
  platform: "meta_ads",
  account_id: "act_test",
  campaign_id: "campaign1",
  campaign_name: "TEST",
  date: "2026-10-01",
  spend: 100,
  currency: "BRL",
  timezone_name: "America/Sao_Paulo",
  synced_at: "2026-10-26T09:00:00Z",
});
const account = {
  platform: "meta_ads" as const,
  account_id: "act_test",
  account_name: "TEST",
  currency: "BRL",
  timezone_name: "America/Sao_Paulo",
  first_date: "2026-10-01",
  last_date: "2026-10-26",
  last_synced_at: "2026-10-26T09:00:00Z",
  status: "available" as const,
};
const page = (
  rows = [row],
  offset = 0,
  more = false,
  totals: unknown = [
    {
      platform: "meta_ads",
      account_id: "act_test",
      month: "2026-10",
      spend: 100,
      currency: "BRL",
      unknown_days: 0,
    },
  ],
) => ({
  version: "1",
  operation: "agency_ads_spend",
  result: "ok",
  queried_at: "2026-10-26T12:00:00Z",
  requested_period: { start: "2026-10-01", end: "2026-10-26" },
  data: { rows, accounts: [account], monthly_totals: totals },
  pagination: { offset, limit: 500, has_more: more },
  limitations: [],
});
const secrets = { token: "test-not-a-real-token", key: "test-not-a-real-signing-key" };

describe("Portal agency spend: simulated contract/rules", () => {
  it("signs exact documented headers and bytes, without identity", async () => {
    const body = JSON.stringify({
      operation: "agency_ads_spend",
      period: { mode: "range", start: "2026-10-01", end: "2026-10-26" },
    });
    const signed = await signPortalBody(
      body,
      secrets.token,
      secrets.key,
      "1793016000000",
      "00000000-0000-4000-8000-000000000001",
    );
    const expected = createHmac("sha256", secrets.key)
      .update(
        `1793016000000\n00000000-0000-4000-8000-000000000001\nPOST\n/api/public/gravon-ia/query\n${body}`,
      )
      .digest("hex");
    assert.equal(signed.headers["X-Gravon-Signature"], expected);
    assert.equal(signed.headers.Authorization, `Bearer ${secrets.token}`);
    assert.equal("subject" in JSON.parse(signed.body), false);
  });
  it("uses selected dates and independently authenticated server requests", async () => {
    let calls = 0;
    const transport = (async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.operation, "agency_ads_spend");
      assert.deepEqual(body.period, { mode: "range", start: "2026-10-01", end: "2026-10-26" });
      assert.equal("subject" in body, false);
      return Response.json(page());
    }) as typeof fetch;
    const data = await fetchAgencyAds("2026-10-01", "2026-10-26", secrets, transport);
    assert.equal(calls, 1);
    assert.equal(data.rows[0]?.spend, 100);
  });
  it("accepts the real Portal explicit UTC offset without changing timestamps or spend", async () => {
    const timestamp = "2026-10-27T00:40:55.98+00:00";
    const value = page([{ ...row, synced_at: timestamp }]);
    value.queried_at = "2026-10-27T00:41:10-03:00";
    value.data.accounts = [{ ...account, last_synced_at: timestamp }];
    const data = await fetchAgencyAds("2026-10-01", "2026-10-26", secrets,
      (async () => Response.json(value)) as typeof fetch);
    assert.equal(data.rows[0]?.synced_at, timestamp);
    assert.equal(data.accounts[0]?.last_synced_at, timestamp);
    assert.equal(data.rows[0]?.spend, 100);
    assert.equal(data.monthly_totals?.[0]?.spend, 100);
  });
  it("still rejects absent, malformed, impossible and timezone-less synchronization timestamps", async () => {
    for (const timestamp of [null, "not-a-date", "2026-02-30T00:40:55+00:00", "2026-10-27T00:40:55.98", "2026-10-27T25:40:55+00:00"]) {
      for (const field of ["queried_at", "synced_at", "last_synced_at"]) {
        if (field === "last_synced_at" && timestamp === null) continue;
        const value = page();
        const invalid = field === "queried_at"
          ? { ...value, queried_at: timestamp }
          : { ...value, data: { ...value.data, ...(field === "synced_at"
            ? { rows: [{ ...row, synced_at: timestamp }] }
            : { accounts: [{ ...account, last_synced_at: timestamp }] }) } };
        await assert.rejects(fetchAgencyAds("2026-10-01", "2026-10-26", secrets,
          (async () => Response.json(invalid)) as typeof fetch), /incomplete_response/);
      }
    }
  });
  it("fetches all pages with new request IDs; repeated sync has no duplicated amounts", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      ...row,
      campaign_id: `test-${i}`,
      spend: 1,
    }));
    const ids = new Set<string>();
    let calls = 0;
    const transport = (async (_url, init) => {
      calls++;
      const h = new Headers(init?.headers);
      const id = h.get("X-Gravon-Request-Id") ?? "";
      assert.equal(ids.has(id), false);
      ids.add(id);
      const offset = JSON.parse(String(init?.body)).offset;
      return Response.json(
        page(rows.slice(offset, offset + 500), offset, offset === 0, [
          {
            platform: "meta_ads",
            account_id: "act_test",
            month: "2026-10",
            spend: 501,
            currency: "BRL",
            unknown_days: 0,
          },
        ]),
      );
    }) as typeof fetch;
    for (let i = 0; i < 2; i++) {
      const data = await fetchAgencyAds("2026-10-01", "2026-10-26", secrets, transport);
      assert.equal(data.rows.length, 501);
      assert.equal(aggregateAds(data.rows)[0]?.amount, 501);
    }
    assert.equal(calls, 4);
  });
  it("repeated daily key deduplicates and changed duplicates fail closed", () => {
    assert.equal(uniqueAdsRows([row, { ...row }]).length, 1);
    assert.throws(() => uniqueAdsRows([row, { ...row, spend: 200 }]), /source_changed/);
  });
  it("pipeline totals use only explicit platform/account/campaign links", () => {
    const payload: AdsPayload = {
      rows: [row, { ...row, campaign_id: "other", spend: 300 }],
      accounts: [account],
      monthly_totals: null,
      limitations: [],
    };
    const links = [
      {
        platform: row.platform,
        account_id: row.account_id,
        campaign_id: row.campaign_id,
        pipeline_key: "main",
      },
    ];
    assert.equal(pipelineAds(payload, links, "main")[0]?.amount, 100);
    assert.deepEqual(pipelineAds(payload, links, "outbound"), []);
    assert.equal(aggregateAds(payload.rows)[0]?.amount, 400);
  });
  it("different currencies and platforms are never summed together", () => {
    const totals = aggregateAds([
      row,
      { ...row, account_id: "usd", spend: 50, currency: "USD" },
      { ...row, platform: "google_ads", spend: 20 },
    ]);
    assert.equal(totals.length, 3);
    assert.equal(totals.find((t) => t.currency === "USD")?.amount, 50);
    assert.equal(
      totals.find((t) => t.platform === "meta_ads" && t.currency === "BRL")?.amount,
      100,
    );
  });
  it("missing rows, unknown spends and incomplete coverage never become confirmed zero", () => {
    assert.deepEqual(aggregateAds([]), []);
    assert.deepEqual(aggregateAds([{ ...row, spend: null }])[0], {
      platform: "meta_ads",
      currency: "BRL",
      month: "2026-10",
      amount: null,
      unknown: 1,
    });
    assert.equal(
      adsPartial(
        { rows: [row], accounts: [account], monthly_totals: null, limitations: [] },
        "2026-01-01",
        "2026-10-26",
      ),
      true,
    );
  });
  it("zero denominator is not calculable; real zero spend is preserved", () => {
    assert.equal(adsCost(100, 0), null);
    assert.equal(adsCost(null, 2), null);
    assert.equal(adsCost(0, 2), 0);
    assert.equal(adsCost(3859, 6), 3859 / 6);
  });
  it("monthly representation is reconciled, never added again", async () => {
    const data = await fetchAgencyAds("2026-10-01", "2026-10-26", secrets, (async () =>
      Response.json(page())) as typeof fetch);
    assert.equal(aggregateAds(data.rows)[0]?.amount, 100);
    await assert.rejects(
      fetchAgencyAds("2026-10-01", "2026-10-26", secrets, (async () =>
        Response.json(page([row], 0, false, []))) as typeof fetch),
      /incomplete_response/,
    );
  });
  it("rejects account leakage, incomplete pagination, redirects and invalid authentication", async () => {
    for (const bad of [page([{ ...row, account_id: "client" }]), page([row], 0, true)]) {
      await assert.rejects(
        fetchAgencyAds("2026-10-01", "2026-10-26", secrets, (async () =>
          Response.json(bad)) as typeof fetch),
        /incomplete_response/,
      );
    }
    await assert.rejects(
      fetchAgencyAds(
        "2026-10-01",
        "2026-10-26",
        secrets,
        (async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "https://example.com" },
          })) as typeof fetch,
      ),
    );
    await assert.rejects(
      fetchAgencyAds("2026-10-01", "2026-10-26", secrets, (async () =>
        Response.json({ error: "invalid_credential" }, { status: 401 })) as typeof fetch),
      /invalid_credential/,
    );
  });
  it("no agency accounts is a specific blocker, not zero", async () => {
    const value = page([]);
    value.data.accounts = [];
    await assert.rejects(
      fetchAgencyAds("2026-10-01", "2026-10-26", secrets, (async () =>
        Response.json(value)) as typeof fetch),
      /no_agency_accounts/,
    );
  });
  it("range validation rejects invalid calendar dates and excessive ranges", () => {
    assert.equal(adsRange.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success, false);
    assert.equal(adsRange.safeParse({ from: "2025-01-01", to: "2026-10-26" }).success, false);
  });
});
