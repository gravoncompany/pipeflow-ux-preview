import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cartão de indicador único do sistema: rótulo, valor, variação opcional e ação ao clicar.
 * `tone` usa somente os tokens de cor já existentes (primary, success, destructive, receipt-*).
 */
export function KpiCard({ label, value, hint, delta, deltaLabel = "vs mês anterior", invertDelta = false, tone, active, onClick, icon }: {
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
}) {
  const good = delta == null ? null : invertDelta ? delta < 0 : delta > 0;
  const toneBar = { default: "bg-border", success: "bg-success", warning: "bg-receipt-pending", danger: "bg-destructive", primary: "bg-primary" }[tone ?? "default"];
  const body = (
    <>
      <span className={cn("absolute inset-y-3 left-0 w-1 rounded-r", toneBar)} aria-hidden />
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</span>
      <span className="mt-2 block break-words text-xl font-semibold tabular-nums">{value}</span>
      {delta != null && (
        <span className={cn("mt-1 inline-flex items-center gap-1 text-xs", delta === 0 ? "text-muted-foreground" : good ? "text-success" : "text-destructive")}>
          {delta === 0 ? <Minus className="size-3" /> : delta > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {delta > 0 ? "+" : ""}{delta.toLocaleString("pt-BR")}% <span className="text-muted-foreground">{deltaLabel}</span>
        </span>
      )}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </>
  );
  const cls = cn("relative block h-full w-full rounded-lg border bg-card p-4 pl-5 text-left", onClick && "transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active && "border-primary ring-1 ring-primary");
  return onClick ? <button type="button" className={cls} onClick={onClick} aria-pressed={active}>{body}</button> : <article className={cls}>{body}</article>;
}

export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}
