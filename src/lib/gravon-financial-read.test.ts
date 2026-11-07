import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateFinanceInput,
  validateFunnelInput,
  financeProjection,
} from "./gravon-financial-read";
import { mapFinanceMonths } from "./finance";
import { funnelMetrics } from "./funnel-metrics";
import { createFinanceReader } from "./finance.server";
import { createCrmReadTools } from "./gravon-crm-read.server";
import { processTestRows, type TestSettings } from "./gravon-test-processing.server";

const options = { toolCallId: "fake", messages: [], context: {} };
const period = { startDate: "2026-10-01", endDate: "2026-10-31" };
const monthly = { year: 2026, startMonth: 1, endMonth: 3 };
const labels = Array.from({ length: 12 }, (_, i) => `Mês ${i + 1}`);
const months = mapFinanceMonths(labels, [1200, 0, null]);
const finance = {
  months,
  traffic: months,
  updatedAt: "2026-10-25T00:00:00Z",
  needsAuth: false,
  error: null,
};

describe("private financial and funnel contract", () => {
  it("supports only fixed 2026 months and explicit valid periods", () => {
    assert.deepEqual(validateFinanceInput(monthly), monthly);
    for (const raw of [
      { ...monthly, year: 2025 },
      { ...monthly, startMonth: 0 },
      { ...monthly, endMonth: 13 },
      { ...monthly, startMonth: 4 },
      { ...monthly, startMonth: 1.2 },
      { ...monthly, spreadsheet: "other" },
    ])
      assert.throws(() => validateFinanceInput(raw));
    assert.deepEqual(validateFunnelInput(period), period);
    for (const raw of [
      { ...period, endDate: "" },
      { ...period, startDate: "2026-02-30" },
      { ...period, startDate: "2026-11-01" },
    ])
      assert.throws(() => validateFunnelInput(raw));
  });
  it("preserves zero versus missing and reports partial totals, not invented full totals", () => {
    const projected = financeProjection(months, monthly);
    assert.equal(projected.knownSubtotal, 1200);
    assert.equal(projected.total, null);
    assert.equal(projected.complete, false);
    assert.equal(projected.months[1]?.value, 0);
    assert.equal(projected.months[1]?.status, "value");
    assert.equal(projected.months[2]?.status, "empty");
    assert.equal(financeProjection(months, { ...monthly, endMonth: 2 }).total, 1200);
    assert.equal(
      financeProjection(mapFinanceMonths(labels, ["#REF!"]), { ...monthly, endMonth: 1 }).months[0]
        ?.status,
      "error",
    );
  });
  it("uses current cumulative stages, includes loss/custom in cohort only, and null denominators for AI", () => {
    const metrics = funnelMetrics(10, [
      { stage: "lead-novo", count: 2 },
      { stage: "contato-realizado", count: 2 },
      { stage: "qualificacao", count: 2 },
      { stage: "reuniao-agendada", count: 1 },
      { stage: "fechado", count: 1 },
      { stage: "perda", count: 1 },
      { stage: "custom", count: 1 },
    ]);
    assert.deepEqual(
      metrics.map((m) => m.count),
      [10, 6, 4, 2, 1],
    );
    assert.equal(metrics[4]?.ofTotal, 10);
    assert.equal(metrics[4]?.ofPrev, 50);
    assert.equal(funnelMetrics(0, [])[0]?.hasTotalBase, false);
  });
  it("financial grant absent exposes no financial tools", () => {
    const reads = createCrmReadTools({
      authorize: async () => {},
      count: async () => ({}),
      lookup: async () => ({}),
    });
    assert.equal("monthlyFinance" in reads.tools, false);
    assert.equal("salesSummary" in reads.tools, false);
    assert.equal("closedLeadValue" in reads.tools, false);
  });
  it("shares four-call bound with ordinary reads and checks financial authorization on cache reads", async () => {
    let authorizations = 0;
    let readsCount = 0;
    let allowed = true;
    const reads = createCrmReadTools({
      authorize: async () => {},
      count: async () => ({ total: 0, stages: [] }),
      lookup: async () => ({}),
      financial: {
        authorize: async () => {
          authorizations++;
          if (!allowed) throw new Error("revoked");
        },
        finance: async () => {
          readsCount++;
          return finance;
        },
        sales: async () => ({}),
        closedValue: async () => ({}),
      },
    });
    const result = (await reads.tools.monthlyFinance?.execute?.(monthly, options)) as {
      revenue: { total: number | null };
      source: string;
    };
    assert.equal(result.revenue.total, null);
    assert.equal(result.source, "Financeiro · planilha 2026");
    await reads.tools.countLeads.execute?.(
      { stage: null, startDate: null, endDate: null },
      options,
    );
    await reads.tools.monthlyFinance?.execute?.(monthly, options);
    await reads.tools.countLeads.execute?.(
      { stage: null, startDate: null, endDate: null },
      options,
    );
    await assert.rejects(async () => reads.tools.monthlyFinance?.execute?.(monthly, options));
    assert.equal(readsCount, 2);
    assert.equal(authorizations, 2);
    const revoked = createCrmReadTools({
      authorize: async () => {},
      count: async () => ({}),
      lookup: async () => ({}),
      financial: {
        authorize: async () => {
          if (!allowed) throw new Error("revoked");
        },
        finance: async () => {
          readsCount++;
          return finance;
        },
        sales: async () => ({}),
        closedValue: async () => ({}),
      },
    });
    allowed = false;
    await assert.rejects(async () => revoked.tools.monthlyFinance?.execute?.(monthly, options));
    assert.equal(readsCount, 2);
    assert.throws(revoked.assertSuccessful);
  });
  it("funnel uses exact period and unavailable denominators", async () => {
    const reads = createCrmReadTools({
      authorize: async () => {},
      count: async (input) => {
        assert.deepEqual(input, { stage: null, ...period });
        return { total: 0, stages: [] };
      },
      lookup: async () => ({}),
    });
    const result = (await reads.tools.funnelSummary.execute?.(period, options)) as {
      steps: { ofTotal: number | null }[];
    };
    assert.equal(result.steps[0]?.ofTotal, null);
  });
  it("sales strips client revenue and identifies missing potential, homonyms omit values", async () => {
    const reads = createCrmReadTools({
      authorize: async () => {},
      count: async () => ({}),
      lookup: async () => ({}),
      financial: {
        authorize: async () => {},
        finance: async () => finance,
        sales: async () => ({ count: 2, potentialValue: 3000, missing: 1, revenue: 900000 }),
        closedValue: async () => ({
          ambiguous: true,
          hasMore: false,
          leads: [
            { id: "a", name: "Fictício", company: "Exemplo", potentialValue: 100, revenue: 900000 },
          ],
        }),
      },
    });
    const result = (await reads.tools.salesSummary?.execute?.(period, options)) as Record<
      string,
      unknown
    >;
    assert.equal(result.potentialValue, 3000);
    assert.equal(result.missing, 1);
    assert.equal(result.complete, false);
    assert.equal("revenue" in result, false);
    const lead = (await reads.tools.closedLeadValue?.execute?.(
      { field: "name", query: "Fictício" },
      options,
    )) as { leads: Record<string, unknown>[] };
    assert.equal("potentialValue" in (lead.leads[0] ?? {}), false);
  });
  it("connector failure blocks final answer, never becomes zero", async () => {
    const reads = createCrmReadTools({
      authorize: async () => {},
      count: async () => ({}),
      lookup: async () => ({}),
      financial: {
        authorize: async () => {},
        finance: async () => ({ ...finance, error: "unavailable" }),
        sales: async () => ({}),
        closedValue: async () => ({}),
      },
    });
    await assert.rejects(async () => reads.tools.monthlyFinance?.execute?.(monthly, options));
    assert.throws(reads.assertSuccessful);
  });
  it("fixed Sheets numeric reader caches 60 seconds and never reparses numeric strings", async () => {
    let calls = 0;
    let time = 0;
    const reader = createFinanceReader(
      async (url) => {
        calls++;
        const parsed = new URL(String(url));
        assert.deepEqual(parsed.searchParams.getAll("ranges"), [
          "'2026'!D1:O1",
          "'2026'!D52:O52",
          "'2026'!D55:O55",
        ]);
        return Response.json({
          valueRanges: [{ values: [labels] }, { values: [[100, "200", 0]] }, { values: [[10]] }],
        });
      },
      () => time,
    );
    const result = await reader("fake", "fake");
    assert.equal(result.months[0]?.value, 100);
    assert.equal(result.months[1]?.status, "error");
    assert.equal(result.traffic[0]?.cell, "D55");
    time = 59999;
    await reader("fake", "fake");
    assert.equal(calls, 1);
    time = 60000;
    await reader("fake", "fake");
    assert.equal(calls, 2);
  });
  it("financial revocation, read revision and own-number changes discard answer before send", async () => {
    const phone = "5511999998888";
    for (const change of [
      { crm_finance_enabled: false },
      { crm_finance_revision: "new" },
      { crm_finance_read_revision: "new" },
      { authorized_phone: "5521999998888" },
    ]) {
      let settings: TestSettings = {
        enabled: true,
        authorized_phone: phone,
        crm_read_enabled: true,
        crm_read_instance: "fake",
        crm_read_phone: phone,
        crm_read_revision: "r",
        crm_finance_enabled: true,
        crm_finance_instance: "fake",
        crm_finance_phone: phone,
        crm_finance_revision: "f",
        crm_finance_read_revision: "r",
        crm_finance_authorized_phone: phone,
      };
      let sends = 0;
      let queries = 0;
      await processTestRows(
        [
          {
            message_id: "fake-in",
            instance: "fake",
            remote_jid: `${phone}@s.whatsapp.net`,
            phone,
            from_me: true,
            body: "Receita?",
          },
        ],
        {
          settings: async () => settings,
          instances: async () => [{ name: "fake", number: phone, connectionStatus: "open" }],
          claim: async () => true,
          record: async () => {},
          generate: async (_, context) => {
            assert.ok(context.financeGrant);
            await context.authorizeFinance?.();
            queries++;
            settings = { ...settings, ...change };
            return "Receita fictícia";
          },
          send: async () => {
            sends++;
            return Response.json({});
          },
          save: async () => {},
        },
      );
      assert.equal(queries, 1);
      assert.equal(sends, 0);
    }
  });
});
