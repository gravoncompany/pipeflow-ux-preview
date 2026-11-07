import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { approveEmailFlowSuggestion, discardEmailFlowSuggestion } from "@/lib/email-flows.functions";

export type FlowSuggestion = { id: string; analysis: string; subject: string; body: string; state: string; revision: number };

/** Sugestão da Pipeflow IA para uma resposta recebida: editar, aprovar e enviar, ou descartar. Nada sai sem clique. */
export function FlowSuggestionEditor({ suggestion, inbound, onDone }: { suggestion: FlowSuggestion; inbound?: { subject: string; body: string }; onDone: () => void }) {
  const approve = useServerFn(approveEmailFlowSuggestion), discard = useServerFn(discardEmailFlowSuggestion);
  const [subject, setSubject] = useState(suggestion.subject), [body, setBody] = useState(suggestion.body);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pending = suggestion.state === "pending";
  async function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const r = await work(); setMsg({ ok: r.ok, text: r.message ?? "Feito." }); onDone(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Ação indisponível." }); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      {inbound && (
        <div className="rounded-md border bg-background p-2.5">
          <p className="text-xs font-medium text-muted-foreground">Resposta do cliente · {inbound.subject || "(sem assunto)"}</p>
          <p className="mt-1 whitespace-pre-line break-words text-sm">{inbound.body}</p>
        </div>
      )}
      <p className="flex items-start gap-1.5 text-xs text-foreground"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" /><span><b>Análise da Pipeflow IA:</b> {suggestion.analysis}</span></p>
      {pending ? (
        <>
          <Input aria-label="Assunto da resposta" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          <Textarea aria-label="Mensagem da resposta" rows={7} value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void run(async () => {
              if (!window.confirm("Enviar esta resposta agora para o cliente?")) return { ok: false, message: "Envio cancelado; nada foi enviado." };
              return approve({ data: { id: suggestion.id, revision: suggestion.revision, subject, body, confirmed: true } });
            })}>{busy ? "Enviando…" : "Aprovar e enviar"}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await discard({ data: { id: suggestion.id, revision: suggestion.revision } }); return { ok: true, message: "Sugestão descartada." }; })}>Descartar</Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Situação: {suggestion.state === "sending" ? "em envio" : suggestion.state === "failed" ? "recusada pelo provedor (não enviada)" : suggestion.state === "unknown" ? "resultado desconhecido (não reenviada)" : suggestion.state}</p>
      )}
      {msg && <p role="status" className={`text-xs ${msg.ok ? "text-primary" : "text-destructive"}`}>{msg.text}</p>}
    </div>
  );
}
