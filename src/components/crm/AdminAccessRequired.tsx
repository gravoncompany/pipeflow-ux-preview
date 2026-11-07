import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CrmAuthGate } from "./CrmAuthGate";
import type { AdminAccessReason } from "@/lib/crm-agent-access";

/**
 * Asks only for what is missing: the CRM full-access password (existing gate, same cookie as the
 * Pipeline) or the individual admin account (/auth), returning to this page afterwards.
 */
export function AdminAccessRequired({ reason, message, returnTo, onUnlocked, compact }: {
  reason: AdminAccessReason | null; message?: string; returnTo: string; onUnlocked: () => void; compact?: boolean;
}) {
  if (reason === "crm_session") {
    if (!compact) return <CrmAuthGate onUnlock={(a) => { if (a.level === "full") onUnlocked(); }} />;
    return <div className="space-y-3 p-4"><ShieldCheck className="size-7 text-muted-foreground" /><p className="text-sm text-muted-foreground">{message}</p>
      <CrmAuthGateInline onUnlocked={onUnlocked} /></div>;
  }
  return <section className={compact ? "space-y-3 p-4" : "py-10"}>
    <ShieldCheck className="mb-3 size-8 text-muted-foreground" />
    <h2 className="text-lg font-semibold">Conta administrativa necessária</h2>
    <p className="my-3 text-sm text-muted-foreground">{message ?? "Entre com sua conta administrativa individual para continuar."}</p>
    <Button asChild><a href={`/auth?redirect=${encodeURIComponent(returnTo)}`}>Entrar com a conta administrativa</a></Button>
  </section>;
}

function CrmAuthGateInline({ onUnlocked }: { onUnlocked: () => void }) {
  return <div className="overflow-hidden rounded-xl border [&>div]:min-h-0 [&>div]:p-0 [&_form]:border-0 [&_form]:shadow-none">
    <CrmAuthGate onUnlock={(a) => { if (a.level === "full") onUnlocked(); }} />
  </div>;
}
