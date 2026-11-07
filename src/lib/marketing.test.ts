import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFindings, classifyOrigin, dailySeries, summarizeLeads, summarizeSources, type MarketingLead } from "./marketing";

const lead = (over: Partial<MarketingLead>): MarketingLead => ({
  id: crypto.randomUUID(), entryDate: "2026-10-10", stage: "lead-novo", closedAt: null,
  closedValue: null, closedValueConfirmed: false, source: "", utmSource: "", utmMedium: "", pipelineId: null, ...over,
});

describe("classifyOrigin", () => {
  it("classifica Google Ads por utm paga", () => {
    assert.strictEqual(classifyOrigin("Formulário", "google", "cpc"), "Google Ads");
  });
  it("classifica Meta Ads por utm paga de instagram/facebook", () => {
    assert.strictEqual(classifyOrigin("", "instagram", "paidsocial"), "Meta Ads");
    assert.strictEqual(classifyOrigin("", "facebook", "cpc"), "Meta Ads");
  });
  it("instagram orgânico não vira Meta Ads", () => {
    assert.strictEqual(classifyOrigin("", "instagram", ""), "Instagram");
  });
  it("origens B2B registradas vencem UTMs", () => {
    assert.strictEqual(classifyOrigin("Instagram - Apify", "instagram", "cpc"), "Prospecção B2B");
    assert.strictEqual(classifyOrigin("Receita Federal - CNPJ", "", ""), "Prospecção B2B");
  });
  it("Google Maps é fonte própria", () => {
    assert.strictEqual(classifyOrigin("Google Maps", "", ""), "Google Maps");
  });
  it("origem vazia é Não identificada, nunca atribuída a campanha", () => {
    assert.strictEqual(classifyOrigin("", "", ""), "Não identificada");
    assert.strictEqual(classifyOrigin("Formulário do site", "", ""), "Outras origens");
  });
  it("indicações, e-mail e whatsapp", () => {
    assert.strictEqual(classifyOrigin("Indicação de cliente", "", ""), "Indicações");
    assert.strictEqual(classifyOrigin("", "newsletter", "email"), "E-mail");
    assert.strictEqual(classifyOrigin("WhatsApp", "", ""), "WhatsApp");
  });
});

describe("summarizeLeads", () => {
  const leads = [
    lead({ stage: "qualificacao" }),
    lead({ stage: "reuniao-agendada", entryDate: "2026-10-11" }),
    lead({ stage: "fechado", closedAt: "2026-10-20", closedValue: 4000, closedValueConfirmed: true }),
    lead({ stage: "fechado", closedAt: "2026-09-20", closedValue: 9000, closedValueConfirmed: true, entryDate: "2026-09-01" }),
    lead({ stage: "perda" }),
  ];
  it("conta entradas, qualificados, reuniões e perdidos no período", () => {
    const s = summarizeLeads(leads, "2026-10-01", "2026-10-31");
    assert.strictEqual(s.leads, 4);
    assert.strictEqual(s.qualified, 3);
    assert.strictEqual(s.meetings, 2);
    assert.strictEqual(s.lost, 1);
  });
  it("vendas e receita pela data de fechamento, só valores confirmados", () => {
    const s = summarizeLeads(leads, "2026-10-01", "2026-10-31");
    assert.strictEqual(s.sales, 1);
    assert.strictEqual(s.revenue, 4000);
    assert.strictEqual(s.hasUnconfirmedSaleValue, false);
  });
  it("venda sem valor confirmado sinaliza receita subestimada", () => {
    const s = summarizeLeads([lead({ stage: "fechado", closedAt: "2026-10-20" })], "2026-10-01", "2026-10-31");
    assert.strictEqual(s.sales, 1);
    assert.strictEqual(s.revenue, 0);
    assert.strictEqual(s.hasUnconfirmedSaleValue, true);
  });
});

describe("dailySeries", () => {
  it("gera um ponto por dia e conta vendas na data de fechamento", () => {
    const s = dailySeries([lead({ entryDate: "2026-10-01" }), lead({ stage: "fechado", entryDate: "2026-10-01", closedAt: "2026-10-03" })], "2026-10-01", "2026-10-03");
    assert.strictEqual(s.length, 3);
    assert.deepStrictEqual({ leads: s[0].leads, vendas: s[0].vendas }, { leads: 2, vendas: 0 });
    assert.deepStrictEqual({ leads: s[2].leads, vendas: s[2].vendas }, { leads: 0, vendas: 1 });
  });
});

describe("summarizeSources", () => {
  it("agrupa por origem com qualificados, reuniões e clientes", () => {
    const rows = summarizeSources([
      lead({ utmSource: "google", utmMedium: "cpc", stage: "qualificacao" }),
      lead({ utmSource: "google", utmMedium: "cpc", stage: "fechado", closedAt: "2026-10-15", closedValue: 1000, closedValueConfirmed: true }),
      lead({ source: "Instagram - Apify" }),
    ], "2026-10-01", "2026-10-31");
    const g = rows.find((r) => r.origin === "Google Ads")!;
    assert.strictEqual(g.leads, 2);
    assert.strictEqual(g.qualified, 2);
    assert.strictEqual(g.clients, 1);
    assert.strictEqual(g.revenue, 1000);
    assert.strictEqual(rows.find((r) => r.origin === "Prospecção B2B")!.leads, 1);
  });
});

describe("buildFindings", () => {
  const base = {
    meta: null, google: null, eventErrors: 0, currency: "BRL",
    leads: summarizeLeads([], "2026-10-01", "2026-10-31"),
    sources: [] as ReturnType<typeof summarizeSources>,
    funnel: [] as { label: string; ofPrev: number; hasPreviousBase: boolean }[],
  };
  it("alerta investimento sem resultado, citando os números", () => {
    const f = buildFindings({ ...base, meta: { spend: 500, currency: "BRL", impressions: 1000, clicks: 50, cpc: 10, ctr: 5, results: 0, costPerResult: null, available: true, error: null } });
    assert.strictEqual(f.some((x) => x.kind === "atencao" && x.text.includes("500,00") && x.text.includes("Meta")), true);
  });
  it("plataforma indisponível vira limitação, não conclusão", () => {
    const f = buildFindings({ ...base, google: { spend: 0, currency: "", impressions: 0, clicks: 0, cpc: null, ctr: null, results: 0, costPerResult: null, available: false, error: "não conectado" } });
    assert.strictEqual(f.some((x) => x.kind === "limitacao" && x.text.includes("Google Ads")), true);
  });
  it("aponta gargalo do funil e erros de eventos", () => {
    const f = buildFindings({ ...base, eventErrors: 2, funnel: [{ label: "Qualificados", ofPrev: 20, hasPreviousBase: true }, { label: "Reunião", ofPrev: 80, hasPreviousBase: true }] });
    assert.strictEqual(f.some((x) => x.text.includes("Qualificados") && x.text.includes("20%")), true);
    assert.strictEqual(f.some((x) => x.text.includes("2 evento(s)")), true);
  });
  it("sem leads no período registra limitação", () => {
    assert.strictEqual(buildFindings(base).some((x) => x.kind === "limitacao" && x.text.includes("Nenhum lead novo")), true);
  });
});
