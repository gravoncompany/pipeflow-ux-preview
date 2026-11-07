// Gravon Universe: jornada de receita confirmada em marcos (planetas).
// Lógica pura, sem acesso a rede ou banco; os valores vêm do Financeiro.

export type UniverseMode = "mensal" | "acumulada";

export type Milestone = {
  id: string;
  name: string;
  threshold: number;
  description: string;
  /** Diâmetro do planeta em unidades da cena (largura 1000). */
  size: number;
  palette: { light: string; base: string; dark: string };
  ring?: boolean;
  star?: boolean;
};

/** Metas da Jornada Mensal: reiniciam a cada mês. */
export const MONTHLY_MILESTONES: readonly Milestone[] = [
  {
    id: "lua",
    name: "Lua",
    threshold: 10_000,
    size: 58,
    description: "Primeiro pouso do mês: a receita confirmada mostra que a operação saiu do chão.",
    palette: { light: "#ece8df", base: "#a29d93", dark: "#3d3a35" },
  },
  {
    id: "mercurio",
    name: "Mercúrio",
    threshold: 20_000,
    size: 62,
    description: "Ritmo acelerado: a rotina comercial gera receita com constância no mês.",
    palette: { light: "#e2cfb2", base: "#9a8266", dark: "#3a2f25" },
  },
  {
    id: "venus",
    name: "Vênus",
    threshold: 30_000,
    size: 68,
    description: "Brilho próprio: fechamentos recorrentes e previsibilidade no mês.",
    palette: { light: "#f8e2b0", base: "#cf9f55", dark: "#5c3d16" },
  },
  {
    id: "terra",
    name: "Terra",
    threshold: 40_000,
    size: 72,
    description: "Base habitável: a receita do mês sustenta a operação e o time.",
    palette: { light: "#a8e0ff", base: "#2f86b8", dark: "#0d2f4f" },
  },
  {
    id: "marte",
    name: "Marte",
    threshold: 50_000,
    size: 78,
    description: "Território novo: a meta mensal máxima desta jornada.",
    palette: { light: "#f5b08c", base: "#b9532d", dark: "#4a1a0c" },
  },
];

/** Metas da Jornada Acumulada: nunca reiniciam; objetivo final de R$ 10 milhões. */
export const ACCUMULATED_MILESTONES: readonly Milestone[] = [
  {
    id: "ceres",
    name: "Ceres",
    threshold: 50_000,
    size: 44,
    description: "Primeiro marco acumulado: os primeiros R$ 50 mil confirmados.",
    palette: { light: "#d9d4c7", base: "#8c857a", dark: "#34302b" },
  },
  {
    id: "jupiter",
    name: "Júpiter",
    threshold: 100_000,
    size: 62,
    description: "Gigante: seis dígitos em receita confirmada acumulada.",
    palette: { light: "#f4dcb6", base: "#b98552", dark: "#4f2f16" },
  },
  {
    id: "saturno",
    name: "Saturno",
    threshold: 250_000,
    size: 56,
    ring: true,
    description: "Anéis de crescimento: um quarto de milhão acumulado.",
    palette: { light: "#f8e8bf", base: "#c9a35e", dark: "#5a4220" },
  },
  {
    id: "urano",
    name: "Urano",
    threshold: 500_000,
    size: 54,
    description: "Órbita própria: meio milhão em receita confirmada.",
    palette: { light: "#d2f6f3", base: "#5fb7bd", dark: "#1d4c52" },
  },
  {
    id: "netuno",
    name: "Netuno",
    threshold: 1_000_000,
    size: 58,
    description: "Fronteira distante: o primeiro milhão acumulado.",
    palette: { light: "#b4c7ff", base: "#3a5bd0", dark: "#121f5c" },
  },
  {
    id: "plutao",
    name: "Plutão",
    threshold: 2_000_000,
    size: 48,
    description: "Além do sistema: R$ 2 milhões acumulados.",
    palette: { light: "#f1dccb", base: "#a8816a", dark: "#3f2a20" },
  },
  {
    id: "sirius",
    name: "Sirius",
    threshold: 3_500_000,
    size: 56,
    star: true,
    description: "A estrela mais brilhante do céu: R$ 3,5 milhões.",
    palette: { light: "#ffffff", base: "#bcd6ff", dark: "#4a6aa8" },
  },
  {
    id: "vega",
    name: "Vega",
    threshold: 5_000_000,
    size: 60,
    star: true,
    description: "Metade do caminho até o objetivo final: R$ 5 milhões.",
    palette: { light: "#f4f7ff", base: "#a9c1ff", dark: "#3b4f99" },
  },
  {
    id: "polaris",
    name: "Polaris",
    threshold: 7_500_000,
    size: 64,
    star: true,
    description: "Estrela-guia: R$ 7,5 milhões acumulados.",
    palette: { light: "#fffbe8", base: "#ffe08a", dark: "#9a6a12" },
  },
  {
    id: "sol",
    name: "Sol",
    threshold: 10_000_000,
    size: 86,
    star: true,
    description: "Objetivo final: R$ 10 milhões em receita confirmada acumulada.",
    palette: { light: "#fff7c9", base: "#ffb52e", dark: "#b3470b" },
  },
];

