import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Inbox, RefreshCw, Send, Sparkles } from "lucide-react";
import { getLeadEmailMarketing, syncEmails } from "@/lib/email-flows.functions";
import { ENROLLMENT_LABEL } from "@/lib/email-flows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlowSuggestionEditor } from "./FlowSuggestionEditor";
import { LeadAutomations } from "./LeadAutomations";

const fmt = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
const LIVE = ["active", "awaiting_reply", "in_conversation", "paused"];

export function LeadEmailMarketing({ leadId }: { leadId: string }) {
  const get = useServerFn(getLeadEmailMarketing), sync = useServerFn(syncEmails);
  const q = useQuery({ queryKey: ["lead-email-marketing", leadId], queryFn: () => get({ data: { leadId } }), retry: false, gcTime: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false), [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando e-mails…</p>;
  if (q.isError) return <p className="text-sm text-destructive">Histórico de e-mails indisponível.</p>;
  if (!q.data?.allowed) return <p className="text-sm text-muted-foreground">Disponível com acesso completo ao CRM.</p>;
  const { records, enrollments, suggestions, receivedCount } = q.data;
  const inboundOf = (id: string) => records.find((r) => r.id === `f:${id}`);
  const current = enrollments.find((e) => LIVE.includes(e.status)) ?? enrollments[0];
  const lastOut = records.find((r) => r.direction === "out" && r.status === "Enviado");
  const pending = suggestions.filter((s) => s.state !== "sent" && s.state !== "discarded");

  async function runSync() {
    setSyncing(true); setNotice(null);
    try {
      const r = await sync();
      setNotice({ ok: true, text: r.imported ? `${r.imported} e-mail(s) novo(s) sincronizado(s).` : "Nenhum e-mail novo." });
      await q.refetch();
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "Sincronização indisponível." }); }
    finally { setSyncing(false); }
  }

  return (
    <div className="space-y-4">
      <LeadAutomations leadId={leadId} />
      <section className="rounded-lg border p-3" aria-label="Resumo do e-mail marketing">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Acompanhamento por e-mail</h3>
          <Button size="sm" variant="outline" disabled={syncing} onClick={() => void runSync()}><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />Sincronizar e-mails</Button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm lg:grid-cols-4">
          <Item label="Fluxo ativo">{current && LIVE.includes(current.status) ? current.flowName : "Nenhum"}</Item>
          <Item label="Pipeflow IA">{current ? (current.aiOn ? <Badge><Sparkles className="mr-1 size-3" />Ativada</Badge> : <Badge variant="secondary">Desativada</Badge>) : "—"}</Item>
          <Item label="Situação">{current ? ENROLLMENT_LABEL[current.status] : "—"}</Item>
          <Item label="Etapa atual">{current ? `${Math.min(current.next_step + (current.status === "active" ? 1 : 0), current.totalSteps)} de ${current.totalSteps}` : "—"}</Item>
          <Item label="Último envio">{fmt(current?.last_sent_at ?? lastOut?.date ?? null)}</Item>
          <Item label="Próximo envio">{current?.status === "active" && current.next_send_at ? fmt(current.next_send_at) : "—"}</Item>
          <Item label="Respostas recebidas">{receivedCount}</Item>
          <Item label="Sugestões da IA">{pending.length ? `${pending.length} aguardando aprovação` : "Nenhuma"}</Item>
        </dl>
        {current?.reason && <p className="mt-2 text-xs"><span className="font-medium">Motivo da pausa/status:</span> {current.reason}</p>}
        {notice && <p role="status" className={`mt-2 text-xs ${notice.ok ? "text-primary" : "text-destructive"}`}>{notice.text}</p>}
      </section>

      {enrollments.filter((e) => e.id !== current?.id).map((e) => (
        <div key={e.id} className="rounded-lg border p-3 text-sm">
          <p className="font-medium">Fluxo anterior: {e.flowName}</p>
          <p className="text-xs text-muted-foreground">{ENROLLMENT_LABEL[e.status]}{e.reason ? ` · ${e.reason}` : ""}</p>
        </div>
      ))}

      {pending.map((s) => {
        const inbound = inboundOf(s.inbound_id);
        return <FlowSuggestionEditor key={s.id} suggestion={s} inbound={inbound ? { subject: inbound.subject, body: inbound.body } : undefined} onDone={() => void q.refetch()} />;
      })}

      {records.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum e-mail enviado ou recebido para este contato.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {records.map((r) => {
            const isOpen = open === r.id;
            return (
              <li key={r.id}>
                <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Recolher" : "Expandir"} e-mail ${r.subject || "sem assunto"}`} onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full items-start gap-2 p-3 text-left hover:bg-muted/40">
                  {isOpen ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
                  {r.direction === "in" ? <Inbox className="mt-0.5 size-4 shrink-0 text-primary" /> : <Send className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`block truncate text-sm ${r.unread ? "font-semibold" : "font-medium"}`}>{r.subject || "(sem assunto)"}</span>
                      {r.unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Não lido" />}
                    </span>
                    <span className="block text-xs text-muted-foreground">{r.source}: {r.name}</span>
                    <span className="block break-words text-xs text-muted-foreground">De {r.from} · para {r.to}</span>
                    <span className="block text-xs text-muted-foreground">{fmt(r.date)} · <span className={/Recusado|desconhecido/.test(r.status) ? "text-destructive" : ""}>{r.status}</span>{r.ai && <> · <Sparkles className="inline size-3" /> personalizado pela IA</>}</span>
                  </span>
                </button>
                {isOpen && <pre className="mx-3 mb-3 whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-sans text-sm">{r.body}{r.error ? `\n\nCódigo do provedor: ${r.error}` : ""}</pre>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words">{children}</dd></div>;
}
