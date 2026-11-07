import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Zap } from "lucide-react";
import { automationRunAction, getLeadAutomations } from "@/lib/automations.functions";
import { RUN_EVENT_LABEL } from "@/lib/automations";
import { ENROLLMENT_LABEL } from "@/lib/email-flows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const fmt = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
const LIVE = ["active", "paused", "awaiting_reply", "in_conversation"];

/** Histórico das automações deste card, com pausar/retomar/cancelar. */
export function LeadAutomations({ leadId }: { leadId: string }) {
  const get = useServerFn(getLeadAutomations), act = useServerFn(automationRunAction);
  const q = useQuery({ queryKey: ["lead-automations", leadId], queryFn: () => get({ data: { leadId } }), retry: false, gcTime: 0 });
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (q.isLoading || q.isError || !q.data?.length) return null;

  async function run(runId: string, action: "pause" | "resume" | "cancel") {
    if (busy) return;
    if (action === "cancel" && !window.confirm("Cancelar a automação neste card? Nenhum novo e-mail será enviado por ela.")) return;
    setBusy(true); setMsg(null);
    try { await act({ data: { runId, action } }); setMsg({ ok: true, text: action === "pause" ? "Automação pausada neste card." : action === "resume" ? "Automação retomada." : "Automação cancelada neste card." }); await q.refetch(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Ação indisponível." }); }
    finally { setBusy(false); }
  }

  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="Automações do card">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Zap className="size-4 text-primary" />Automações</h3>
      {q.data.map((r) => {
        const live = LIVE.includes(r.status) && !r.cancelledAt && !r.formAt;
        const situation = r.formAt ? "Preencheu o formulário" : r.cancelledAt ? "Cancelada" : ENROLLMENT_LABEL[r.status];
        return (
          <div key={r.id} className="rounded-md border p-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link to="/automacoes/$id" params={{ id: r.automationId }} className="font-medium hover:underline">{r.name}</Link>
              <Badge variant={r.status === "active" && live ? "default" : "secondary"}>{situation}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {[r.contactName, r.company && r.company !== r.contactName ? r.company : "", r.contact].filter(Boolean).join(" · ")}{r.stage ? ` · etapa ${r.stage}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {r.sent} de {r.totalSteps} e-mails enviados · último: {fmt(r.lastSentAt)} · próximo: {r.status === "active" && live ? fmt(r.nextSendAt) : "—"} · {r.clicks ? `${r.clicks} clique(s) no link` : "sem cliques"}
            </p>
            {r.reason && <p className="mt-1 text-xs">{r.reason}</p>}
            {r.blocker && <p className="mt-1 text-xs text-destructive">{r.blocker}</p>}
            {live && (
              <div className="mt-2 flex gap-1.5">
                {r.status === "active" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(r.id, "pause")}>Pausar</Button>}
                {r.status === "paused" && !r.replyAt && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(r.id, "resume")}>Retomar</Button>}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(r.id, "cancel")}>Cancelar</Button>
              </div>
            )}
            {r.events.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
                {r.events.slice(0, 8).map((e) => <li key={e.id}>{fmt(e.created_at)} · {RUN_EVENT_LABEL[e.kind]}{e.detail ? ` — ${e.detail}` : ""}</li>)}
              </ul>
            )}
          </div>
        );
      })}
      {msg && <p role="status" className={`text-xs ${msg.ok ? "text-primary" : "text-destructive"}`}>{msg.text}</p>}
    </section>
  );
}