export const ACCUMULATED_GOAL = 10_000_000;

export type MonthValue = {
  month: string;
  value: number | null;
  status?: "value" | "empty" | "error";
};

export type JourneyProgress = {
  value: number;
  achieved: number;
  current: Milestone | null;
  next: Milestone | null;
  /** Percentual (0–100) do valor em relação ao próximo marco. */
  percentToNext: number;
  remaining: number;
  /** Posição fracionária no caminho: 0 = Início, k = marco k. */
  position: number;
};

export function journeyProgress(value: number, milestones: readonly Milestone[]): JourneyProgress {
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  const achieved = milestones.filter((m) => v >= m.threshold).length;
  const current = achieved > 0 ? milestones[achieved - 1] : null;
  const next = milestones[achieved] ?? null;
  if (!next)
    return {
      value: v,
      achieved,
      current,
      next: null,
      percentToNext: 100,
      remaining: 0,
      position: milestones.length,
    };
  const previous = current?.threshold ?? 0;
  const local = (v - previous) / (next.threshold - previous);
  return {
    value: v,
    achieved,
    current,
    next,
    percentToNext: Math.min(100, Math.floor((v / next.threshold) * 100)),
    remaining: Math.max(0, next.threshold - v),
    position: achieved + Math.min(1, Math.max(0, local)),
  };
}

export type MilestoneState = "achieved" | "next" | "locked";
export const milestoneState = (progress: JourneyProgress, index: number): MilestoneState =>
  index < progress.achieved ? "achieved" : index === progress.achieved ? "next" : "locked";

/** Índice do mês corrente (0–11) no ano do Financeiro, no fuso de São Paulo. */
export function currentMonthIndex(now: Date, year: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value) - 1;
  if (y < year) return -1;
  if (y > year) return 11;
  return m;
}

/** Valor confirmado de um mês: somente células numéricas válidas; vazio ou erro não contam. */
export const confirmedValue = (m: MonthValue | undefined): number =>
  m && m.status !== "error" && typeof m.value === "number" && Number.isFinite(m.value)
    ? m.value
    : 0;

/**
 * Mensal: receita confirmada apenas do mês indicado (reinicia a cada mês).
 * Acumulada: soma de cada mês uma única vez, do primeiro até o mês indicado.
 * Correções negativas (cancelamentos, estornos) reduzem o acumulado.
 */
export function revenueFor(
  mode: UniverseMode,
  months: readonly MonthValue[],
  index: number,
): number {
  if (index < 0) return 0;
  if (mode === "mensal") return confirmedValue(months[index]);
  return months.slice(0, index + 1).reduce((sum, m) => sum + confirmedValue(m), 0);
}

export type HistoryRow = {
  index: number;
  month: string;
  value: number | null;
  status: MonthValue["status"];
  /** Receita confirmada do mês usada nos cálculos. */
  confirmed: number;
  cumulative: number;
  /** Planeta da Jornada Mensal alcançado naquele mês. */
  monthly: Milestone | null;
  monthlyPercent: number;
  /** Planeta da Jornada Acumulada alcançado ao fim daquele mês. */
  accumulated: Milestone | null;
  /** Planetas acumulados desbloqueados naquele mês. */
  unlocked: Milestone[];
};

export function historyRows(months: readonly MonthValue[], index: number): HistoryRow[] {
  let cumulative = 0;
  let best = 0;
  return months.slice(0, Math.max(0, index + 1)).map((m, i) => {
    const confirmed = confirmedValue(m);
    cumulative += confirmed;
    const monthly = journeyProgress(confirmed, MONTHLY_MILESTONES);
    const acc = journeyProgress(cumulative, ACCUMULATED_MILESTONES);
    const unlocked = ACCUMULATED_MILESTONES.slice(best, Math.max(best, acc.achieved));
    best = Math.max(best, acc.achieved);
    return {
      index: i,
      month: m.month,
      value: m.value,
      status: m.status,
      confirmed,
      cumulative,
      monthly: monthly.current,
      monthlyPercent: monthly.next ? monthly.percentToNext : 100,
      accumulated: acc.current,
      unlocked,
    };
  });
}

