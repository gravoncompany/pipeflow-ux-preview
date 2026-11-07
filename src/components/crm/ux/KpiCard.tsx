import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Anima um valor numérico de 0 até `to` (respeita "reduzir movimento"). */
export function useCountUp(to: number, duration = 900) {
  const [v, setV] = useState(to);
  const from = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setV(to); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration), e = 1 - Math.pow(1 - k, 4);
      setV(a + (to - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return v;
}

/** Texto como "R$ 12.300", "45", "81,4%": anima a parte numérica mantendo o formato. */
function AnimatedText({ text }: { text: string }) {
  const m = /^(.*?)(-?[\d.]+(?:,\d+)?)(.*)$/.exec(text);
  const target = m ? Number(m[2].replace(/\./g, "").replace(",", ".")) : NaN;
  const decimals = m && m[2].includes(",") ? m[2].split(",")[1].length : 0;
  const v = useCountUp(Number.isFinite(target) ? target : 0);
  if (!m || !Number.isFinite(target)) return <>{text}</>;
  return <>{m[1]}{v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{m[3]}</>;
}

/** Mini-gráfico de linha com área em gradiente. */
export function Sparkline({ data, className, tone = "primary", color: forced }: { data: number[]; className?: string; tone?: "primary" | "success" | "danger" | "warning"; color?: string }) {
  const gid = useId().replace(/:/g, "");
  if (data.length < 2) return null;
  const w = 100, h = 32, min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((d, i) => [(i / (data.length - 1)) * w, h - 3 - ((d - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const color = forced ?? { primary: "var(--primary)", success: "var(--success)", danger: "var(--destructive)", warning: "var(--warning)" }[tone];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-8 w-full overflow-visible", className)} aria-hidden>
      <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.28" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="[stroke-dasharray:400] [stroke-dashoffset:400] animate-[lab-draw_1.2s_cubic-bezier(0.16,1,0.3,1)_forwards] motion-reduce:[stroke-dashoffset:0] motion-reduce:animate-none" />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r="2.4" fill={color} />
    </svg>
  );
}

/**
 * Cartão de indicador único do sistema: rótulo, valor (com contagem animada), variação,
 * mini-gráfico opcional e ação ao clicar. Usa só os tokens de cor existentes.
 */
export function KpiCard({ label, value, hint, delta, deltaLabel = "vs mês anterior", invertDelta = false, tone, active, onClick, icon, spark }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  /** Para despesas e atrasos: subir é ruim. */
  invertDelta?: boolean;
  tone?: "default" | "success" | "warning" | "danger" | "primary";
  active?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  spark?: number[];
}) {
  const good = delta == null ? null : invertDelta ? delta < 0 : delta > 0;
  const t = tone ?? "default";
  const toneBar = { default: "from-border to-border", success: "from-success to-success/40", warning: "from-receipt-pending to-receipt-pending/40", danger: "from-destructive to-destructive/40", primary: "from-primary to-chart-2" }[t];
  const iconBg = { default: "bg-muted text-muted-foreground", success: "bg-success/12 text-success", warning: "bg-receipt-pending/20 text-foreground", danger: "bg-destructive/10 text-destructive", primary: "bg-primary/10 text-primary" }[t];
  const body = (
    <>
      <span className={cn("absolute inset-x-0 top-0 h-[3px] rounded-t-xl bg-gradient-to-r opacity-90", toneBar)} aria-hidden />
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon && <span className={cn("inline-flex size-6 items-center justify-center rounded-lg [&_svg]:size-3.5", iconBg)}>{icon}</span>}
        <span className="line-clamp-2 min-w-0">{label}</span>
      </span>
      <span className="mt-2.5 block break-words text-2xl font-semibold tracking-tight tabular-nums">{typeof value === "string" || typeof value === "number" ? <AnimatedText text={String(value)} /> : value}</span>
      {delta != null && (
        <span className={cn("mt-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium", delta === 0 ? "bg-muted text-muted-foreground" : good ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
          {delta === 0 ? <Minus className="size-3" /> : delta > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {delta > 0 ? "+" : ""}{delta.toLocaleString("pt-BR")}% <span className="font-normal text-muted-foreground">{deltaLabel}</span>
        </span>
      )}
      {spark && <Sparkline data={spark} tone={t === "danger" ? "danger" : t === "success" ? "success" : t === "warning" ? "warning" : "primary"} className="mt-2" />}
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </>
  );
  const cls = cn("surface lab-rise relative block h-full w-full overflow-hidden rounded-xl border bg-card p-4 text-left", onClick && "surface-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active && "border-primary/60 ring-2 ring-primary/30");
  return onClick ? <button type="button" className={cls} onClick={onClick} aria-pressed={active}>{body}</button> : <article className={cls}>{body}</article>;
}

export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}
