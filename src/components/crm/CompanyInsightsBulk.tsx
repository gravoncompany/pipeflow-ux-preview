import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCompanyInsightStatus, runCompanyInsight } from "@/lib/company-insights.functions";

const BATCH = 10;

/** Análise em massa sob demanda: até 10 empresas cadastradas ainda sem análise, uma por vez. Nunca envia nem altera cards. */
export function CompanyInsightsBulk({ leadIds }: { leadIds: string[] }) {
  const status = useServerFn(getCompanyInsightStatus), run = useServerFn(runCompanyInsight);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [error, setError] = useState("");
  if (!leadIds.length) return null;

  async function start() {
    setBusy(true); setError(""); setMsg("");
    try {
      const done = new Set((await status({ data: { leadIds: leadIds.slice(0, 200) } })).filter((s) => s.status === "done").map((s) => s.leadId));
      const todo = leadIds.filter((id) => !done.has(id)).slice(0, BATCH);
      if (!todo.length) { setMsg("Todas as empresas cadastradas listadas já têm análise. Abra um card para ver o resumo."); return; }
      let ok = 0, fail = 0;
      for (const [n, id] of todo.entries()) {
        setMsg(`Analisando ${n + 1} de ${todo.length}…`);
        try { const r = await run({ data: { leadId: id } }); if (r.status === "done") ok++; else fail++; }
        catch { fail++; }
      }
      setMsg(`${ok} empresa(s) analisada(s)${fail ? `, ${fail} sem site/Instagram legível ou com falha` : ""}. Abra o card para ver o resumo.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível iniciar a análise."); }
    finally { setBusy(false); }
  }

  return <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
    <span className="flex items-center gap-2 font-medium"><Sparkles className="size-4 text-primary" />Análise de site e Instagram</span>
    <span className="text-muted-foreground">Analisa até {BATCH} empresas cadastradas ainda sem análise. Nada é enviado.</span>
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void start()}>{busy && <Loader2 className="size-4 animate-spin" />}Analisar empresas</Button>
    {msg && <span role="status">{msg}</span>}
    {error && <span role="alert" className="text-destructive">{error}</span>}
  </div>;
}
