import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  ACCUMULATED_GOAL,
  ACCUMULATED_MILESTONES,
  ACCUMULATED_NODES,
  JOURNEYS,
  MONTHLY_MILESTONES,
  MONTHLY_NODES,
  achievementMonths,
  buildSegments,
  compactBrl,
  confirmedValue,
  currentMonthIndex,
  historyRows,
  journeyProgress,
  pointAtPosition,
  progressSegments,
  revenueFor,
  stars,
  type MonthValue,
} from "./gravon-universe-journey";

const names = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const lab: MonthValue[] = names.map((month, i) => ({
  month,
  value: 2000 + i * 500,
  status: "value",
}));
const month = (
  name: string,
  value: number | null,
  status: MonthValue["status"] = "value",
): MonthValue => ({ month: name, value, status });

describe("Gravon Universe · metas separadas", () => {
  it("Jornada Mensal usa exatamente as metas de 10 a 50 mil", () => {
    assert.deepEqual(
      MONTHLY_MILESTONES.map((m) => m.threshold),
      [10_000, 20_000, 30_000, 40_000, 50_000],
    );
  });

  it("Jornada Acumulada é progressiva e termina em R$ 10 milhões", () => {
    const t = ACCUMULATED_MILESTONES.map((m) => m.threshold);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1]);
    assert.equal(t.at(-1), 10_000_000);
    assert.equal(ACCUMULATED_GOAL, 10_000_000);
  });

  it("não mistura metas nem planetas entre as jornadas", () => {
    const monthlyIds = new Set(MONTHLY_MILESTONES.map((m) => m.id));
    assert.ok(ACCUMULATED_MILESTONES.every((m) => !monthlyIds.has(m.id)));
    assert.equal(JOURNEYS.mensal.milestones, MONTHLY_MILESTONES);
    assert.equal(JOURNEYS.acumulada.milestones, ACCUMULATED_MILESTONES);
    assert.equal(MONTHLY_NODES.length, MONTHLY_MILESTONES.length + 1);
    assert.equal(ACCUMULATED_NODES.length, ACCUMULATED_MILESTONES.length + 1);
  });

  it("o mesmo valor gera progressos independentes em cada jornada", () => {
    const m = journeyProgress(45_000, MONTHLY_MILESTONES);
    const a = journeyProgress(45_000, ACCUMULATED_MILESTONES);
    assert.equal(m.current?.id, "terra");
    assert.equal(m.next?.id, "marte");
    assert.equal(m.remaining, 5_000);
    assert.equal(a.current, null);
    assert.equal(a.next?.id, "ceres");
    assert.equal(a.percentToNext, 90);
  });
});

describe("Gravon Universe · progresso", () => {
  it("calcula percentual, restante e posição antes da primeira meta mensal", () => {
    const p = journeyProgress(7000, MONTHLY_MILESTONES);
    assert.equal(p.achieved, 0);
    assert.equal(p.next?.id, "lua");
    assert.equal(p.percentToNext, 70);
    assert.equal(p.remaining, 3000);
    assert.equal(p.position, 0.7);
  });

  it("valor exato desbloqueia a meta; acima da última encerra a jornada", () => {
    assert.equal(journeyProgress(10_000, MONTHLY_MILESTONES).current?.id, "lua");
    const done = journeyProgress(60_000, MONTHLY_MILESTONES);
    assert.equal(done.next, null);
    assert.equal(done.remaining, 0);
    assert.equal(done.position, MONTHLY_MILESTONES.length);
    assert.equal(journeyProgress(10_000_000, ACCUMULATED_MILESTONES).current?.id, "sol");
    assert.equal(journeyProgress(9_999_999.99, ACCUMULATED_MILESTONES).next?.id, "sol");
  });

  it("trata valores ausentes, negativos ou inválidos como zero no progresso", () => {
    for (const v of [0, -10, Number.NaN]) {
      const p = journeyProgress(v, ACCUMULATED_MILESTONES);
      assert.equal(p.value, 0);
      assert.equal(p.position, 0);
    }
  });
});

