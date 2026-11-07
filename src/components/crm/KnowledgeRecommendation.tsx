import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recommendFromKnowledge } from "@/lib/ai-knowledge.functions";

/** On-demand recommendation that crosses the saved analysis with the accumulated knowledge base. Read-only: never changes leads. */
export function KnowledgeRecommendation({ phone, start, end }: { phone: string; start: string; end: string }) {
  const recommend = useServerFn(recommendFromKnowledge);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await recommend({ data: { phone, start, end } });
      if (r.error) setError(r.error);
      else setText(r.recommendation);
    } catch { setError("Não foi possível gerar a recomendação."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 space-y-3 rounded-lg border bg-card p-4">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-primary" />Recomendação com base no seu histórico</h3>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" /> : <Lightbulb />}{text ? "Atualizar" : "Gerar"}</Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {text ? <p className="whitespace-pre-wrap text-sm">{text}</p> :
      !error && <p className="text-xs text-muted-foreground">Cruza esta análise com os aprendizados do menu Conhecimento. Informativa: nenhuma etiqueta, etapa ou mensagem é alterada.</p>}
  </section>;
}
