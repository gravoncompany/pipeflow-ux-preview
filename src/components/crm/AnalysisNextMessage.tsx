import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Send, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { prepareAnalysisMessage, approveAnalysisMessage, analysisMessageStatus, latestAnalysisMessage } from "@/lib/analysis-next-message.functions";
import { maySend, nextMessageStatus, type NextMessageDraft } from "@/lib/analysis-next-message";
import type { Analysis } from "@/lib/whatsapp-analysis";

export function AnalysisNextMessage({ phone, start, end, auto, onAnalysis }: { phone: string; start: string; end: string; auto: number; onAnalysis: (result: Analysis, at: string) => void }) {
  const prepare = useServerFn(prepareAnalysisMessage), approve = useServerFn(approveAnalysisMessage), status = useServerFn(analysisMessageStatus), latest = useServerFn(latestAnalysisMessage);
  const [draft, setDraft] = useState<NextMessageDraft | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"generate" | "send" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const locked = useRef(false), mounted = useRef(true), started = useRef(0);
  const callback = useRef(onAnalysis); callback.current = onAnalysis;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (auto > 0) return;
    let alive = true;
    void latest({ data: { phone, start, end } }).then(d => {
      if (alive && mounted.current && !locked.current && d) { setDraft(d); setText(d.text); callback.current(d.result, d.analyzedAt); }
    }).catch(e => { if (alive && mounted.current) setError(e instanceof Error ? e.message : "Rascunho indisponível."); });
    return () => { alive = false; };
  }, [phone, start, end]);
  async function generate() {
    if (locked.current) return;
    locked.current = true; setBusy("generate"); setError(null);
    try {
      const d = await prepare({ data: { phone, start, end } });
      if (!mounted.current) return;
      setDraft(d); setText(d.text); callback.current(d.result, d.analyzedAt);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Não foi possível gerar; seu texto foi preservado."); }
    finally { locked.current = false; if (mounted.current) setBusy(null); }
  }
  useEffect(() => {
    if (auto > 0 && auto !== started.current) {
      started.current = auto;
      if (draft && text !== draft.text) setReplace(true); else void generate();
    }
  }, [auto]);
  async function send() {
    if (!draft || locked.current || !maySend(draft.status)) return;
    locked.current = true; setBusy("send"); setError(null);
    try {
      const d = await approve({ data: { id: draft.id, text } });
      if (mounted.current) { setDraft(d); if (d.error) setError(d.error); }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "Resultado não confirmado. Confira o status antes de continuar.");
        // A browser transport failure may happen after the server has claimed/sent.
        setDraft(old => old ? { ...old, status: "unknown" } : old);
      }
    } finally { locked.current = false; if (mounted.current) setBusy(null); }
  }
  async function check() {
    if (!draft || locked.current) return;
    locked.current = true; setBusy("status");
    try { const d = await status({ data: { id: draft.id } }); if (mounted.current) { setDraft(d); setError(d.error); } }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Estado indisponível; não reenviar."); }
    finally { locked.current = false; if (mounted.current) setBusy(null); }
  }
  const unresolved = draft && ["sending", "unknown"].includes(draft.status);
  return <section className="space-y-3 border-y border-primary/30 bg-primary/5 py-5">
    <h3 className="flex items-center gap-2 font-semibold"><MessageSquare className="size-4 text-primary" />Próxima mensagem</h3>
    <Textarea aria-label="Próxima mensagem" value={text} onChange={e => setText(e.target.value)} maxLength={4000} disabled={busy !== null || Boolean(draft && ["accepted", "sending", "unknown"].includes(draft.status))} className="min-h-44 bg-background text-sm" />
    {draft && <dl className="grid gap-1 break-words text-xs"><div><dt className="inline text-muted-foreground">Destinatário: </dt><dd className="inline font-medium">{draft.name}</dd></div><div><dt className="inline text-muted-foreground">Número validado: </dt><dd className="inline">+{draft.phone}</dd></div><div><dt className="inline text-muted-foreground">Instância: </dt><dd className="inline">{draft.instance}</dd></div></dl>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
      <Button variant="outline" disabled={busy !== null || Boolean(unresolved)} onClick={() => { if (draft && text !== draft.text) setReplace(true); else void generate(); }}>{busy === "generate" ? <Loader2 className="animate-spin" /> : <RefreshCw />}{busy === "generate" ? "Gerando…" : "Atualizar sugestão"}</Button>
      <Button disabled={busy !== null || !draft || !maySend(draft.status) || !text.trim()} onClick={() => void send()}>{busy === "send" ? <Loader2 className="animate-spin" /> : <Send />}{busy === "send" ? "Enviando…" : "Confirmar e enviar pelo WhatsApp"}</Button>
    </div>
    {draft && <div className="space-y-1 text-xs text-muted-foreground"><p role="status">{nextMessageStatus(draft)}</p>{draft.approvedAt && <p>Aprovada em {new Date(draft.approvedAt).toLocaleString("pt-BR")}</p>}{draft.providerId && <p className="break-all">ID: {draft.providerId}</p>}{draft.status !== "pending" && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void check()}><RefreshCw />{busy === "status" ? "Conferindo…" : "Conferir status"}</Button>}</div>}
    <AlertDialog open={replace} onOpenChange={setReplace}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Substituir sua edição?</AlertDialogTitle><AlertDialogDescription>Uma nova sugestão substituirá o texto editado somente se a geração concluir com sucesso.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Manter texto</AlertDialogCancel><AlertDialogAction onClick={() => void generate()}>Atualizar sugestão</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}