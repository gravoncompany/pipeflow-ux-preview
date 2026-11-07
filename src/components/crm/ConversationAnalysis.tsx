import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyzeConversation } from "@/lib/whatsapp-analysis.functions";
import { qualificationLabels, opportunityLabels, serviceLabels, type Analysis } from "@/lib/whatsapp-analysis";
import { canOfferQualification } from "@/lib/analysis-qualification";
import { AnalysisQualification } from "./AnalysisQualification";

export function AnalysisResult({ result }: { result: Analysis }) {
  return <div className="space-y-4 text-sm">
    <div className="flex flex-wrap gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">{qualificationLabels[result.qualification]}</span><span className="rounded-md bg-muted px-2 py-1">{opportunityLabels[result.opportunity]}</span></div>
    <p>{result.summary}</p>
    {result.interestEvidence.map((e, i) => <blockquote key={i} className="border-l-2 border-primary pl-3 text-muted-foreground">“{e.quote}”</blockquote>)}
    <div><h3 className="font-semibold">Oportunidade</h3><p className="mt-1 text-muted-foreground">{result.opportunityReason}</p></div>
    <div><h3 className="font-semibold">{serviceLabels[result.serviceAssessment]}</h3>{result.failures.map((f, i) => <div key={i} className="mt-2"><p>{f.reason}</p><blockquote className="mt-1 border-l-2 border-border pl-3 text-muted-foreground">“{f.quote}”</blockquote></div>)}</div>
    <div className="border-t pt-3"><h3 className="font-semibold">Próxima ação</h3><p className="mt-1">{result.nextAction}</p></div>
    <p className="text-xs text-muted-foreground">Avaliação sugerida por IA, sujeita à revisão. {result.limitations}</p>
  </div>;
}

export function ConversationAnalysis({ phone }: { phone: string }) {
  const analyze = useServerFn(analyzeConversation);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <div className="border-b p-3">
    <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { const r = await analyze({ data: { phone } }); setResult(r.result); setError(r.error); setAnalyzedAt(r.error ? null : r.analyzedAt ?? null); }
      catch { setError("Não foi possível concluir a análise."); }
      finally { setBusy(false); }
    }}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{busy ? "Analisando…" : result ? "Atualizar análise" : "Analisar conversa"}</Button>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    {result && <details open className="mt-3 max-h-80 overflow-y-auto"><summary className="mb-3 cursor-pointer text-sm font-semibold">Análise da conversa</summary><AnalysisResult result={result} />{analyzedAt && canOfferQualification(result) && <AnalysisQualification key={`${phone}:${analyzedAt}`} phone={phone} analyzedAt={analyzedAt} result={result} />}</details>}
  </div>;
}