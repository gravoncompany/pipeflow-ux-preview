import type { ReactNode } from "react";

/**
 * Tema de gráficos do laboratório: tooltip em vidro, gradientes por série e eixos discretos.
 * Funciona com Recharts (passe <ChartGradients/> dentro do gráfico e <GlassTooltip/> em content).
 */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
export const labAxis = { tick: { fill: "var(--muted-foreground)", fontSize: 11 }, axisLine: false, tickLine: false, tickMargin: 8 } as const;
export const labGrid = { stroke: "var(--border)", strokeDasharray: "3 6", vertical: false } as const;
export const labAnim = { isAnimationActive: true, animationDuration: 900, animationEasing: "ease-out" as const };

/** Use como função dentro do gráfico: {ChartGradients({ prefix })} — o Recharts ignora componentes próprios como filhos.
 * Gradientes com prefixo único por gráfico (ids repetidos na página fazem o navegador ignorar o preenchimento). */
export function ChartGradients({ prefix }: { prefix: string }) {
  const ids = SERIES.map((_, i) => `${prefix}-g${i}`);
  return (
    <defs>
      {ids.map((gid, i) => (
        <linearGradient key={gid} id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={SERIES[i % SERIES.length]} stopOpacity={0.32} />
          <stop offset="95%" stopColor={SERIES[i % SERIES.length]} stopOpacity={0} />
        </linearGradient>
      ))}
      {ids.map((gid, i) => (
        <linearGradient key={`${gid}-bar`} id={`${gid}-bar`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={SERIES[i % SERIES.length]} stopOpacity={1} />
          <stop offset="100%" stopColor={SERIES[i % SERIES.length]} stopOpacity={0.55} />
        </linearGradient>
      ))}
    </defs>
  );
}

type Payload = { name?: string; value?: number | string | null; color?: string; dataKey?: string | number };
export function GlassTooltip({ active, payload, label, format }: { active?: boolean; payload?: Payload[]; label?: ReactNode; format?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass min-w-36 rounded-xl border border-border/70 px-3 py-2 text-xs shadow-[0_10px_30px_-10px_rgb(15_23_42/0.35)]">
      {label != null && <p className="mb-1.5 font-medium text-muted-foreground">{label}</p>}
      {payload.map((p) => (
        <p key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <strong className="tabular-nums">{p.value == null ? "—" : format && typeof p.value === "number" ? format(p.value) : String(p.value)}</strong>
        </p>
      ))}
    </div>
  );
}

/** Estado vazio compacto para gráficos sem dados suficientes. */
export function ChartEmpty({ text = "Dados insuficientes para este gráfico." }: { text?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground">
      <svg viewBox="0 0 64 24" className="h-6 w-16 text-muted-foreground/40" aria-hidden><path d="M2 20 L14 14 L26 17 L38 8 L50 11 L62 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 4" /></svg>
      {text}
    </div>
  );
}
