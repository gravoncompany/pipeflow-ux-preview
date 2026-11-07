import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, Sparkles } from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { getMarketingAiNarrative, getMarketingAnalysis } from "@/lib/marketing.functions";
import type { DashboardSearch } from "@/lib/dashboard-search";
import type { Finding } from "@/lib/marketing";
import { MarketingLayout } from "./MarketingLayout";
import { LoadState, MarketingPeriodBar, Panel, useMarketingPeriod } from "./marketing-ui";

const ICONS = { atencao: AlertTriangle, oportunidade: Lightbulb, positivo: CheckCircle2, limitacao: Info } as const;
const TITLES = { atencao: "Atenção", oportunidade: "Oportunidades", positivo: "Pontos positivos", limitacao: "Limitações dos dados" } as const;

export function MarketingAnalysisPage({ search }: { search: DashboardSearch }) {
  const { period } = useMarketingPeriod(search);
  const load = useServerFn(getMarketingAnalysis);
  const narrate = useServerFn(getMarketingAiNarrative);
  const [ai, setAi] = useState<{ summary: string; recommendations: string[]; limitations: string[] } | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const q = useQuery({
    queryKey: ["marketing-analysis", period?.from, period?.to],
    queryFn: () => { if (!period) throw new Error("Período inválido"); return load({ data: period }); },
    enabled: Boolean(period), staleTime: 60_000,
  });
  if (q.data && "needsAuth" in q.data) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const d = q.data && !("needsAuth" in q.data) ? q.data : null;

  async function generate() {
    if (!period) return;
    setAiBusy(true); setAiError(""); setAi(null);
    try {
      const r = await narrate({ data: period });
      if ("needsAuth" in r) return;
      if (r.ok) setAi(r); else setAiError(r.error);
    } catch (e) { setAiError((e as Error).message); } finally { setAiBusy(false); }
  }

  const groups: Record<Finding["kind"], Finding[]> = { atencao: [], oportunidade: [], positivo: [], limitacao: [] };
  for (const f of d?.findings ?? []) groups[f.kind].push(f);

  return (
    <MarketingLayout>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold">Análises IA</h1>
          <p className="mt-1 text-sm text-muted-foreground">A Pipeflow IA lê os indicadores e aponta gargalos, riscos e oportunidades</p>
        </div>
        <MarketingPeriodBar search={search} refreshing={q.isFetching} onRefresh={() => { setAi(null); void q.refetch(); }} />
      </header>

      <LoadState loading={q.isLoading} error={q.error} />
      {d && (
        <div className="space-y-4">
          <Panel title="Achados do período" note="Cada achado cita os números que o justificam; dados insuficientes viram limitações, nunca conclusões">
            {d.findings.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum achado no período selecionado.</p> : (
              <div className="space-y-4">
                {(["atencao", "oportunidade", "positivo", "limitacao"] as const).map((kind) => groups[kind].length > 0 && (
                  <div key={kind}>
                    <p className={`mb-1 flex items-center gap-1.5 text-sm font-semibold ${kind === "atencao" ? "text-destructive" : kind === "limitacao" ? "text-muted-foreground" : "text-primary"}`}>
                      {(() => { const Icon = ICONS[kind]; return <Icon className="size-4" />; })()}{TITLES[kind]}
                    </p>
                    <ul className="list-disc space-y-1 pl-6 text-sm">
                      {groups[kind].map((f, i) => <li key={i}>{f.text}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Análise da Pipeflow IA" note="Narrativa gerada sobre os achados acima; nunca inventa números nem altera dados">
            {!ai && !aiError && (
              <Button onClick={() => void generate()} disabled={aiBusy}>
                <Sparkles className="size-4" />{aiBusy ? "Gerando análise…" : "Gerar análise da Pipeflow IA"}
              </Button>
            )}
            {aiError && <p role="alert" className="text-sm text-destructive">{aiError}</p>}
            {ai && (
              <div className="space-y-3 text-sm">
                <p>{ai.summary}</p>
                {ai.recommendations.length > 0 && (
                  <div>
                    <p className="mb-1 font-semibold">Recomendações</p>
                    <ul className="list-disc space-y-1 pl-6">{ai.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
                {ai.limitations.length > 0 && (
                  <div>
                    <p className="mb-1 font-semibold text-muted-foreground">Limitações</p>
                    <ul className="list-disc space-y-1 pl-6 text-muted-foreground">{ai.limitations.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => void generate()} disabled={aiBusy}>Gerar novamente</Button>
              </div>
            )}
          </Panel>
        </div>
      )}
    </MarketingLayout>
  );
}
