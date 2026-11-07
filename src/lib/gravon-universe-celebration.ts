// Gravon Universe: detecção de novas conquistas para a celebração visual.
// Somente apresentação: usa os estados já calculados pelas jornadas e guarda no
// navegador apenas quantas conquistas já foram celebradas. Não autoriza nada,
// não altera metas, receitas, percentuais nem histórico.
import { brl, type Milestone, type UniverseMode } from "./gravon-universe-journey";

export type CelebrationResult = {
  /** Índices das metas recém-conquistadas (vazio = nada a celebrar). */
  indices: number[];
  /** Nova referência a guardar. */
  baseline: number;
};

/**
 * - Sem referência (primeira abertura neste escopo): registra o estado atual sem celebrar.
 * - Mais conquistas que a referência: celebra somente as novas, numa única celebração.
 * - Menos conquistas (correção/cancelamento): rebaixa a referência sem celebrar,
 *   para que a meta seja celebrada de novo se for reconquistada.
 */
export function evaluateCelebration(baseline: number | null, achieved: number): CelebrationResult {
  const now = Number.isInteger(achieved) && achieved > 0 ? achieved : 0;
  if (baseline == null || !Number.isInteger(baseline) || baseline < 0)
    return { indices: [], baseline: now };
  if (now > baseline)
    return {
      indices: Array.from({ length: now - baseline }, (_, i) => baseline + i),
      baseline: now,
    };
  return { indices: [], baseline: now };
}

/**
 * Escopo da referência. Mensal: apenas o mês corrente (consultar meses anteriores nunca
 * celebra; cada mês começa do zero). Acumulada: o progresso total do ano do Financeiro.
 */
export function celebrationScope(
  mode: UniverseMode,
  year: number,
  monthIndex: number,
  viewMonth: number,
): string | null {
  if (monthIndex < 0) return null;
  if (mode === "mensal")
    return viewMonth === monthIndex
      ? `mensal:${year}-${String(monthIndex + 1).padStart(2, "0")}`
      : null;
  return `acumulada:${year}`;
}

export const CELEBRATION_STORAGE_PREFIX = "gravon-universe:celebrated:v1:";

export type BaselineStorage = Pick<Storage, "getItem" | "setItem">;

export function readBaseline(storage: BaselineStorage | null, scope: string): number | null {
  try {
    const raw = storage?.getItem(CELEBRATION_STORAGE_PREFIX + scope);
    if (raw == null || !/^\d{1,3}$/.test(raw)) return null;
    return Number(raw);
  } catch {
    return null;
  }
}

export function writeBaseline(storage: BaselineStorage | null, scope: string, value: number): void {
  try {
    storage?.setItem(CELEBRATION_STORAGE_PREFIX + scope, String(Math.max(0, Math.floor(value))));
  } catch {
    // Armazenamento indisponível (modo privado/cota): apenas não persiste.
  }
}

const joinNames = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;

export function celebrationMessage(
  milestones: readonly Milestone[],
  indices: readonly number[],
): { title: string; detail: string } {
  const list = indices.map((i) => milestones[i]).filter((m): m is Milestone => !!m);
  if (list.length === 0) return { title: "", detail: "" };
  if (list.length === 1)
    return {
      title: "Conquista desbloqueada",
      detail: `${list[0].name} · ${brl(list[0].threshold)}`,
    };
  return {
    title: `${list.length} conquistas desbloqueadas`,
    detail: `${joinNames(list.map((m) => m.name))} · até ${brl(list[list.length - 1].threshold)}`,
  };
}

/** Laboratório: valor visual que atinge `steps` novas metas a partir das conquistas atuais. */
export function simulatedValueFor(
  milestones: readonly Milestone[],
  achieved: number,
  steps: number,
): number {
  if (!milestones.length) return 0;
  const target = Math.min(milestones.length - 1, Math.max(0, achieved + Math.max(1, steps) - 1));
  return milestones[target].threshold;
}
