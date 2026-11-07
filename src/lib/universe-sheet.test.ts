import { test } from "node:test";
import assert from "node:assert/strict";
import { cellToCents, parseUniverseSheet, sheetReceipts, sheetAwards, universeCard, sheetMetrics, UNIVERSE_RANGES } from "./universe-sheet";
import { createUniverseSheetReader } from "./universe-sheet.server";
import { MONTHLY_TARGETS, LIFETIME_TARGETS, journeyProgress } from "./gravon-universe";

const HEADER = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const label = (t: string) => Array(12).fill(t);
// Valores no formato da planilha real (jan–out preenchidos, nov/dez vazios) — números fictícios para teste.
const REV = [18334, 19045, 20787, 20292, 19935, 20349, 16149, 17871, 18174, 17082];
const TRAF = [1455.02, 728, 2552.97, 2398.46, 2667.91, 2944.55, 2537.21, 4210.88, 2987.54, 3859.08];

test("valores: número, texto pt-BR e vazio; texto não numérico é inválido", () => {
  assert.equal(cellToCents(18334), 1833400); assert.equal(cellToCents("R$ 18.334,00"), 1833400); assert.equal(cellToCents("1455,02"), 145502);
  assert.equal(cellToCents(""), null); assert.equal(cellToCents(undefined), null); assert.equal(cellToCents("pendente"), "invalid");
});
test("estrutura real: meses E–P, 'Valor Total' (51/52) e 'Tráfego' (54/55); mês vazio fica nulo", () => {
  const p = parseUniverseSheet(HEADER, [label("Valor Total"), REV], [label("Tráfego"), TRAF]);
  assert.equal(p.ok, true); if (!p.ok) return;
  assert.equal(p.revenue[0].cents, 1833400); assert.equal(p.revenue[0].cell, "E52"); assert.equal(p.revenue[11].cell, "P52");
  assert.equal(p.revenue[10].cents, null); assert.equal(p.traffic[7].cents, 421088); assert.equal(p.traffic[0].cell, "E55");
  assert.equal(UNIVERSE_RANGES.revenue, "'2026'!E51:P52");
});
test("planilha mudou de formato: falha com aviso (nunca lê a linha errada)", () => {
  assert.equal(parseUniverseSheet(["Data", ...HEADER.slice(0, 11)], [label("Valor Total"), REV], [label("Tráfego"), TRAF]).ok, false); // leitura D–O antiga
  assert.match(String((parseUniverseSheet(HEADER, [label("Cliente X"), REV], [label("Tráfego"), TRAF]) as { error: string }).error), /Valor Total/);
  assert.match(String((parseUniverseSheet(HEADER, [label("Valor Total"), REV], [label("Valor Total"), TRAF]) as { error: string }).error), /Tráfego/);
  assert.match(String((parseUniverseSheet(HEADER, [label("Valor Total"), ["abc"]], [label("Tráfego"), TRAF]) as { error: string }).error), /E52/);
});
test("regras originais do Universe com dados da planilha: métricas, progresso e conquistas", () => {
  const p = parseUniverseSheet(HEADER, [label("Valor Total"), REV], [label("Tráfego"), TRAF]); if (!p.ok) throw new Error("parse");
  const asOf = "2026-11-03";
  const receipts = sheetReceipts(p.revenue, asOf);
  assert.equal(receipts.length, 10); assert.ok(receipts.every(r => r.status === "confirmada" && !r.editable && r.date <= asOf));
  const m = sheetMetrics(p.revenue, asOf);
  assert.equal(m.current, 0); assert.equal(m.previous, 1708200); assert.equal(m.record, 2078700); assert.equal(m.accumulated, REV.reduce((a, b) => a + b, 0) * 100);
  const targets = { monthly: MONTHLY_TARGETS, lifetime: LIFETIME_TARGETS };
  const awards = sheetAwards(receipts, targets, asOf);
  assert.ok(awards.some(a => a.journey === "monthly" && a.amount === 2000000)); // recorde 20.787 ≥ 20 mil
  assert.ok(!awards.some(a => a.journey === "monthly" && a.amount === 3000000));
  assert.equal(journeyProgress("monthly", MONTHLY_TARGETS, awards, m).next, 3000000);
  // Tráfego nunca entra como receita.
  assert.ok(!receipts.some(r => r.description.toLowerCase().includes("tráfego")));
});
test("card: faturamento do mês, meta de R$ 50 mil, percentual e quanto falta; mês sem valor não vira zero", () => {
  const months = HEADER.map((l, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, label: l, cents: i === 9 ? 2000000 : null, cell: "" }));
  assert.deepEqual(universeCard(months, "2026-10-20"), { month: "2026-10", monthLabel: "Outubro", revenueCents: 2000000, goalCents: 5000000, percent: 40, remainingCents: 3000000 });
  const nov = universeCard(months, "2026-11-03"); assert.equal(nov.revenueCents, null); assert.equal(nov.percent, 0);
  assert.equal(universeCard([{ ...months[9], cents: 7000000 }], "2026-10-01").percent, 100);
});
test("leitor: somente leitura pelo conector, cache de 60 s, sincronização forçada e erro sem valores", async () => {
  let calls = 0; const urls: string[] = [];
  const ok = async (u: string | URL | Request, init?: RequestInit) => { calls++; urls.push(String(u)); assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer g"); assert.equal(init?.method ?? "GET", "GET");
    return new Response(JSON.stringify({ valueRanges: [{ values: [HEADER] }, { values: [label("Valor Total"), REV] }, { values: [label("Tráfego"), TRAF] }] }), { status: 200 }); };
  let t = 0; const read = createUniverseSheetReader(ok as typeof fetch, () => t);
  const a = await read("g", "s"); assert.equal(a.error, null); assert.equal(a.revenue[0].cents, 1833400);
  assert.ok(urls[0].includes("values:batchGet")); assert.deepEqual(new URL(urls[0]).searchParams.getAll("ranges"), ["'2026'!E1:P1", "'2026'!E51:P52", "'2026'!E54:P55"]);
  await read("g", "s"); assert.equal(calls, 1); await read("g", "s", true); assert.equal(calls, 2); t = 61_000; await read("g", "s"); assert.equal(calls, 3);
  const fail = createUniverseSheetReader((async () => new Response("x", { status: 403 })) as typeof fetch);
  const f = await fail("g", "s"); assert.match(f.error ?? "", /HTTP 403/); assert.deepEqual(f.revenue, []);
  assert.match((await createUniverseSheetReader(ok as typeof fetch)(undefined, "s")).error ?? "", /não está disponível/);
});

