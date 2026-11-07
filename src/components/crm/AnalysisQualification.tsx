import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { type Analysis } from "@/lib/whatsapp-analysis";
import { useStages } from "@/hooks/use-stages";
import { useTags } from "@/hooks/use-tags";
import { qualificationTargets, conversationNote } from "@/lib/analysis-qualification";
import { prepareAnalysisQualification, resolveAnalysisQualification, type QualificationProposal } from "@/lib/analysis-qualification.functions";

export function AnalysisQualification({ phone, start = "", end = "", analyzedAt, result }: { phone: string; start?: string; end?: string; analyzedAt: string; result: Analysis }) {
  const { stages } = useStages();
  const { tags } = useTags();
  const { stage, tag } = qualificationTargets(stages, tags);
  const prepare = useServerFn(prepareAnalysisQualification);
  const resolve = useServerFn(resolveAnalysisQualification);
  const [proposal, setProposal] = useState<QualificationProposal | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(() => conversationNote(result));
  useEffect(() => {
    let active = true;
    setProposal(null); setError("");
    if (!tag || !stage) return;
    prepare({ data: { phone, start, end, analyzedAt, tag: { id: tag.id, label: tag.label }, stage } }).then((p) => { if (active) setProposal(p); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Confirmação indisponível."); });
    return () => { active = false; };
  }, [phone, start, end, analyzedAt, stage?.id, tag?.id, prepare]);
  const act = async (cancel: boolean) => {
    if (!proposal || busy) return;
    setBusy(true); setError("");
    try { const result = await resolve({ data: { id: proposal.id, cancel, notes: cancel ? "" : notes } }); setProposal({ ...proposal, status: result.status }); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  };
  return <section className="mt-5 space-y-3 border-t pt-4" aria-label="Confirmar qualificação">
    <h3 className="text-sm font-semibold">Qualificar lead</h3>
    {!tag || !stage ? <p className="text-sm text-muted-foreground">Não foi encontrada uma etiqueta única “Qualificado” ou uma coluna de qualificação neste navegador.</p> : !proposal && !error ? <p className="text-sm text-muted-foreground">Preparando confirmação…</p> : null}
    {proposal?.status === "pending" && <>
      <p className="text-sm"><strong>{proposal.leadName}</strong> → {proposal.stageTitle}</p>
      <span className="inline-flex rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success">{proposal.tagLabel}</span>
      <div className="space-y-2"><Label htmlFor={`analysis-notes-${proposal.id}`}>Anotações internas · principais pontos</Label><Textarea id={`analysis-notes-${proposal.id}`} rows={7} maxLength={8000} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} /><p className="text-xs text-muted-foreground">As anotações existentes serão mantidas.</p></div>
      <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void act(false)}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Confirmar</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void act(true)}><X className="size-4" />Cancelar</Button></div>
    </>}
    {proposal?.status === "confirmed" && <p role="status" className="text-sm text-success">Qualificação confirmada. As anotações preenchidas foram acrescentadas ao card.</p>}
    {proposal?.status === "cancelled" && <p role="status" className="text-sm text-muted-foreground">Cancelado. Nenhuma alteração aplicada.</p>}
    {proposal && ["stale", "missing"].includes(proposal.status) && <p role="alert" className="text-sm text-destructive">O card ou a análise mudou. Atualize a análise antes de confirmar.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}