/** Mensal: meses que atingiram o marco. Acumulada: primeiro mês em que o total cruzou o marco. */
export function achievementMonths(
  mode: UniverseMode,
  months: readonly MonthValue[],
  index: number,
  milestone: Milestone,
): string[] {
  const rows = historyRows(months, index);
  if (mode === "mensal")
    return rows.filter((r) => r.confirmed >= milestone.threshold).map((r) => r.month);
  const first = rows.find((r) => r.cumulative >= milestone.threshold);
  return first ? [first.month] : [];
}

export const brl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function compactBrl(n: number): string {
  if (n >= 1_000_000)
    return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (n >= 1_000)
    return `R$ ${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return brl(n);
}

// ---- Geometria do caminho (cena 1000 × 620) ----

export const SCENE = { width: 1000, height: 620 } as const;
export type Point = { x: number; y: number };

/** Início + um ponto por marco da Jornada Mensal. */
export const MONTHLY_NODES: readonly Point[] = [
  { x: 80, y: 540 },
  { x: 225, y: 445 },
  { x: 405, y: 520 },
  { x: 560, y: 345 },
  { x: 750, y: 430 },
  { x: 895, y: 215 },
];

/** Início + um ponto por marco da Jornada Acumulada; serpentina de baixo para cima. */
export const ACCUMULATED_NODES: readonly Point[] = [
  { x: 70, y: 520 },
  { x: 210, y: 470 },
  { x: 370, y: 515 },
  { x: 535, y: 460 },
  { x: 700, y: 505 },
  { x: 875, y: 410 },
  { x: 760, y: 290 },
  { x: 570, y: 320 },
  { x: 375, y: 270 },
  { x: 210, y: 175 },
  { x: 440, y: 85 },
];

export type Segment = [Point, Point, Point, Point];

/** Catmull-Rom convertido em Béziers cúbicas: curva suave que passa por todos os pontos. */
export function buildSegments(points: readonly Point[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    segs.push([
      p1,
      { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    ]);
  }
  return segs;
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Divide a Bézier em t (de Casteljau) e devolve o trecho inicial. */
export function splitSegment([a, b, c, d]: Segment, t: number): Segment {
  const ab = lerp(a, b, t),
    bc = lerp(b, c, t),
    cd = lerp(c, d, t);
  const abc = lerp(ab, bc, t),
    bcd = lerp(bc, cd, t);
  return [a, ab, abc, lerp(abc, bcd, t)];
}

const r = (n: number) => Math.round(n * 10) / 10;
export function pathFor(segs: readonly Segment[]): string {
  if (!segs.length) return "";
  return (
    `M ${r(segs[0][0].x)} ${r(segs[0][0].y)} ` +
    segs
      .map(([, b, c, d]) => `C ${r(b.x)} ${r(b.y)} ${r(c.x)} ${r(c.y)} ${r(d.x)} ${r(d.y)}`)
      .join(" ")
  );
}

/** Trecho percorrido até a posição fracionária. */
export function progressSegments(segs: readonly Segment[], position: number): Segment[] {
  const p = Math.min(segs.length, Math.max(0, position));
  const whole = Math.floor(p);
  const out = segs.slice(0, whole);
  if (whole < segs.length && p > whole) out.push(splitSegment(segs[whole], p - whole));
  return out;
}

export function pointAtPosition(segs: readonly Segment[], position: number): Point {
  if (!segs.length) return { x: 0, y: 0 };
  const p = Math.min(segs.length, Math.max(0, position));
  if (p === segs.length) return segs[segs.length - 1][3];
  const part = splitSegment(segs[Math.floor(p)], p - Math.floor(p));
  return part[3];
}

/** Estrelas determinísticas para a cena (iguais no servidor e no navegador). */
export function stars(
  count: number,
  seed = 20261102,
): { x: number; y: number; r: number; o: number }[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: r(rand() * SCENE.width),
    y: r(rand() * SCENE.height),
    r: r(0.4 + rand() * 1.4),
    o: r(0.25 + rand() * 0.7),
  }));
}

export type Journey = {
  mode: UniverseMode;
  label: string;
  milestones: readonly Milestone[];
  nodes: readonly Point[];
};

export const JOURNEYS: Record<UniverseMode, Journey> = {
  mensal: {
    mode: "mensal",
    label: "Jornada Mensal",
    milestones: MONTHLY_MILESTONES,
    nodes: MONTHLY_NODES,
  },
  acumulada: {
    mode: "acumulada",
    label: "Jornada Acumulada",
    milestones: ACCUMULATED_MILESTONES,
    nodes: ACCUMULATED_NODES,
  },
};
