import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateSpend, parseInsights, periodRange, spendToCents } from "./meta-ads-spend";

const row = (date: string, adset: string, spend: string, campaign = "1") => ({ campaign_id: campaign, campaign_name: `C${campaign}`, adset_id: adset, adset_name: `A${adset}`, spend, account_currency: "BRL", date_start: date });

describe("investimento Meta Ads", () => {
  it("converte o gasto da Meta para centavos sem arredondamento de ponto flutuante", () => {
    assert.equal(spendToCents("41.82"), 4182);
    assert.equal(spendToCents("0.1"), 10);
    assert.equal(spendToCents("10"), 1000);
    assert.equal(spendToCents("1.005"), 101);
    assert.equal(spendToCents("-3"), null);
    assert.equal(spendToCents("abc"), null);
  });

  it("reimportar o mesmo dia e conjunto substitui o valor, não soma", () => {
    const { rows } = parseInsights([row("2026-11-01", "9", "10.00"), row("2026-11-01", "9", "12.50"), row("2026-11-01", "8", "5")]);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.adset_id === "9")?.spend_cents, 1250);
  });

  it("descarta linhas inválidas", () => {
    const r = parseInsights([{ spend: "1" }, row("2026-11-01", "x", "1"), row("2026-11-01", "7", "1")]);
    assert.equal(r.rows.length, 1); assert.equal(r.rejected, 2);
  });

  it("períodos: 7 dias e 30 dias incluem hoje; mês atual começa no dia 1", () => {
    assert.deepEqual(periodRange("7d", "2026-11-04"), { from: "2026-10-29", to: "2026-11-04" });
    assert.deepEqual(periodRange("30d", "2026-11-04"), { from: "2026-10-06", to: "2026-11-04" });
    assert.deepEqual(periodRange("month", "2026-11-04"), { from: "2026-11-01", to: "2026-11-04" });
    assert.deepEqual(periodRange("custom", "2026-11-04", { from: "2026-09-01", to: "2026-09-30" }), { from: "2026-09-01", to: "2026-09-30" });
  });

  it("total, média diária com dias sem gasto e totais por campanha e conjunto", () => {
    const { rows } = parseInsights([row("2026-11-01", "1", "10"), row("2026-11-01", "2", "5", "2"), row("2026-11-03", "1", "15"), row("2026-10-20", "1", "100")]);
    const a = aggregateSpend(rows, "2026-11-01", "2026-11-04");
    assert.equal(a.totalCents, 3000);
    assert.equal(a.days.length, 4);
    assert.equal(a.days[1].cents, 0);
    assert.equal(a.dailyAverageCents, 750);
    assert.equal(a.campaigns[0].id, "1"); assert.equal(a.campaigns[0].cents, 2500);
    assert.equal(a.campaigns[0].adsets[0].cents, 2500);
  });
});