describe("Gravon Universe · integração financeira", () => {
  it("considera apenas valores confirmados válidos; vazio e erro não contam", () => {
    assert.equal(confirmedValue(month("Jan", 5000)), 5000);
    assert.equal(confirmedValue(month("Jan", null, "empty")), 0);
    assert.equal(confirmedValue(month("Jan", 999, "error")), 0);
    assert.equal(confirmedValue(undefined), 0);
  });

  it("Mensal reinicia a cada mês e permite consultar meses anteriores", () => {
    const data = [month("Outubro", 52_000), month("Novembro", null, "empty")];
    assert.equal(revenueFor("mensal", data, 1), 0);
    assert.equal(journeyProgress(revenueFor("mensal", data, 1), MONTHLY_MILESTONES).achieved, 0);
    assert.equal(revenueFor("mensal", data, 0), 52_000);
    assert.equal(journeyProgress(revenueFor("mensal", data, 0), MONTHLY_MILESTONES).achieved, 5);
  });

  it("Acumulada nunca reinicia e soma cada mês uma única vez", () => {
    assert.equal(revenueFor("mensal", lab, 10), 7000);
    assert.equal(revenueFor("acumulada", lab, 10), 49_500);
    assert.equal(
      revenueFor("acumulada", lab, 10),
      lab.slice(0, 11).reduce((s, m) => s + (m.value ?? 0), 0),
    );
    const rows = historyRows(lab, 10);
    assert.equal(rows.at(-1)?.cumulative, revenueFor("acumulada", lab, 10));
    for (let i = 1; i < rows.length; i++)
      assert.equal(rows[i].cumulative - rows[i - 1].cumulative, rows[i].confirmed);
  });

  it("cancelamentos e correções negativas reduzem o acumulado e podem rebloquear planetas", () => {
    const data = [month("Janeiro", 60_000), month("Fevereiro", -15_000)];
    assert.equal(revenueFor("acumulada", data, 0), 60_000);
    assert.equal(revenueFor("acumulada", data, 1), 45_000);
    assert.equal(
      journeyProgress(revenueFor("acumulada", data, 1), ACCUMULATED_MILESTONES).current,
      null,
    );
    const rows = historyRows(data, 1);
    assert.deepEqual(
      rows[0].unlocked.map((m) => m.id),
      ["ceres"],
    );
    assert.deepEqual(rows[1].unlocked, []);
    assert.equal(rows[1].accumulated, null);
  });

  it("célula com erro não entra no acumulado", () => {
    const data = [
      month("Janeiro", 30_000),
      month("Fevereiro", 40_000, "error"),
      month("Março", 25_000),
    ];
    assert.equal(revenueFor("acumulada", data, 2), 55_000);
  });

  it("não usa meses futuros nem anos ainda não iniciados", () => {
    assert.equal(revenueFor("acumulada", lab, 10), 49_500);
    assert.equal(revenueFor("acumulada", lab, -1), 0);
    assert.equal(historyRows(lab, -1).length, 0);
  });

  it("usa o mês de São Paulo e limita anos fora do Financeiro", () => {
    assert.equal(currentMonthIndex(new Date("2026-11-02T12:00:00Z"), 2026), 10);
    assert.equal(currentMonthIndex(new Date("2026-12-01T01:00:00Z"), 2026), 10);
    assert.equal(currentMonthIndex(new Date("2027-03-01T12:00:00Z"), 2026), 11);
    assert.equal(currentMonthIndex(new Date("2025-03-01T12:00:00Z"), 2026), -1);
  });
});

describe("Gravon Universe · histórico", () => {
  it("preserva o planeta mensal de cada mês e o mês de conquista acumulada", () => {
    const data = [month("Janeiro", 12_000), month("Fevereiro", 41_000), month("Março", 3_000)];
    const rows = historyRows(data, 2);
    assert.deepEqual(
      rows.map((r) => r.monthly?.id ?? null),
      ["lua", "terra", null],
    );
    assert.deepEqual(
      rows.map((r) => r.monthlyPercent),
      [60, 82, 30],
    );
    assert.equal(rows[1].accumulated?.id, "ceres");
    assert.deepEqual(achievementMonths("mensal", data, 2, MONTHLY_MILESTONES[0]), [
      "Janeiro",
      "Fevereiro",
    ]);
    assert.deepEqual(achievementMonths("acumulada", data, 2, ACCUMULATED_MILESTONES[0]), [
      "Fevereiro",
    ]);
    assert.deepEqual(achievementMonths("acumulada", lab, 10, ACCUMULATED_MILESTONES[0]), []);
  });
});

describe("Gravon Universe · cena", () => {
  it("desenha o progresso sobre o caminho de cada jornada", () => {
    for (const nodes of [MONTHLY_NODES, ACCUMULATED_NODES]) {
      const segs = buildSegments(nodes);
      assert.equal(segs.length, nodes.length - 1);
      assert.deepEqual(pointAtPosition(segs, 0), nodes[0]);
      assert.deepEqual(pointAtPosition(segs, segs.length), nodes.at(-1));
      assert.equal(progressSegments(segs, 0).length, 0);
      assert.deepEqual(progressSegments(segs, 2.5)[2][3], pointAtPosition(segs, 2.5));
    }
  });

  it("formata valores compactos e gera estrelas determinísticas", () => {
    assert.equal(compactBrl(10_000), "R$ 10 mil");
    assert.equal(compactBrl(3_500_000), "R$ 3,5 mi");
    assert.equal(compactBrl(10_000_000), "R$ 10 mi");
    assert.deepEqual(stars(5), stars(5));
  });
});
