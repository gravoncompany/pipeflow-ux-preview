import { AlertTriangle, Check, CircleDashed, Clock, Hourglass, PauseCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tons de status unificados: mesma cor para o mesmo significado em todo o sistema. */
export type StatusTone = "success" | "warning" | "danger" | "partial" | "neutral" | "primary" | "muted";
const TONES: Record<StatusTone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-receipt-pending/20 text-foreground border-receipt-pending/40",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  partial: "bg-receipt-partial/15 text-foreground border-receipt-partial/40",
  neutral: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/30",
  muted: "bg-muted text-muted-foreground border-transparent",
};
const ICONS = { success: Check, warning: Clock, danger: AlertTriangle, partial: CircleDashed, neutral: Hourglass, primary: Check, muted: PauseCircle } as const;

/** Selo com cor + ícone + texto (não depende só da cor para ser lido). */
export function StatusPill({ tone, children, icon = true, className, title }: { tone: StatusTone; children: React.ReactNode; icon?: boolean; className?: string; title?: string }) {
  const Icon = ICONS[tone] ?? XCircle;
  return (
    <span title={title} className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {icon && <Icon className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export const RECEIPT_TONE = { pago: "success", pendente: "warning", atrasado: "danger", parcial: "partial", conciliacao: "neutral" } as const satisfies Record<string, StatusTone>;
export const CLIENT_TONE: Record<string, StatusTone> = { ativo: "success", implantacao: "primary", pausado: "warning", encerrado: "muted" };
