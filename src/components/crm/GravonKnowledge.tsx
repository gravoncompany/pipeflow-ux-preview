import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Brain, Loader2, RefreshCw } from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { startLearning, advanceLearning, getLearningStatus, getKnowledgeOverview, setKnowledgeSharing } from "@/lib/ai-knowledge.functions";
import { knowledgeKindLabels, KNOWLEDGE_KINDS } from "@/lib/ai-knowledge";
import { CommercialKnowledgeEditor } from "./CommercialKnowledgeEditor";

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}

export function GravonKnowledge() {
  const overview = useServerFn(getKnowledgeOverview);
  const start = useServerFn(startLearning);
  const advance = useServerFn(advanceLearning);
  const status = useServerFn(getLearningStatus);
  const share = useServerFn(setKnowledgeSharing);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stop = useRef(false);
  const progress = useQuery({ queryKey: ["ai-learning-status"], queryFn: () => status() });
  const q = useQuery({ queryKey: ["ai-knowledge"], queryFn: () => overview({}) });
  if (q.data?.needsAuth) return <CrmAuthGate onUnlock={a => { if (a.level === "full") void q.refetch(); }} />;
  const d = q.data;
  async function refresh() {
    setBusy(true); setError(null); setNotice(null);
    try {
      stop.current = false;
      const r = await start();
      while (!stop.current) {
        await advance({ data: { id: r.id } });
        const next = await progress.refetch();
        if (next.data?.status === "completed") {
          setNotice("Conhecimento atualizado com as conversas comerciais armazenadas.");
          await queryClient.invalidateQueries({ queryKey: ["ai-knowledge"] });
          break;
        }
        if (next.data?.status !== "running") { setError(next.data?.error ?? "Aprendizado interrompido."); break; }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir a geração."); await progress.refetch(); }
    finally { setBusy(false); }
  }
  async function toggleSharing(enabled: boolean) {
    setError(null);
    const r = await share({ data: { enabled } });
    if (!r.ok) setError(r.error ?? "Não foi possível salvar.");
    await queryClient.invalidateQueries({ queryKey: ["ai-knowledge"] });
  }
  return <div className="min-w-0 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-2xl font-bold">Conhecimento comercial</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Todas as conversas comerciais armazenadas · atendimento do time, oportunidades de melhoria e práticas de venda. Textos e legendas; mídias sem transcrição. A conversa pessoal com a IA não entra na base.</p></div>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void refresh()}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}{progress.data?.status === "running" ? "Continuar aprendizado" : "Atualizar conhecimento"}</Button>
      {busy && <Button variant="outline" onClick={() => { stop.current = true; setNotice("Pausa solicitada. O trecho atual será salvo antes de parar."); }}>Pausar</Button>}</div>
    </header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    <CommercialKnowledgeEditor />
    <p className="text-xs text-muted-foreground">Atualização manual com consumo de IA por trecho analisado. Nenhum card é alterado e nenhuma mensagem é enviada.</p>
    {progress.data && <section className="space-y-2 border-y py-4" aria-label="Progresso do aprendizado"><p className="text-sm font-medium">{progress.data.conversations} conversas · {progress.data.messages} mensagens disponíveis</p><p className="text-sm text-muted-foreground">{progress.data.completed} de {progress.data.total} trechos analisados · {progress.data.status === "completed" ? "Concluído" : progress.data.phase === "synthesis" ? "Consolidando aprendizados" : "Análise das conversas"}</p>{progress.data.error && <p role="alert" className="text-sm text-destructive">{progress.data.error}</p>}</section>}
    {q.isPending ? <p className="text-muted-foreground">Carregando…</p> : d && <>
      <div className="grid grid-cols-2 gap-4 border-y py-5 lg:grid-cols-4">{[
        ["Análises na base", d.analysesCount],
        ["Decisões confirmadas", d.decisions.confirmed],
        ["Decisões canceladas", d.decisions.cancelled],
        ["Taxa de confirmação", d.decisions.rate === null ? "Sem base" : `${d.decisions.rate.toFixed(0)}%`],
      ].map(([label, value]) => <div key={label as string}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}</div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Frequência de vendas</h2>
        <p className="text-xs text-muted-foreground">Leads na etapa Fechado, agrupados pelo mês de entrada no CRM — mesma regra do funil. Total de fechados: {d.totalClosed}.</p>
        {d.sales.every(s => s.count === 0) ? <p className="text-sm text-muted-foreground">Nenhuma venda registrada nos últimos 6 meses pela regra atual.</p> :
          <div className="flex items-end gap-3 overflow-x-auto pb-2">{d.sales.map(s => {
            const max = Math.max(...d.sales.map(x => x.count), 1);
            return <div key={s.month} className="flex w-16 shrink-0 flex-col items-center gap-1">
              <span className="text-xs font-medium">{s.count}</span>
              <div className="w-10 rounded-t bg-primary" style={{ height: `${Math.max((s.count / max) * 120, 4)}px` }} />
              <span className="text-xs text-muted-foreground">{monthLabel(s.month)}</span>
            </div>;
          })}</div>}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Aprendizados atuais</h2>
          {d.generatedAt && <p className="text-xs text-muted-foreground">Geração {d.generation} · {new Date(d.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {d.analysesUsed} fontes</p>}
        </div>
        {d.insights.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <Brain className="mb-2 h-6 w-6" />
          Nenhum aprendizado gerado ainda.
        </div> : KNOWLEDGE_KINDS.map(kind => {
          const items = d.insights.filter(i => i.kind === kind);
          if (!items.length) return null;
          return <div key={kind} className="space-y-2">
            <h3 className="text-sm font-semibold text-primary">{knowledgeKindLabels[kind]}</h3>
            <ul className="space-y-2">{items.map(i => <li key={i.id} className="rounded-lg border bg-card p-3 text-sm">{i.text}</li>)}</ul>
          </div>;
        })}
      </section>

      <section className="flex items-center justify-between gap-4 border-t py-4">
        <div><p className="text-sm font-medium">Usar os aprendizados comerciais nas respostas para mim</p>
          <p className="text-xs text-muted-foreground">Base de todas as conversas comerciais; respostas só no seu WhatsApp autorizado. Não limita quais conversas a IA analisa.</p></div>
        <Switch checked={d.knowledgeSharing} onCheckedChange={v => void toggleSharing(v)} aria-label="Permitir que a Gravon AI use o conhecimento no WhatsApp" />
      </section>
    </>}
  </div>;
}
