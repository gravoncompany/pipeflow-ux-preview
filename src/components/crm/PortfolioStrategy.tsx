import { Fragment, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PipeflowSymbol } from "@/components/brand/PipeflowLogo";
import { CsSelect } from "./ClientSuccessManagement";
import { analyzeCsPortfolio } from "@/lib/cs-portfolio-strategy.functions";
import { portfolioStrategy, PROFITABILITY, RECOMMENDATION, RELATIONSHIP_VIEW, type StrategyInput } from "@/lib/cs-portfolio-strategy";
import { currency } from "@/lib/revenue";
import type { getCsOverview } from "@/lib/customer-success.functions";

type Row = Awaited<ReturnType<typeof getCsOverview>>["clients"][number];
const recTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = { manter: "secondary", expandir: "default", renegociar: "outline", avaliar_encerramento: "destructive" };

export function PortfolioStrategy({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  const inputs: StrategyInput[] = rows.filter(c => c.accountStatus !== "encerrado").map(c => ({ id: c.id, name: c.trade_name, mrrCents: Math.round(c.mrrCents), overdueCents: c.finance.overdueCents, confirmedCents: c.finance.confirmedCents, health: (c.health ?? null) as StrategyInput["health"], commercialStatus: c.management.commercialStatus, strategic: c.management.strategic ?? null }));
  const p = portfolioStrategy(inputs);
  const [ticket, setTicket] = useState("todos"), [profit, setProfit] = useState("todos"), [rel, setRel] = useState("todos"), [rec, setRec] = useState("todos");
  const [open, setOpen] = useState<string | null>(null);
  const analyze = useServerFn(analyzeCsPortfolio);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [ai, setAi] = useState<Awaited<ReturnType<typeof analyzeCsPortfolio>> | null>(null);
  const visible = p.rows.filter(r =>
    (ticket === "todos" || (ticket === "sem" ? r.ticketVsAvg === null : ticket === "acima" ? (r.ticketVsAvg ?? -1) >= 100 : r.ticketVsAvg !== null && r.ticketVsAvg < 100)) &&
    (profit === "todos" || (r.profitability ?? "nao_calculada") === profit) &&
    (rel === "todos" || (r.relationship ?? "sem_avaliacao") === rel) &&
    (rec === "todos" || (r.recommendation ?? "insuficiente") === rec)).sort((a, b) => b.mrrCents - a.mrrCents);
  const cards = [
    { label: "Potencial de expansão", g: p.summary.expansion }, { label: "Precisam de renegociação", g: p.summary.renegotiate },
    { label: "Relacionamento saudável", g: p.summary.healthy }, { label: "Baixa rentabilidade identificada", g: p.summary.lowProfit },
  ];
  async function run() { if (busy) return; setBusy(true); setError(""); try { setAi(await analyze()); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível analisar."); } finally { setBusy(false); } }
  return <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="portfolio-strategy">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="portfolio-strategy" className="flex items-center gap-2 font-semibold"><Compass className="size-5 text-primary" />Análise estratégica da carteira</h2><p className="mt-1 text-xs text-muted-foreground">Ticket médio da carteira: {p.avgTicketCents === null ? "sem receita recorrente registrada" : currency(p.avgTicketCents / 100)} · recomendações são sugestões; nada é alterado ou encerrado automaticamente.</p></div>
      <Button variant="outline" disabled={busy} onClick={() => void run()}><PipeflowSymbol className="size-4" alt="" />{busy ? "Analisando…" : "Resumo da Pipeflow IA"}</Button></header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(c => <div key={c.label} className="border-l-2 border-primary/30 py-1 pl-3"><p className="text-xs text-muted-foreground">{c.label}</p><p className="text-xl font-semibold">{c.g.count}</p><p className="text-xs text-muted-foreground">{currency(c.g.mrrCents / 100)}/mês</p></div>)}</div>
    {p.summary.insufficient.count > 0 && <p className="text-xs text-muted-foreground">{p.summary.insufficient.count} cliente(s) sem dados suficientes para recomendação ({currency(p.summary.insufficient.mrrCents / 100)}/mês). Registre a avaliação do gestor e o custo direto na ficha.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {ai && <div className="space-y-2 border-l-2 border-primary pl-3 text-sm"><p>{ai.summary}</p><ol className="list-decimal space-y-1 pl-5">{ai.priorities.map((x, i) => <li key={i}><span className="font-medium">{x.title}:</span> {x.detail}</li>)}</ol></div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <CsSelect label="Ticket médio" value={ticket} onChange={setTicket} options={{ todos: "Todos", acima: "Acima ou igual ao médio", abaixo: "Abaixo do médio", sem: "Sem receita registrada" }} />
      <CsSelect label="Rentabilidade" value={profit} onChange={setProfit} options={{ todos: "Todas", ...PROFITABILITY, nao_calculada: "Não calculada" }} />
      <CsSelect label="Relacionamento" value={rel} onChange={setRel} options={{ todos: "Todos", ...RELATIONSHIP_VIEW, sem_avaliacao: "Sem avaliação" }} />
      <CsSelect label="Recomendação" value={rec} onChange={setRec} options={{ todos: "Todas", ...RECOMMENDATION, insuficiente: "Dados insuficientes" }} />
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground">{["Cliente", "Receita mensal", "Rentabilidade", "Relacionamento", "Recomendação", ""].map(h => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{visible.map(r => <Fragment key={r.id}>
        <tr className="border-b align-top"><td className="px-2 py-2 font-medium"><button type="button" className="text-left text-primary" onClick={() => onOpen(r.id)}>{r.name}</button></td>
          <td className="px-2 py-2 tabular-nums">{r.mrrCents > 0 ? currency(r.mrrCents / 100) : "Não registrada"}{r.ticketVsAvg !== null && <p className="text-xs text-muted-foreground">{Math.round(r.ticketVsAvg)}% do ticket médio</p>}</td>
          <td className="px-2 py-2">{r.profitability ? `${PROFITABILITY[r.profitability]} (${Math.round(r.marginPct!)}%)` : <span className="text-xs text-muted-foreground">Rentabilidade não calculada — dados insuficientes</span>}</td>
          <td className="px-2 py-2">{r.relationship ? RELATIONSHIP_VIEW[r.relationship] : <span className="text-xs text-muted-foreground">Sem avaliação</span>}</td>
          <td className="px-2 py-2">{r.recommendation ? <Badge variant={recTone[r.recommendation]}>{RECOMMENDATION[r.recommendation]}</Badge> : <span className="text-xs text-muted-foreground">Dados insuficientes</span>}{r.recommendation === "avaliar_encerramento" && <p className="mt-1 text-xs text-muted-foreground">Exige avaliação humana</p>}</td>
          <td className="px-2 py-2"><Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Ocultar" : "Justificativa"}</Button></td></tr>
        {open === r.id && <tr className="border-b bg-muted/40"><td colSpan={6} className="px-4 py-2"><ul className="list-disc space-y-1 pl-5 text-xs">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul></td></tr>}
      </Fragment>)}</tbody></table>
      {!visible.length && <p className="py-4 text-sm text-muted-foreground">Nenhum cliente nesses filtros.</p>}</div>
  </section>;
}
