import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { AnalysisResult } from "@/components/crm/ConversationAnalysis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { analyzeConversation, listAnalysisConversations, resumeWhatsAppAnalysis, type AnalysisRow } from "@/lib/whatsapp-analysis.functions";
import { qualificationLabels, opportunityLabels, serviceLabels } from "@/lib/whatsapp-analysis";
import { canOfferQualification } from "@/lib/analysis-qualification";
import { AnalysisQualification } from "@/components/crm/AnalysisQualification";
import { KnowledgeRecommendation } from "@/components/crm/KnowledgeRecommendation";
import { AnalysisNextMessage } from "@/components/crm/AnalysisNextMessage";
import type { Analysis } from "@/lib/whatsapp-analysis";

function dateText(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
/** Conversation analysis (moved inside Pipeflow IA); logic unchanged from the former /analises page. */
export function ConversationAnalysesPanel() {
  const list = useServerFn(listAnalysisConversations);
  const analyze = useServerFn(analyzeConversation);
  const resume = useServerFn(resumeWhatsAppAnalysis);
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return dateText(d); });
  const [end, setEnd] = useState(() => dateText(new Date()));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<AnalysisRow | null>(null);
  const [draftAuto, setDraftAuto] = useState(0);
  const [draftAnalysis, setDraftAnalysis] = useState<{ phoneKey: string; result: Analysis } | null>(null);
  const [limited, setLimited] = useState(false);
  const valid = Boolean(start && end && start <= end);
  const q = useQuery({ queryKey: ["wa-analysis", start, end], queryFn: () => list({ data: { start, end } }), enabled: valid, refetchInterval: 10000 });
  useEffect(() => {
    setSelected(old => {
      if (!old) return old;
      const fresh = q.data?.rows.find(r => r.phoneKey === old.phoneKey);
      return fresh?.result && fresh.analyzedAt !== old.analyzedAt ? fresh : old;
    });
  }, [q.data]);
  if (q.data?.needsAuth) return limited ? <div className="p-8"><p>Análises exigem acesso completo.</p><Button onClick={() => setLimited(false)} className="mt-4">Entrar novamente</Button></div> : <CrmAuthGate onUnlock={a => { if (a.level === "full") void q.refetch(); else setLimited(true); }} />;
  const rows = q.data?.rows ?? [];
  const analyzed = rows.filter(r => r.result);
  const visible = rows.filter(r => filter === "all" || (filter === "pending" ? !r.result : filter === "failure" ? r.result?.serviceAssessment === "possible_failure" : filter === "open" ? r.result?.opportunity === "open" : r.result?.qualification === "qualified"));
  async function run(targets: AnalysisRow[]) {
    setBusy(true); setError(null);
    try {
      for (let i = 0; i < targets.length; i++) {
        setProgress(`${i + 1} de ${targets.length}`);
        const r = await analyze({ data: { phone: targets[i].phone, start, end } });
        if (r.error) { setError(r.error); break; }
        if (r.result && targets.length === 1) { setSelected({ ...targets[i], result: r.result, analyzedAt: r.analyzedAt ?? null }); setDraftAuto(v => v + 1); }
        await q.refetch();
      }
    } catch { setError("Não foi possível concluir a análise."); }
    finally { setBusy(false); setProgress(""); }
  }
  return <div className="min-w-0 space-y-6">
    <header><h1 className="text-2xl font-bold">Análise de Conversas</h1><p className="mt-2 text-sm text-muted-foreground">Qualificação: interesse demonstrado no serviço de tráfego pago.</p></header>
    <div className="flex flex-wrap items-end gap-3">
      {[7, 14, 30].map(days => <Button key={days} variant="outline" size="sm" disabled={busy} onClick={() => { const d = new Date(); d.setDate(d.getDate() - days + 1); setStart(dateText(d)); setEnd(dateText(new Date())); setSelected(null); }}>{days} dias</Button>)}
      <label className="space-y-1 text-xs">De<Input type="date" value={start} disabled={busy} onChange={e => { setStart(e.target.value); setSelected(null); }} /></label>
      <label className="space-y-1 text-xs">Até<Input type="date" value={end} disabled={busy} onChange={e => { setEnd(e.target.value); setSelected(null); }} /></label>
      <Button disabled={busy || !valid || !rows.length} onClick={() => void run(rows)}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{busy ? `Analisando ${progress}` : "Analisar período"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Somente mensagens do período, horário de Brasília. Textos e legendas; áudios e imagens não são interpretados. Análises usam créditos de IA.</p>
    {!valid && <p role="alert" className="text-sm text-destructive">Selecione um período válido.</p>}
    {(error || q.isError) && <div role="alert" className="text-sm text-destructive">{error || "Não foi possível carregar as conversas."}{error && <Button variant="outline" size="sm" className="ml-3" onClick={async () => { const r = await resume(); setError(r.error); }}>Retomar após regularizar créditos</Button>}</div>}
    <div className="grid grid-cols-2 gap-4 border-y py-5 lg:grid-cols-4">{[
      ["Conversas", rows.length], ["Analisadas", analyzed.length], ["Qualificados", analyzed.filter(r => r.result?.qualification === "qualified").length], ["Possíveis falhas", analyzed.filter(r => r.result?.serviceAssessment === "possible_failure").length],
    ].map(([label, count]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{count}</p></div>)}</div>
    <div className="flex flex-wrap gap-2">{[["all", "Todas"], ["qualified", "Qualificados"], ["open", "Oportunidades abertas"], ["failure", "Possíveis falhas"], ["pending", "Não analisadas"]].map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{label}</Button>)}</div>
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="min-w-0">{q.isPending ? <p className="text-muted-foreground">Carregando…</p> : visible.length === 0 ? <p className="text-muted-foreground">Nenhuma conversa neste filtro.</p> : visible.map(row => <div key={row.phoneKey} className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
        <div className="min-w-0"><p className="break-words font-semibold">{row.name}</p><p className="text-xs text-muted-foreground">{row.phone}</p>{row.result ? <div className="mt-2 space-y-1 text-xs"><p className="font-medium text-primary">{qualificationLabels[row.result.qualification]} · {opportunityLabels[row.result.opportunity]}</p><p className="text-muted-foreground">{serviceLabels[row.result.serviceAssessment]} · {new Date(row.analyzedAt ?? "").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div> : <p className="mt-2 text-xs text-muted-foreground">Não analisada</p>}</div>
        <div className="flex gap-2">{row.result && <Button variant="ghost" size="sm" onClick={() => { setSelected(row); setDraftAuto(0); setDraftAnalysis(null); }}>Ver análise</Button>}<Button variant="outline" size="sm" disabled={busy} onClick={() => void run([row])}><Sparkles />{row.result ? "Atualizar" : "Analisar"}</Button></div>
      </div>)}</div>
      <aside className="min-w-0 border-t pt-5 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">{selected?.result ? <><h2 className="mb-4 break-words font-semibold">{selected.name}</h2><AnalysisNextMessage key={`draft:${selected.phoneKey}:${start}:${end}`} phone={selected.phone} start={start} end={end} auto={draftAuto} onAnalysis={result => setDraftAnalysis({ phoneKey: selected.phoneKey, result })} /><details className="mt-5"><summary className="cursor-pointer text-sm font-semibold">Análise e justificativa</summary><div className="mt-4"><AnalysisResult result={draftAnalysis?.phoneKey === selected.phoneKey ? draftAnalysis.result : selected.result} /><KnowledgeRecommendation key={`rec:${selected.phoneKey}:${selected.analyzedAt}`} phone={selected.phone} start={start} end={end} /></div></details>{selected.analyzedAt && canOfferQualification(selected.result) && <AnalysisQualification key={`${selected.phoneKey}:${selected.analyzedAt}`} phone={selected.phone} start={start} end={end} analyzedAt={selected.analyzedAt} result={selected.result} />}</> : <p className="text-sm text-muted-foreground">Nenhuma análise selecionada.</p>}</aside>
    </div>
  </div>;
}