test("interface do laboratório recebe o mês certo (E–P) — a leitura D–O antiga deslocaria os meses", async () => {
  const { toFinanceMonths } = await import("./universe-sheet");
  const { currentMonthIndex, revenueFor, journeyProgress, JOURNEYS } = await import("./gravon-universe-journey");
  const p = parseUniverseSheet(HEADER, [label("Valor Total"), REV], [label("Tráfego"), TRAF]); if (!p.ok) throw new Error("parse");
  const months = toFinanceMonths(p.revenue);
  assert.equal(months.length, 12); assert.equal(months[0].month, "Janeiro"); assert.equal(months[9].value, 17082); assert.equal(months[10].value, null); assert.equal(months[10].status, "empty");
  const oct = currentMonthIndex(new Date("2026-10-20T12:00:00-03:00"), 2026); assert.equal(oct, 9);
  assert.equal(revenueFor("mensal", months, oct), 17082);
  const prog = journeyProgress(17082, JOURNEYS.mensal.milestones); assert.equal(prog.current?.name, "Lua"); assert.equal(prog.next?.name, "Mercúrio"); assert.equal(prog.achieved, 1);
  // Com a leitura antiga (rótulos D1:O1 = "Data", Janeiro…Novembro), o índice de outubro apontaria para setembro.
  const shifted = [{ month: "Data", value: null }, ...months.slice(0, 11)];
  assert.equal(shifted[oct].month, "Setembro");
});
