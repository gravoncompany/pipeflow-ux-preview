import { BankBatchReview } from "./BankBatchReview";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from "recharts";
import { Sparkles, Loader2, CheckCheck, AlertTriangle, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getBankOverview, suggestBankWithAi } from "@/lib/bank-overview.functions";
import { saveBankClassifications } from "@/lib/polp.functions";
import { BUSINESS_CATEGORIES, PERSONAL_CATEGORIES, CATEGORY_LABEL, KIND_LABEL, type BankKind, type CostCategory } from "@/lib/bank-classification";
import type { BankOverview } from "@/lib/bank-overview.server";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pad = (n: number) => String(n).padStart(2, "0");
const spToday = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const dayBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
type Preset = "30d" | "mes" | "mes_anterior" | "ano" | "custom";
function rangeOf(p: Preset): { from: string; to: string } {
  const t = spToday(); const [y, m] = t.split("-").map(Number) as [number, number];
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (p === "mes") return { from: `${y}-${pad(m)}-01`, to: t };
  if (p === "mes_anterior") { const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1]; return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(last(py, pm))}` }; }
  if (p === "ano") return { from: `${y}-01-01`, to: t };
  const d = new Date(`${t}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 29);
  return { from: d.toISOString().slice(0, 10), to: t };
}
type RowView = BankOverview["pending"][number];
type ListRow = BankOverview["cards"]["revenue"][number];
const CREDIT_KINDS: BankKind[] = ["receita_operacional", "entrada_pessoal", "resgate", "rendimento", "transferencia_interna", "emprestimo"];
const DEBIT_KINDS: BankKind[] = ["despesa_operacional", "despesa_pessoal", "aplicacao", "transferencia_interna", "emprestimo"];
const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function BankOverviewPanel({ personal, reviewOnly=false }: { personal: boolean; reviewOnly?: boolean }) {
  const read = useServerFn(getBankOverview), suggest = useServerFn(suggestBankWithAi), saveMany = useServerFn(saveBankClassifications);
  const [preset, setPreset] = useState<Preset>("mes");
  const [custom, setCustom] = useState(rangeOf("mes"));
  const [year, setYear] = useState(Number(spToday().slice(0, 4)));
  const range = preset === "custom" ? custom : rangeOf(preset);
  const valid = Boolean(range.from && range.to && range.from <= range.to);
  const q = useQuery({ queryKey: ["bank-overview", range.from, range.to, year, personal], queryFn: () => read({ data: { ...range, year, personal } }), enabled: valid, retry: false, refetchOnWindowFocus: false });
  const [list, setList] = useState<{ title: string; note?: string; rows: ListRow[]; total: number } | null>(null);
  const [busy, setBusy] = useState(""); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [edit, setEdit] = useState<Record<string, { kind: BankKind; category: CostCategory | null }>>({});
  const [showAll, setShowAll] = useState(false);
  const d = q.data;

  async function runAi() {
    setBusy("ai"); setErr(""); setMsg("");
    try {
      let total = 0;
      for (let i = 0; i < 40; i++) {
        const r = await suggest({ data: range });
        total += r.suggested;
        setMsg(`Pipeflow IA analisando… ${total} sugestões${r.remaining ? ` · faltam ${r.remaining}` : ""}`);
        if (!r.remaining) break;
      }
      setMsg(`Pipeflow IA sugeriu categorias para ${total} movimentações. Nada foi confirmado: revise abaixo.`);
      await q.refetch();
    } catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível concluir."); await q.refetch(); } finally { setBusy(""); }
  }
  async function confirm(items: { r: Pick<RowView, "id" | "overrideRevision" | "suggestion">; kind: BankKind; category: CostCategory | null }[], ok: string) {
    if (!items.length) return;
    setBusy("save"); setErr(""); setMsg("");
    try {
      let saved = 0;
      for (let i = 0; i < items.length; i += 200) {
        const out = await saveMany({ data: { items: items.slice(i, i + 200).map(({ r, kind, category }) => ({
          transactionId: r.id, kind, category: kind === "despesa_operacional" || kind === "despesa_pessoal" ? category : null, vendor: r.suggestion.vendor,
          expectedRevision: r.overrideRevision, decision: kind === r.suggestion.kind && category === r.suggestion.category ? "aprovado" as const : "corrigido" as const, rule: null,
        })) } });
        if (!out.ok) { setErr(`${out.error}${saved ? ` (${saved} já salvas)` : ""}`); break; }
        saved += out.saved;
      }
      if (saved) setMsg(ok.replace("{n}", String(saved)));
      setEdit({}); await q.refetch();
    } catch { setErr("Não foi possível salvar; atualize e tente de novo."); } finally { setBusy(""); }
  }
  const choice = (r: RowView) => edit[r.id] ?? (r.ai && r.ai.kind !== "nao_classificado" ? { kind: r.ai.kind, category: r.ai.category } : r.suggestion.kind !== "nao_classificado" && !r.suggestion.hint ? { kind: r.suggestion.kind, category: r.suggestion.category } : null);

  const header = <div className="flex flex-wrap items-end justify-between gap-3">
    <div><h2 className="text-lg font-semibold">{personal ? "Gastos pessoais no banco" : "Visão bancária classificada"}</h2>
      <p className="mt-1 text-xs text-muted-foreground">Nubank PJ · só lançamentos confirmados entram nos totais; pendências aparecem separadas.</p></div>
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1">{([["30d", "Últimos 30 dias"], ["mes", "Mês atual"], ["mes_anterior", "Mês anterior"], ["ano", "Ano atual"], ["custom", "Personalizado"]] as [Preset, string][]).map(([v, l]) =>
        <Button key={v} size="sm" variant={preset === v ? "default" : "outline"} onClick={() => setPreset(v)}>{l}</Button>)}</div>
      {preset === "custom" && <><label className="text-xs">De<Input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
        <label className="text-xs">Até<Input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label></>}
    </div>
  </div>;

  if (!valid) return <section className="mb-8 border-b pb-8">{header}<p role="alert" className="mt-4 text-sm text-destructive">Escolha um período válido.</p></section>;
  if (q.isPending) return <section className="mb-8 border-b pb-8">{header}<p className="mt-6 text-sm text-muted-foreground">Carregando movimentações bancárias…</p></section>;
  if (q.isError || !d) return <section className="mb-8 border-b pb-8">{header}<p role="alert" className="mt-6 text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Movimentações indisponíveis."}</p></section>;
  const t = d.totals;
  const card = (label: string, value: string, hint: string, open: (() => void) | null, tone = "") =>
    <button type="button" disabled={!open} onClick={open ?? undefined} className="rounded-lg border bg-card p-4 text-left transition-colors enabled:hover:border-primary disabled:cursor-default">
      <p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-xl font-semibold ${tone}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {open && <p className="mt-2 text-xs font-medium text-primary">Ver lançamentos</p>}
    </button>;
  const openList = (key: keyof BankOverview["cards"], title: string, total: number, note?: string) => () => setList({ title, note, rows: d.cards[key], total });
  const evolution = d.evolution.map((m, i) => ({ mes: MONTHS[i], Faturamento: m.revenueCents === null ? null : m.revenueCents / 100, Despesas: m.opExpenseCents === null ? null : m.opExpenseCents / 100,
    Resultado: m.opResultCents === null ? null : m.opResultCents / 100, Pessoais: m.personalCents === null ? null : m.personalCents / 100, incompleto: !m.empty && m.incomplete, vazio: m.empty }));
  const cats = personal ? d.personalCategories : d.opCategories;
  const highAi = d.highConfidence;
  const pendingShown = showAll ? d.pending : d.pending.slice(0, 40);

  if(reviewOnly) return <section className="space-y-4">{header}<BankBatchReview data={d} range={range} reload={()=>q.refetch()}/></section>;
  return <section className="mb-8 space-y-6 border-b pb-8">
    {header}
    {d.coverage && <p className={`text-xs ${d.coverage.partial ? "text-destructive" : "text-muted-foreground"}`}>
      {d.coverage.partial
        ? d.coverage.availableFrom ? `Cobertura parcial: há movimentações do banco só de ${dayBr(d.coverage.availableFrom)} a ${dayBr(d.coverage.availableTo)} neste período.` : "Nenhuma movimentação do banco foi importada ainda."
        : `Período ${dayBr(d.period.from)} a ${dayBr(d.period.to)} coberto pelo banco.`}
      {d.coverage.syncedUntil && ` Última sincronização buscou dados até ${new Date(d.coverage.syncedUntil).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`}</p>}
    {d.truncated && <p className="text-xs text-destructive">O período tem mais movimentações do que o limite de leitura; os totais podem estar incompletos.</p>}
    {t.resultProvisional && <p className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      Há {t.pendingCount} movimentações pendentes de revisão ({brl(t.pendingInCents)} em entradas e {brl(t.pendingOutCents)} em saídas). Os resultados abaixo ainda não são definitivos.</p>}

    {!personal ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {card("Faturamento", brl(t.revenueCents), `Recebimentos confirmados: ${brl(t.revenueFromFinanceCents)} no Financeiro + ${brl(t.revenueFromBankCents)} confirmados no banco${t.possibleDuplicates ? ` · ${t.possibleDuplicates} coincidências de valor/data para revisar (sem excluir receitas)` : ""}`,
        openList("revenue", "Faturamento · entradas do banco confirmadas como receita", d.cardCounts.revenue, `Mais ${d.revenueFromFinanceCount} recebimentos lançados no Financeiro (${brl(t.revenueFromFinanceCents)}).`), "text-primary")}
      {card("Despesas operacionais", brl(t.opExpenseCents), "Gastos confirmados da operação da Gravon", openList("opExpense", "Despesas operacionais confirmadas", d.cardCounts.opExpense))}
      {card("Resultado operacional", brl(t.opResultCents), t.resultProvisional ? "Provisório: há pendências relevantes" : "Faturamento − despesas operacionais", null, t.opResultCents < 0 ? "text-destructive" : "")}
      {card("Entradas bancárias", brl(t.bankInCents), "Todos os créditos do período (não é faturamento)", openList("bankIn", "Entradas bancárias", d.cardCounts.bankIn))}
      {card("Saídas bancárias", brl(t.bankOutCents), "Todos os débitos, inclusive aplicações", openList("bankOut", "Saídas bancárias", d.cardCounts.bankOut))}
    </div> : <div className="grid gap-3 sm:grid-cols-2">
      {card("Despesas pessoais confirmadas", brl(t.personalCents), "Período selecionado", openList("personal", "Despesas pessoais confirmadas", d.cardCounts.personal))}
      {card("Pendentes de revisão", String(t.pendingCount), "Classifique na Visão Geral empresarial", null)}
    </div>}

    <div className="grid gap-6 xl:grid-cols-2">
      <article className="rounded-lg border bg-card p-4">
        <h3 className="font-semibold">{personal ? "Gastos pessoais por categoria" : "Despesas operacionais por categoria"}</h3>
        <p className="mb-3 text-xs text-muted-foreground">Clique numa categoria para ver os lançamentos.</p>
        {cats.length ? <div className="h-72"><ResponsiveContainer><BarChart data={cats.map((c) => ({ name: c.label, valor: c.cents / 100 }))} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={(v) => `R$ ${Number(v).toLocaleString("pt-BR")}`} /><YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => brl(Number(v) * 100)} />
          <Bar dataKey="valor" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(_, i) => { const c = cats[i]; if (c) setList({ title: c.label, rows: c.rows, total: c.count }); }}>
            {cats.map((c, i) => <Cell key={c.category} fill={CHART[i % CHART.length]} />)}</Bar>
        </BarChart></ResponsiveContainer></div> : <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma despesa confirmada no período.</p>}
      </article>
      <article className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><div><h3 className="font-semibold">{personal ? "Gastos pessoais por mês" : "Evolução financeira"}</h3>
          <p className="text-xs text-muted-foreground">Janeiro a dezembro. Meses sem dados ficam vazios; meses com pendências aparecem como incompletos.</p></div>
          <label className="text-xs">Ano<Input type="number" className="w-24" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} /></label></div>
        <div className="h-72"><ResponsiveContainer>{personal
          ? <BarChart data={d.personalMonths.map((m, i) => ({ mes: MONTHS[i], Pessoais: m.cents === null ? null : m.cents / 100 }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="mes" /><YAxis tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} /><Tooltip formatter={(v) => brl(Number(v) * 100)} /><Bar dataKey="Pessoais" fill="var(--chart-2)" radius={[4, 4, 0, 0]} /></BarChart>
          : <ComposedChart data={evolution}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="mes" tickFormatter={(v, i) => (evolution[i]?.incompleto ? `${v}*` : v)} /><YAxis tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} />
            <Tooltip formatter={(v) => (v === null ? "Sem dados" : brl(Number(v) * 100))} labelFormatter={(l, p) => `${l}${p?.[0]?.payload?.incompleto ? " · incompleto" : ""}`} /><Legend />
            <Bar dataKey="Faturamento" fill="var(--chart-1)" radius={[4, 4, 0, 0]} /><Bar dataKey="Despesas" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
            <Line dataKey="Resultado" stroke="var(--chart-2)" strokeWidth={2} connectNulls={false} /></ComposedChart>}
        </ResponsiveContainer></div>
        {!personal && <p className="mt-2 text-xs text-muted-foreground">* mês incompleto (em andamento ou com movimentações pendentes de revisão).</p>}
      </article>
    </div>

    {!personal && <BankBatchReview data={d} range={range} reload={()=>q.refetch()}/>}

    <Dialog open={Boolean(list)} onOpenChange={(o) => !o && setList(null)}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{list?.title}</DialogTitle><DialogDescription>{list ? `${list.total} lançamentos${list.total > list.rows.length ? ` · mostrando os ${list.rows.length} maiores` : ""}. ${list.note ?? ""}` : ""}</DialogDescription></DialogHeader>
        <table className="w-full text-sm"><tbody>{list?.rows.map((r) => <tr key={r.id} className="border-b">
          <td className="py-2 pr-3"><p className="font-medium">{r.description || r.counterparty || "Sem descrição"}</p><p className="text-xs text-muted-foreground">{r.day?.split("-").reverse().join("/")} · {KIND_LABEL[r.kind]}{r.category ? ` · ${CATEGORY_LABEL[r.category]}` : ""}{r.status === "pendente" ? " · pendente" : ""}</p></td>
          <td className="whitespace-nowrap py-2 text-right font-medium">{r.direction === "CREDITO" ? "+" : "−"}{brl(Math.abs(r.amountCents ?? 0))}</td></tr>)}</tbody></table>
        {!list?.rows.length && <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>}
      </DialogContent>
    </Dialog>
  </section>;
}
