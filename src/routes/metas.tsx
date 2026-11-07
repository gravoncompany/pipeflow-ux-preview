import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Target, Save, Copy, Trash2, Download, Printer, Sparkles, Plus, Info, Lock, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { AreaLayout } from "@/components/crm/AreaLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { CommercialGoalsDashboard } from "@/components/crm/CommercialGoalsDashboard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { listPipelines } from "@/lib/pipelines.functions";
import { getGoal, saveGoal, duplicateGoalMonth, deleteGoal, listGoalMonths } from "@/lib/commercial-goals.functions";
import {
  goalData, emptyGoal, initialScenario, projections, resolveFunnel, funnelRates, contractResult, cashBalance, div, realizedServiceTotal,
  FUNNEL_KEYS, FUNNEL_LABELS, CRM_CAPABLE, brl, pct, dec, type GoalData,
} from "@/lib/commercial-goals";

export const Route = createFileRoute("/metas")({
  head: () => ({ meta: [
    { title: "Metas Comerciais — PipeFlow CRM" },
    { name: "description", content: "Planeje e acompanhe metas mensais, funil e resultado financeiro dos novos contratos." },
    { property: "og:title", content: "Metas Comerciais — PipeFlow CRM" },
    { property: "og:description", content: "Projeção comparada ao realizado, mês a mês." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: MetasPage,
});

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthLabel = (m: string) => { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y}`; };
const AUTH = "acesso completo";

function NumField({ label, value, onChange, step = "any", hint }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: string; hint?: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => { setText(value == null ? "" : String(value)); }, [value]);
  const invalid = text !== "" && (!Number.isFinite(Number(text.replace(",", "."))) || Number(text.replace(",", ".")) < 0);
  return <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    <Input inputMode="decimal" placeholder="Não informado" value={text} aria-invalid={invalid}
      onChange={(e) => { const t = e.target.value; setText(t); if (t.trim() === "") onChange(null); else { const n = Number(t.replace(",", ".")); if (Number.isFinite(n)) onChange(n); } }} step={step} />
    {invalid ? <p className="text-xs text-destructive">Use um número maior ou igual a zero.</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
  </div>;
}

function Metric({ title, goal, actual, format, lowerIsBetter, detail }: { title: string; goal: number | null; actual: number | null; format: (v: number | null) => string; lowerIsBetter?: boolean; detail?: string }) {
  const diff = goal != null && actual != null ? actual - goal : null;
  const progress = div(actual, goal);
  const good = diff == null ? null : lowerIsBetter ? diff <= 0 : diff >= 0;
  return <Collapsible className="rounded-lg border bg-card p-4">
    <CollapsibleTrigger className="w-full text-left">
      <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{title}</p>{lowerIsBetter && <Badge variant="outline" className="text-[10px]">menor é melhor</Badge>}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm"><div><p className="text-xs text-muted-foreground">Meta</p><p className="font-semibold">{format(goal)}</p></div><div><p className="text-xs text-muted-foreground">Realizado</p><p className="font-semibold">{format(actual)}</p></div></div>
      {!lowerIsBetter && <Progress className="mt-3 h-2" value={progress == null ? 0 : Math.min(100, progress * 100)} />}
      <p className={`mt-2 text-xs ${good == null ? "text-muted-foreground" : good ? "text-primary" : "text-destructive"}`}>
        Diferença: {diff == null ? "Não calculável" : format(diff)}{!lowerIsBetter && progress != null ? ` · ${pct(progress)} da meta` : ""}{lowerIsBetter && good === false ? " · acima do planejado" : ""}
      </p>
    </CollapsibleTrigger>
    {detail && <CollapsibleContent className="mt-2 border-t pt-2 text-xs text-muted-foreground">{detail}</CollapsibleContent>}
  </Collapsible>;
}

function Row({ label, value, formula }: { label: string; value: string; formula?: string }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2 last:border-0"><div><p className="text-sm">{label}</p>{formula && <p className="text-xs text-muted-foreground">{formula}</p>}</div><p className="text-sm font-semibold">{value}</p></div>;
}

function MetasPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [pipeline, setPipeline] = useState("main");
  const fetchPipelines = useServerFn(listPipelines);
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => fetchPipelines(), retry: false });
  const pipelineOptions = [{ id: "main", name: "Funil principal" }, ...(pipelines.data ?? [])];
  const pipelineName = pipelineOptions.find((x) => x.id === pipeline)?.name ?? "Funil";
  const fetchGoal = useServerFn(getGoal); const fetchMonths = useServerFn(listGoalMonths);
  const save = useServerFn(saveGoal); const dup = useServerFn(duplicateGoalMonth); const del = useServerFn(deleteGoal);
  const months = useQuery({ queryKey: ["goal-months", pipeline], queryFn: () => fetchMonths({ data: { pipeline } }), retry: false });
  const query = useQuery({ queryKey: ["goal", pipeline, month], queryFn: () => fetchGoal({ data: { month, pipeline } }), retry: false, refetchOnWindowFocus: false });
  const [draft, setDraft] = useState<GoalData | null>(null);
  const [notes, setNotes] = useState(""); const [plan, setPlan] = useState(""); const [editor, setEditor] = useState("");
  const [dupTo, setDupTo] = useState(""); const [confirmDelete, setConfirmDelete] = useState(false); const [busy, setBusy] = useState(false);

  useEffect(() => { setEditor(localStorage.getItem("metas-editor") ?? ""); }, []);
  useEffect(() => {
    const g = query.data?.goal;
    setDraft(g ? structuredClone(g.data) : null); setNotes(g?.notes ?? ""); setPlan(g?.actionPlan ?? "");
  }, [query.data]);

  const err = (query.error as Error | null)?.message ?? (months.error as Error | null)?.message ?? "";
  if (err.includes(AUTH)) return <CrmAuthGate onUnlock={(a) => { if (a.level === "full") { void query.refetch(); void months.refetch(); } else toast.error("Metas exigem a senha de acesso completo."); }} />;

  const d = draft;
  const set = (fn: (g: GoalData) => void) => setDraft((prev) => { if (!prev) return prev; const n = structuredClone(prev); fn(n); return n; });
  const existing = query.data?.goal ?? null;
  const dirty = d != null && (JSON.stringify(d) !== JSON.stringify(existing?.data ?? null) || notes !== (existing?.notes ?? "") || plan !== (existing?.actionPlan ?? ""));

  async function onSave() {
    if (!d) return;
    const parsed = goalData.safeParse(d);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Revise os valores.");
    if (!editor.trim()) return toast.error("Informe o responsável pela alteração.");
    setBusy(true);
    try {
      localStorage.setItem("metas-editor", editor.trim());
      await save({ data: { month, pipeline, data: parsed.data, notes, actionPlan: plan, updatedBy: editor.trim(), expectedUpdatedAt: existing?.updatedAt ?? null } });
      toast.success("Meta salva."); await Promise.all([query.refetch(), months.refetch()]);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function onDuplicate() {
    if (!/^\d{4}-\d{2}$/.test(dupTo)) return toast.error("Escolha o mês de destino.");
    if (!editor.trim()) return toast.error("Informe o responsável pela alteração.");
    setBusy(true);
    try { await dup({ data: { pipeline, from: month, to: dupTo, updatedBy: editor.trim() } }); toast.success(`Metas copiadas para ${monthLabel(dupTo)} (sem resultados realizados).`); await months.refetch(); setMonth(dupTo); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function onDelete() {
    setBusy(true);
    try { await del({ data: { month, pipeline } }); toast.success("Meta excluída."); setConfirmDelete(false); await qc.invalidateQueries({ queryKey: ["goal", pipeline, month] }); await months.refetch(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return <AreaLayout title="Metas Comerciais" groups={[]} onLogout={() => { window.location.href = "/"; }}>
    <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6 print:hidden">
        <div><div className="mb-2 flex items-center gap-2 text-primary"><Target className="h-5 w-5" /><span className="text-sm font-medium">Planejamento mensal</span></div><h1 className="text-2xl font-bold">Metas Comerciais</h1><p className="mt-1 text-sm text-muted-foreground">Projeção comparada com o resultado realizado</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Funil</Label><Select value={pipeline} onValueChange={setPipeline}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger><SelectContent>{pipelineOptions.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Mês</Label><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" /></div>
          {months.data && months.data.length > 0 && <Select value={months.data.includes(month) ? month : ""} onValueChange={setMonth}><SelectTrigger className="w-44"><SelectValue placeholder="Meses salvos" /></SelectTrigger><SelectContent>{months.data.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent></Select>}
        </div>
      </header>

      {query.isLoading ? <p className="py-10 text-sm text-muted-foreground">Carregando…</p>
        : query.error ? <p className="py-10 text-sm text-destructive">{err}</p>
        : !d ? <section className="flex flex-col items-center gap-3 py-16 text-center">
            <Lock className="hidden" /><p className="text-lg font-semibold">Sem meta para {pipelineName} em {monthLabel(month)}</p>
            <p className="max-w-md text-sm text-muted-foreground">Crie uma meta em branco ou aplique a projeção inicial editável. Nada é salvo até você clicar em Salvar.</p>
            <div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={() => setDraft(emptyGoal())}><Plus />Meta em branco</Button><Button onClick={() => setDraft(initialScenario())}><Sparkles />Aplicar projeção inicial</Button></div>
          </section>
        : query.data ? <Editor key={`${pipeline}:${month}`} pipelineName={pipelineName} month={month} d={d} set={set} crm={query.data.crm} notes={notes} setNotes={setNotes} plan={plan} setPlan={setPlan}
            editor={editor} setEditor={setEditor} existing={existing} dirty={dirty} busy={busy} onSave={onSave}
            dupTo={dupTo} setDupTo={setDupTo} onDuplicate={onDuplicate} onDelete={() => setConfirmDelete(true)} onApplyScenario={() => set((g) => { g.goals = initialScenario().goals; })} /> : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir a meta de {pipelineName} em {monthLabel(month)}?</AlertDialogTitle><AlertDialogDescription>Os dados deste mês serão apagados. Outros meses e funis não mudam.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void onDelete(); }}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </main>
  </AreaLayout>;
}

type EditorProps = {
  pipelineName: string; month: string; d: GoalData; set: (fn: (g: GoalData) => void) => void; crm: { leads: number; qualified: number; clients: number };
  notes: string; setNotes: (s: string) => void; plan: string; setPlan: (s: string) => void; editor: string; setEditor: (s: string) => void;
  existing: { updatedBy: string; updatedAt: string } | null; dirty: boolean; busy: boolean; onSave: () => void;
  dupTo: string; setDupTo: (s: string) => void; onDuplicate: () => void; onDelete: () => void; onApplyScenario: () => void;
};

function Editor(p: EditorProps) {
  const [configOpen, setConfigOpen] = useState(!p.existing);
  const { d, set, crm } = p;
  const proj = useMemo(() => projections(d.goals), [d.goals]);
  const funnel = resolveFunnel(d, crm);
  const media = d.actual.adSpend;
  const rates = funnelRates(funnel.value, media);
  const clientsActual = funnel.value.clients;
  const projected = contractResult({ contracts: proj.contractsTotal, media: d.goals.budget, extraCommercial: d.actual.extraCommercial, serviceTotal: proj.serviceTotal, taxes: d.actual.taxes, fees: d.actual.fees, clients: d.goals.clients });
  const realServiceTotal = realizedServiceTotal(clientsActual, d.goals.serviceCost);
  const realized = contractResult({ contracts: d.actual.contractsValue, media, extraCommercial: d.actual.extraCommercial, serviceTotal: realServiceTotal, taxes: d.actual.taxes, fees: d.actual.fees, clients: clientsActual });
  const cash = cashBalance(d.cash.received, d.cash.paidOut);
  const planned = d.cash.payments.reduce((s, x) => s + x.amount, 0);

  function exportCsv() {
    const rows: [string, string][] = [
      ["Funil", p.pipelineName], ["Mês", monthLabel(p.month)], ["Orçamento de anúncios", brl(d.goals.budget)], ["Custo por lead qualificado", brl(d.goals.cplQ)], ["Meta de novos clientes", dec(d.goals.clients, 0)],
      ["Leads qualificados projetados", dec(proj.qualified)], ["Conversão necessária", pct(proj.conversion)], ["Valor total de contratos projetado", brl(proj.contractsTotal)],
      ["Custo de mídia por venda (meta)", brl(proj.mediaPerSale)], ["Atendimento mensal dos novos clientes", brl(proj.serviceMonthly)], ["Entrega do período", brl(proj.serviceTotal)],
      ["Saldo estimado projetado", brl(projected.balance)],
      ...FUNNEL_KEYS.map((k) => [`${FUNNEL_LABELS[k]} (meta / realizado · ${funnel.origin[k]})`, `${dec(d.funnel.target[k], 0)} / ${funnel.value[k] == null ? "Não informado" : dec(funnel.value[k], 0)}`] as [string, string]),
      ["Investimento realizado", brl(media)], ["Contratos vendidos (realizado)", brl(d.actual.contractsValue)], ["Saldo estimado realizado", brl(realized.balance)],
      ["Recebido", brl(d.cash.received)], ["Saídas pagas", brl(d.cash.paidOut)], ["Saldo de caixa", brl(cash)], ["Observações", p.notes], ["Plano de ação", p.plan],
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `metas-${p.pipelineName.replace(/[^\w-]+/g, "-")}-${p.month}.csv`; a.click();
  }

  return <div className="space-y-6 py-6">
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <div><h2 className="text-lg font-semibold">{monthLabel(p.month)}</h2><p className="mt-1 text-xs text-muted-foreground">{p.pipelineName}{p.dirty ? " · alterações não salvas" : ""}{p.existing ? ` · atualizado em ${new Date(p.existing.updatedAt).toLocaleDateString("pt-BR")}` : " · meta ainda não salva"}</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={exportCsv}><Download className="size-4" />CSV</Button><Button variant="outline" onClick={() => window.print()}><Printer className="size-4" />PDF</Button><Button onClick={() => setConfigOpen(true)}><Settings2 className="size-4" />Configurar Metas</Button></div>
    </div>
    <CommercialGoalsDashboard data={d} crm={crm} notes={p.notes} plan={p.plan} month={p.month} />
    <Dialog open={configOpen} onOpenChange={setConfigOpen}><DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl flex-col overflow-hidden p-0"><DialogHeader className="shrink-0 border-b px-6 py-5 pr-12"><DialogTitle>Configurar metas comerciais</DialogTitle><DialogDescription>{p.pipelineName} · {monthLabel(p.month)}</DialogDescription></DialogHeader><div className="space-y-6 overflow-y-auto px-6 pb-6">
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <div className="space-y-1"><Label className="text-xs">Responsável pela alteração</Label><Input value={p.editor} onChange={(e) => p.setEditor(e.target.value)} placeholder="Seu nome" className="w-48" /></div>
      <Button onClick={p.onSave} disabled={p.busy || !p.dirty}><Save />Salvar</Button>
      <Button variant="outline" onClick={p.onApplyScenario}><Sparkles />Aplicar projeção inicial</Button>
      {p.existing && <><Input type="month" value={p.dupTo} onChange={(e) => p.setDupTo(e.target.value)} className="w-40" aria-label="Mês de destino" /><Button variant="outline" disabled={p.busy} onClick={p.onDuplicate}><Copy />Duplicar</Button></>}
      <Button variant="outline" onClick={exportCsv}><Download />CSV</Button>
      <Button variant="outline" onClick={() => window.print()}><Printer />PDF</Button>
      {p.existing && <Button variant="ghost" className="text-destructive" onClick={p.onDelete}><Trash2 />Excluir</Button>}
    </div>
    <p className="text-xs text-muted-foreground">{p.existing ? `Última alteração por ${p.existing.updatedBy || "—"} em ${new Date(p.existing.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "Meta ainda não salva."}{p.dirty ? " · alterações não salvas" : ""}</p>
    <h2 className="hidden text-xl font-bold print:block">Metas Comerciais — {p.pipelineName} — {monthLabel(p.month)}</h2>

    <Tabs defaultValue="metas">
      <TabsList className="print:hidden"><TabsTrigger value="metas">Metas</TabsTrigger><TabsTrigger value="funil">Funil</TabsTrigger><TabsTrigger value="financeiro">Financeiro</TabsTrigger></TabsList>

      <TabsContent value="metas" className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumField label="Orçamento mensal de anúncios (R$)" value={d.goals.budget} onChange={(v) => set((g) => { g.goals.budget = v; })} />
          <NumField label="Custo esperado por lead qualificado (R$)" value={d.goals.cplQ} onChange={(v) => set((g) => { g.goals.cplQ = v; })} />
          <NumField label="Meta de novos clientes" value={d.goals.clients} onChange={(v) => set((g) => { g.goals.clients = v; })} hint="Número inteiro" />
          <NumField label="Valor médio total do contrato (R$)" value={d.goals.contract} onChange={(v) => set((g) => { g.goals.contract = v; })} />
          <NumField label="Duração do contrato (meses)" value={d.goals.duration} onChange={(v) => set((g) => { g.goals.duration = v; })} hint="Inteiro, mínimo 1" />
          <NumField label="Custo de atendimento por cliente (contrato completo, R$)" hint="Valor total por cliente durante todo o contrato; não é multiplicado pelos meses." value={d.goals.serviceCost} onChange={(v) => set((g) => { g.goals.serviceCost = v; })} />
        </section>
        <section className="rounded-lg border p-4">
          <p className="text-sm font-medium">O custo de atendimento por cliente inclui:</p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {([["direct", "Custos diretos"], ["fixed", "Parcela dos custos fixos da agência"], ["team", "Trabalho da equipe e do responsável"]] as const).map(([k, l]) =>
              <label key={k} className="flex items-center gap-2"><Checkbox checked={d.goals.serviceIncludes[k]} onCheckedChange={(c) => set((g) => { g.goals.serviceIncludes[k] = c === true; })} />{l}</label>)}
            <label className="flex items-center gap-2"><Checkbox checked={d.goals.serviceValidated} onCheckedChange={(c) => set((g) => { g.goals.serviceValidated = c === true; })} />Valor validado</label>
          </div>
          {!d.goals.serviceValidated && <p className="mt-2 text-xs text-muted-foreground">Estimativa ainda não validada. Itens marcados como incluídos não devem ser descontados de novo. Não inclui receita ou despesas da carteira atual.</p>}
        </section>
        {(d.goals.clients != null && !Number.isInteger(d.goals.clients)) && <p className="text-sm text-destructive">A meta de clientes deve ser um número inteiro.</p>}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric title="Leads qualificados" goal={proj.qualified} actual={funnel.value.qualified} format={(v) => dec(v)} detail="Projeção = orçamento ÷ custo por lead qualificado (sem arredondar nos cálculos)." />
          <Metric title="Novos clientes" goal={d.goals.clients} actual={clientsActual} format={(v) => dec(v, 0)} detail={`Origem do realizado: ${funnel.origin.clients}. A meta não é garantia de vendas.`} />
          <Metric title="Valor total de contratos" goal={proj.contractsTotal} actual={d.actual.contractsValue} format={brl} detail="Projeção = meta de clientes × valor médio do contrato." />
          <Metric title="Investimento em anúncios" goal={d.goals.budget} actual={media} format={brl} lowerIsBetter detail="Gastar acima do orçamento não é desempenho positivo." />
          <Metric title="Custo por lead qualificado" goal={d.goals.cplQ} actual={rates.cplQualified} format={brl} lowerIsBetter detail="Realizado = investimento ÷ leads qualificados." />
          <Metric title="Custo de mídia por venda" goal={proj.mediaPerSale} actual={rates.mediaPerSale} format={brl} lowerIsBetter detail="Anúncios ÷ novos clientes." />
        </section>
        <section className="rounded-lg border p-4">
          <h3 className="mb-2 font-semibold">Cálculos da projeção</h3>
          <Row label="Leads qualificados projetados" value={dec(proj.qualified)} formula="orçamento ÷ custo por lead qualificado" />
          <Row label="Conversão necessária" value={pct(proj.conversion)} formula="meta de clientes ÷ leads qualificados projetados" />
          <Row label="Valor total de contratos projetado" value={brl(proj.contractsTotal)} formula="meta de clientes × valor médio do contrato" />
          <Row label="Valor mensal equivalente por cliente" value={brl(proj.monthlyPerClient)} formula="valor do contrato ÷ duração" />
          <Row label="Custo de mídia por venda" value={brl(proj.mediaPerSale)} formula="orçamento ÷ meta de clientes" />
          <Row label="Atendimento mensal dos novos clientes" value={brl(proj.serviceMonthly)} formula="entrega do período ÷ duração" />
          <Row label="Custo de entrega de todo o período" value={brl(proj.serviceTotal)} formula="meta de clientes × custo de atendimento por cliente (contrato completo)" />
          {d.goals.clients != null && d.goals.duration != null && proj.contractsTotal != null &&
            <p className="mt-3 flex gap-2 rounded-md bg-muted p-3 text-xs"><Info className="h-4 w-4 shrink-0" />Esta projeção considera conquistar {d.goals.clients} clientes com 1 mês de anúncios e atendê-los durante {d.goals.duration} meses. O saldo de {brl(projected.balance)} corresponde ao período completo desses contratos, não a cada mês. Os resultados dependem das premissas e não são garantidos.</p>}
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1"><Label>Observações</Label><Textarea value={p.notes} onChange={(e) => p.setNotes(e.target.value)} rows={4} /></div>
          <div className="space-y-1"><Label>Plano de ação</Label><Textarea value={p.plan} onChange={(e) => p.setPlan(e.target.value)} rows={4} /></div>
        </section>
      </TabsContent>

      <TabsContent value="funil" className="space-y-6">
        <p className="text-sm text-muted-foreground">CRM: leads que entraram no mês somente neste funil, pela etapa atual. Reuniões realizadas e propostas enviadas não são registradas no CRM e ficam manuais. Cada indicador usa uma única origem.</p>
        <section className="space-y-3">
          <h3 className="font-semibold">Conversão dos leads captados no mês</h3>
          {FUNNEL_KEYS.map((k) => <div key={k} className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_8rem_9rem_7rem]">
            <div><p className="text-sm font-medium">{FUNNEL_LABELS[k]}</p><Badge variant={funnel.origin[k] === "CRM" ? "default" : "secondary"} className="mt-1">{funnel.origin[k]}</Badge></div>
            <NumField label="Meta" value={d.funnel.target[k]} onChange={(v) => set((g) => { g.funnel.target[k] = v; })} />
            <NumField label="Manual" value={d.funnel.manual[k]} onChange={(v) => set((g) => { g.funnel.manual[k] = v; })} />
            <div className="space-y-1"><Label className="text-xs">Origem</Label>
              <Select value={d.funnel.source[k]} onValueChange={(v) => set((g) => { g.funnel.source[k] = v as "crm" | "manual"; })} disabled={!CRM_CAPABLE.includes(k)}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="crm">CRM</SelectItem><SelectItem value="manual">Manual</SelectItem></SelectContent></Select></div>
            <div><p className="text-xs text-muted-foreground">Realizado</p><p className="font-semibold">{funnel.value[k] == null ? "Não informado" : dec(funnel.value[k], 0)}</p></div>
          </div>)}
        </section>
        <section className="rounded-lg border p-4">
          <h3 className="mb-2 font-semibold">Taxas do grupo captado no mês</h3>
          <Row label="Taxa de qualificação" value={pct(rates.qualificationRate)} formula={`qualificados ÷ leads totais (${dec(funnel.value.qualified, 0)} ÷ ${dec(funnel.value.leads, 0)})`} />
          <Row label="Conversão de qualificados em vendas" value={pct(rates.qualifiedToSale)} formula={`clientes ÷ qualificados (${dec(funnel.value.clients, 0)} ÷ ${dec(funnel.value.qualified, 0)})`} />
          <Row label="Conversão de propostas em vendas" value={pct(rates.proposalToSale)} formula={`clientes ÷ propostas (${dec(funnel.value.clients, 0)} ÷ ${dec(funnel.value.proposals, 0)})`} />
          <Row label="Custo por lead total" value={rates.cpl == null ? "Não calculável" : brl(rates.cpl)} formula="investimento ÷ leads totais" />
          <Row label="Custo por lead qualificado" value={rates.cplQualified == null ? "Não calculável" : brl(rates.cplQualified)} formula="investimento ÷ leads qualificados" />
          <Row label="Custo de mídia por venda" value={rates.mediaPerSale == null ? "Não calculável" : brl(rates.mediaPerSale)} formula="investimento ÷ clientes fechados" />
        </section>
        <section className="rounded-lg border p-4">
          <h3 className="font-semibold">Atividade do mês</h3>
          <p className="mb-3 text-xs text-muted-foreground">Eventos ocorridos no mês, inclusive de leads antigos. Não são divididos pelos leads novos.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumField label="Reuniões realizadas no mês" value={d.funnel.activityMeetings} onChange={(v) => set((g) => { g.funnel.activityMeetings = v; })} />
            <NumField label="Fechamentos no mês" value={d.funnel.activityClients} onChange={(v) => set((g) => { g.funnel.activityClients = v; })} />
          </div>
        </section>
      </TabsContent>

      <TabsContent value="financeiro" className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumField label="Investimento em anúncios realizado (R$)" value={d.actual.adSpend} onChange={(v) => set((g) => { g.actual.adSpend = v; })} />
          <NumField label="Valor total dos contratos vendidos (R$)" value={d.actual.contractsValue} onChange={(v) => set((g) => { g.actual.contractsValue = v; })} />
          <NumField label="Custos comerciais adicionais (R$)" value={d.actual.extraCommercial} onChange={(v) => set((g) => { g.actual.extraCommercial = v; })} hint="Ex.: comissões. Não repita custos já incluídos." />
          <NumField label="Impostos estimados (R$)" value={d.actual.taxes} onChange={(v) => set((g) => { g.actual.taxes = v; })} />
          <NumField label="Taxas estimadas (R$)" value={d.actual.fees} onChange={(v) => set((g) => { g.actual.fees = v; })} />
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          {([["A. Resultado projetado dos contratos", projected, proj.contractsTotal, d.goals.budget, proj.serviceTotal], ["A. Resultado realizado dos contratos adquiridos", realized, d.actual.contractsValue, media, realServiceTotal]] as const).map(([title, r, contracts, m, svc]) =>
            <div key={title} className="rounded-lg border p-4">
              <h3 className="mb-2 font-semibold">{title}</h3>
              <Row label="Valor total dos contratos" value={brl(contracts)} />
              <Row label="Investimento em anúncios" value={brl(m)} />
              <Row label="Custos comerciais adicionais" value={brl(d.actual.extraCommercial)} />
              <Row label="Atendimento durante toda a duração" value={brl(svc)} formula="custo de entrega, não de aquisição" />
              <Row label="Impostos" value={brl(d.actual.taxes)} /><Row label="Taxas" value={brl(d.actual.fees)} />
              <Row label="Saldo estimado" value={r.balance == null ? "Não calculável" : brl(r.balance)} formula="contratado − mídia − comerciais − entrega do período − impostos − taxas" />
              <Row label="Saldo por cliente" value={r.perClient == null ? "Não calculável" : brl(r.perClient)} />
              <Row label="Margem estimada" value={pct(r.margin)} />
              <Row label="Custo de mídia por venda" value={r.mediaPerSale == null ? "Não calculável" : brl(r.mediaPerSale)} formula="anúncios ÷ novos clientes" />
              <Row label={`CAC ${r.cacPartial ? "(parcial)" : "completo"}`} value={r.cac == null ? "Não calculável" : brl(r.cac)} formula="(anúncios + demais custos de aquisição) ÷ novos clientes" />
              {r.missing.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Saldo antes de {r.missing.join(", ")} (não informados). Não é lucro líquido.</p>}
            </div>)}
        </section>
        <section className="rounded-lg border p-4">
          <h3 className="mb-1 font-semibold">B. Caixa do mês</h3>
          <p className="mb-3 text-xs text-muted-foreground">Somente lançamentos registrados. Contrato vendido não significa valor recebido.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumField label="Valor efetivamente recebido (R$)" value={d.cash.received} onChange={(v) => set((g) => { g.cash.received = v; })} />
            <NumField label="Saídas efetivamente pagas (R$)" value={d.cash.paidOut} onChange={(v) => set((g) => { g.cash.paidOut = v; })} />
          </div>
          <Row label="Saldo de caixa dos lançamentos" value={cash == null ? "Não informado" : brl(cash)} formula="recebido − saídas pagas" />
          <h4 className="mt-4 text-sm font-medium">Pagamentos previstos</h4>
          {d.cash.payments.length === 0 && <p className="text-sm text-muted-foreground">Não informado</p>}
          {d.cash.payments.map((pay, i) => <div key={i} className="mt-2 grid items-end gap-2 sm:grid-cols-[9rem_8rem_1fr_6rem_auto]">
            <div className="space-y-1"><Label className="text-xs">Data</Label><Input type="date" value={pay.date} onChange={(e) => set((g) => { g.cash.payments[i].date = e.target.value; })} /></div>
            <NumField label="Valor (R$)" value={pay.amount} onChange={(v) => set((g) => { g.cash.payments[i].amount = v ?? 0; })} />
            <div className="space-y-1"><Label className="text-xs">Forma de pagamento</Label><Input value={pay.method} onChange={(e) => set((g) => { g.cash.payments[i].method = e.target.value; })} /></div>
            <NumField label="Parcelas" value={pay.installments} onChange={(v) => set((g) => { g.cash.payments[i].installments = v; })} />
            <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => set((g) => { g.cash.payments.splice(i, 1); })}><Trash2 /></Button>
          </div>)}
          <Button variant="outline" size="sm" className="mt-3" onClick={() => set((g) => { g.cash.payments.push({ date: `${p.month}-01`, amount: 0, method: "", installments: null }); })}><Plus />Adicionar pagamento previsto</Button>
          {d.cash.payments.length > 0 && <p className="mt-2 text-sm">Total previsto: <strong>{brl(planned)}</strong> (ainda não recebido)</p>}
        </section>
      </TabsContent>
    </Tabs>
    </div><div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-6 py-4"><span className="text-xs text-muted-foreground">{p.dirty ? "Alterações não salvas" : "Sem alterações pendentes"}</span><div className="flex gap-2"><Button variant="outline" onClick={() => setConfigOpen(false)}>Voltar ao painel</Button><Button onClick={p.onSave} disabled={p.busy || !p.dirty}><Save className="size-4" />{p.busy ? "Salvando…" : "Salvar"}</Button></div></div></DialogContent></Dialog>
  </div>;
}
