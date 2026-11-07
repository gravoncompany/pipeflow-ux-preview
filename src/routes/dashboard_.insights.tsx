import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { Info, Sparkles } from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { DashboardLayout } from "@/components/crm/dashboard/DashboardLayout";
import { C, ChartCard, Kpi, PeriodBar, PeriodLabel, Section, axis, brl, buildCharts, int, pct, usePeriod } from "@/components/crm/dashboard/dashboard-ui";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { analyzeDashboard, getDashboard, getOutboundChannels } from "@/lib/dashboard.functions";
import { INSIGHT_TABS, parseDashboardSearch, type DashboardSearch, type InsightTab } from "@/lib/dashboard-search";
import type { Granularity } from "@/lib/dashboard";

export const Route = createFileRoute("/dashboard_/insights")({
  validateSearch: (s: Record<string, unknown>): DashboardSearch & { aba?: InsightTab } => ({
    ...parseDashboardSearch(s),
    aba: INSIGHT_TABS.includes(s.aba as InsightTab) ? (s.aba as InsightTab) : undefined,
  }),
  head: () => ({ meta: [
    { title: "Dashboard · Insights — PipeFlow CRM" },
    { name: "description", content: "Funis e evolução comercial, Prospecção Outbound e desempenho da Pipeflow IA no período escolhido." },
    { property: "og:title", content: "Dashboard · Insights — PipeFlow CRM" },
    { property: "og:description", content: "Uma análise por vez, com dados reais do Pipeflow." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: InsightsPage,
});

const TAB_LABEL: Record<InsightTab, string> = { funis: "Funis e evolução comercial", outbound: "Prospecção Outbound", ia: "Desempenho da Pipeflow IA" };

function InsightsPage() {
  const { aba, ...search } = Route.useSearch();
  const tab: InsightTab = aba ?? "funis";
  const navigate = useNavigate({ from: "/dashboard/insights" });
  const [unlocked, setUnlocked] = useState(true);
  const [gran, setGran] = useState<Granularity>("day");
  const { today, period, preset } = usePeriod(search);
  const load = useServerFn(getDashboard);
  const analyze = useServerFn(analyzeDashboard);
  const q = useQuery({ queryKey: ["dashboard", period?.from, period?.to], queryFn: () => load({ data: period! }), enabled: Boolean(period), staleTime: 60_000 });
  const ai = useMutation({ mutationFn: () => analyze({ data: period! }) });
  useEffect(() => { ai.reset(); }, [period?.from, period?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = q.data && !q.data.needsAuth ? q.data.data : null;
  const charts = useMemo(() => (d && period ? buildCharts(d, period, gran) : null), [d, period, gran]);

  if (!unlocked || q.data?.needsAuth) return <CrmAuthGate onUnlock={(a) => { if (a.level === "full") { setUnlocked(true); void q.refetch(); } else setUnlocked(false); }} />;

  return <DashboardLayout>
    <main className="min-w-0 flex-1 space-y-6 px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 md:pr-28">
        <div className="space-y-1"><h1 className="text-2xl font-bold md:text-3xl">Insights</h1><PeriodLabel period={period} invalid={preset === "custom" && Boolean(today) && !period} /></div>
        <PeriodBar search={search} today={today} onChange={(next) => void navigate({ search: { ...next, aba }, replace: true })} onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
          <div className="flex rounded-lg border bg-card p-0.5" role="group" aria-label="Agrupar gráficos por">
            {(["day", "week", "month"] as const).map((g) => <Button key={g} size="sm" variant={gran === g ? "default" : "ghost"} onClick={() => setGran(g)}>{g === "day" ? "Dia" : g === "week" ? "Semana" : "Mês"}</Button>)}
          </div>
        </PeriodBar>
      </header>

      <Tabs value={tab} onValueChange={(v) => void navigate({ search: { ...search, aba: v as InsightTab }, replace: true })}>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList className="h-auto">
            {INSIGHT_TABS.map((t) => <TabsTrigger key={t} value={t} className="px-3 py-1.5">{TAB_LABEL[t]}</TabsTrigger>)}
          </TabsList>
        </div>
      </Tabs>

      {q.isError && <p role="alert" className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Não foi possível carregar os Insights."}</p>}
      {!d || !charts ? <p className="py-16 text-center text-muted-foreground">{q.isFetching || !period ? "Carregando análise…" : ""}</p> : <>
        {tab === "funis" && <div className="space-y-8">
          <Section title="Comercial" note="Leads pela data de entrada e etapa atual; vendas pela data de fechamento.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
              <Kpi title="Leads recebidos" m={d.commercial.received} format={int} />
              <Kpi title="Leads qualificados" m={d.commercial.qualified} format={int} />
              <Kpi title="Em negociação" m={d.commercial.negotiation} format={int} />
              <Kpi title="Vendas fechadas" m={d.commercial.sales} format={int} />
              <Kpi title="Taxa de conversão" m={d.commercial.conversion} format={pct} />
              <Kpi title="Custo por lead" m={d.commercial.cpl} format={brl} />
              <Kpi title="Custo por aquisição" m={d.commercial.cac} format={brl} />
            </div>
          </Section>
          <Section title="Desempenho por funil">
            <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Funil</th><th className="px-4 py-2 text-right font-medium">Leads</th><th className="px-4 py-2 text-right font-medium">Oportunidades</th><th className="px-4 py-2 text-right font-medium">Conversões</th><th className="px-4 py-2 text-right font-medium">Vendas</th><th className="px-4 py-2 text-right font-medium">Conversão</th></tr></thead>
                <tbody className="divide-y">{d.funnels.map((f) => <tr key={f.id ?? "main"}><td className="px-4 py-2 font-medium">{f.name}</td><td className="px-4 py-2 text-right tabular-nums">{int(f.leads)}</td><td className="px-4 py-2 text-right tabular-nums">{int(f.opportunities)}</td><td className="px-4 py-2 text-right tabular-nums">{int(f.conversions)}</td><td className="px-4 py-2 text-right tabular-nums">{int(f.sales)}</td><td className="px-4 py-2 text-right tabular-nums">{f.leads ? pct((f.conversions / f.leads) * 100) : "—"}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ChartCard title="Evolução comercial" note="Leads recebidos, qualificados e vendas concluídas.">
                <LineChart data={charts.commercial}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="k" {...axis} /><YAxis allowDecimals={false} width={32} {...axis} /><Tooltip /><Legend />
                  <Line type="monotone" dataKey="leads" name="Leads" stroke={C[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="qualificados" name="Qualificados" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="vendas" name="Vendas" stroke={C[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ChartCard>
              <ChartCard title="Comparação entre funis" note="Leads e oportunidades pela entrada; vendas pelo fechamento.">
                <BarChart data={d.funnels.map((x) => ({ ...x, k: x.name }))}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="k" {...axis} /><YAxis allowDecimals={false} width={32} {...axis} /><Tooltip /><Legend />
                  <Bar dataKey="leads" name="Leads" fill={C[0]} isAnimationActive={false} /><Bar dataKey="opportunities" name="Oportunidades" fill={C[1]} isAnimationActive={false} />
                  <Bar dataKey="conversions" name="Conversões" fill={C[3]} isAnimationActive={false} /><Bar dataKey="sales" name="Vendas" fill={C[2]} isAnimationActive={false} />
                </BarChart>
              </ChartCard>
              <div className="xl:col-span-2"><ChartCard title="Conversões por origem" note="Somente origens registradas no card; nada é deduzido.">
                <BarChart data={d.origins.map((o) => ({ ...o, k: o.name }))}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="k" {...axis} /><YAxis allowDecimals={false} width={36} {...axis} /><Tooltip /><Legend />
                  <Bar dataKey="leads" name="Leads" fill={C[0]} isAnimationActive={false} /><Bar dataKey="qualified" name="Qualificados" fill={C[1]} isAnimationActive={false} /><Bar dataKey="sales" name="Vendas" fill={C[2]} isAnimationActive={false} />
                </BarChart>
              </ChartCard></div>
            </div>
          </Section>
          <Section title="Resultado financeiro do período" note="Valor de oportunidades nunca conta como faturamento.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
              <Kpi title="Faturamento confirmado" m={d.financial.revenue} format={brl} />
              <Kpi title="Investimento em marketing" m={d.financial.investment} format={brl} />
              <Kpi title="Despesas registradas" m={d.financial.expenses} format={brl} />
              <Kpi title="Resultado financeiro" m={d.financial.result} format={brl} />
              <Kpi title="ROI de Marketing (aquisição)" m={d.financial.roi} format={pct} />
              <Kpi title="Ticket médio" m={d.financial.ticket} format={brl} />
            </div>
            <ChartCard title="Investimento e faturamento" note={charts.financeMonthly ? "A fonte disponível é mensal; agrupado por mês." : "Períodos sem dado aparecem vazios, não como zero."}>
              <ComposedChart data={charts.finance}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="k" {...axis} /><YAxis width={64} tickFormatter={(v: number) => brl(v)} {...axis} /><Tooltip formatter={(v) => (typeof v === "number" ? brl(v) : "Sem dado")} /><Legend />
                <Bar dataKey="investimento" name="Investimento" fill={C[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="faturamento" name="Faturamento" fill={C[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line dataKey="resultado" name="Resultado" stroke={C[2]} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
              </ComposedChart>
            </ChartCard>
          </Section>
        </div>}

        {tab === "outbound" && <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
            <Kpi title="Empresas prospectadas" m={d.outbound.companies} format={int} />
            <Kpi title="Contatos realizados" m={d.outbound.contacts} format={int} />
            <Kpi title="E-mails enviados" m={d.outbound.emails} format={int} />
            <Kpi title="Respostas recebidas" m={d.outbound.replies} format={int} />
            <Kpi title="Leads gerados" m={d.outbound.leads} format={int} />
            <Kpi title="Oportunidades qualificadas" m={d.outbound.opportunities} format={int} />
            <Kpi title="Clientes conquistados" m={d.outbound.customers} format={int} />
          </div>
          <ChartCard title="Evolução da prospecção" note={d.series.outboundId ? "Empresas cadastradas, contatos e oportunidades do funil Outbound." : "Funil Outbound não encontrado."}>
            <LineChart data={charts.outbound}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="k" {...axis} /><YAxis allowDecimals={false} width={32} {...axis} /><Tooltip /><Legend />
              <Line dataKey="empresas" name="Empresas" stroke={C[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="contatos" name="Contatos" stroke={C[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="oportunidades" name="Oportunidades" stroke={C[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartCard>
          {period && <OutboundByChannel period={period} />}
        </div>}

        {tab === "ia" && <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Kpi title="Conversas analisadas" m={d.ai.analyzed} format={int} />
            <Kpi title="Atendimentos automáticos" m={d.ai.automatic} format={int} />
            <Kpi title="Qualificados pela IA" m={d.ai.qualified} format={int} />
            <Kpi title="Transferências para humano" m={d.ai.human} format={int} />
            <Kpi title="Conversas sem resposta" m={d.ai.unanswered} format={int} />
            <Kpi title="Oportunidades identificadas" m={d.ai.opportunities} format={int} />
          </div>
          <Section title="Análise inteligente do período" note="Só sugestões: nada é alterado nos funis ou campanhas.">
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Info className="size-4" />Compara o período escolhido com o período anterior de mesmo tamanho.</p>
                <Button onClick={() => ai.mutate()} disabled={ai.isPending || !period}><Sparkles />{ai.isPending ? "Analisando…" : "Atualizar análise com IA"}</Button>
              </div>
              {ai.isError && <p role="alert" className="mt-3 text-sm text-destructive">{ai.error instanceof Error ? ai.error.message : "Não foi possível gerar a análise."}</p>}
              {ai.data && <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2"><p className="text-sm font-semibold">Resumo do período</p><p className="mt-1 text-sm">{ai.data.analysis.summary}</p></div>
                {([["Pontos positivos", ai.data.analysis.positives], ["Pontos de atenção", ai.data.analysis.attention], ["Oportunidades", ai.data.analysis.opportunities], ["Limitações dos dados", ai.data.analysis.limitations]] as const).map(([t, items]) =>
                  <div key={t}><p className="text-sm font-semibold">{t}</p>{items.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{items.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">Nada a destacar.</p>}</div>)}
                <div className="md:col-span-2"><p className="text-sm font-semibold">Próximas ações recomendadas</p>
                  <ol className="mt-1 space-y-1 text-sm">{ai.data.analysis.nextActions.map((a, i) => <li key={i} className="flex gap-2"><span className={`shrink-0 rounded px-1.5 text-[11px] font-semibold ${a.priority === "alta" ? "bg-primary text-primary-foreground" : a.priority === "media" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{a.priority === "media" ? "média" : a.priority}</span>{a.action}</li>)}</ol>
                </div>
                <p className="text-[11px] text-muted-foreground md:col-span-2">Gerada em {new Date(ai.data.generatedAt).toLocaleString("pt-BR")}.</p>
              </div>}
            </div>
          </Section>
        </div>}
      </>}
    </main>
  </DashboardLayout>;
}

function OutboundByChannel({ period }: { period: { from: string; to: string } }) {
  const load = useServerFn(getOutboundChannels);
  const q = useQuery({ queryKey: ["dashboard-outbound-channels", period.from, period.to], queryFn: () => load({ data: period }), staleTime: 60_000 });
  const d = q.data && !q.data.needsAuth ? q.data.data : null;
  if (q.isError) return <p role="alert" className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Não foi possível carregar os canais do Outbound."}</p>;
  if (!d) return <p className="py-6 text-center text-sm text-muted-foreground">Carregando canais…</p>;
  if (!d.found) return <p className="text-sm text-muted-foreground">Funil Outbound não encontrado.</p>;
  const f = d.funnel;
  return <div className="space-y-6">
    <Section title="Por canal" note="Eventos pela data em que aconteceram; cada lead conta uma vez por indicador.">
      <Tabs defaultValue="email">
        <TabsList><TabsTrigger value="email" className="px-3 py-1.5">E-mail</TabsTrigger><TabsTrigger value="whatsapp" className="px-3 py-1.5">WhatsApp</TabsTrigger></TabsList>
        <TabsContent value="email" className="mt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Kpi title="Envios" m={d.email.sent} format={int} />
            <Kpi title="Entregas" m={d.email.delivered} format={int} />
            <Kpi title="Aberturas" m={d.email.opened} format={int} />
            <Kpi title="Cliques no diagnóstico" m={d.email.diagnosisClicks} format={int} />
            <Kpi title="Formulários preenchidos" m={d.email.forms} format={int} />
            <Kpi title="Respostas" m={d.email.replies} format={int} />
          </div>
        </TabsContent>
        <TabsContent value="whatsapp" className="mt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
            <Kpi title="Mensagens enviadas" m={d.whatsapp.sent} format={int} />
            <Kpi title="Entregues" m={d.whatsapp.delivered} format={int} />
            <Kpi title="Lidas" m={d.whatsapp.read} format={int} />
            <Kpi title="Respostas" m={d.whatsapp.replies} format={int} />
            <Kpi title="Formulários preenchidos" m={d.whatsapp.forms} format={int} />
          </div>
          {d.ambiguousPhones > 0 && <p className="mt-2 text-xs text-muted-foreground">{d.ambiguousPhones} número(s) aparecem em mais de um card do Outbound e ficaram fora para não misturar conversas.</p>}
        </TabsContent>
      </Tabs>
    </Section>
    <Section title="Funil comercial consolidado" note="Leads que entraram no Outbound no período, pela etapa atual. Cada lead tem um só canal de origem: o primeiro contato registrado.">
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Origem</th><th className="px-4 py-2 text-right font-medium">Leads</th><th className="px-4 py-2 text-right font-medium">Oportunidades qualificadas</th><th className="px-4 py-2 text-right font-medium">Reuniões agendadas</th><th className="px-4 py-2 text-right font-medium">Clientes conquistados</th></tr></thead>
          <tbody className="divide-y">
            {f.byChannel.map((r) => <tr key={r.channel}><td className="px-4 py-2 font-medium">{r.label}</td><td className="px-4 py-2 text-right tabular-nums">{int(r.leads)}</td><td className="px-4 py-2 text-right tabular-nums">{int(r.qualified)}</td><td className="px-4 py-2 text-right tabular-nums">{int(r.meetings)}</td><td className="px-4 py-2 text-right tabular-nums">{int(r.customers)}</td></tr>)}
            <tr className="bg-muted/40 font-semibold"><td className="px-4 py-2">Total (sem duplicar)</td><td className="px-4 py-2 text-right tabular-nums">{int(f.total.leads)}</td><td className="px-4 py-2 text-right tabular-nums">{int(f.total.qualified)}</td><td className="px-4 py-2 text-right tabular-nums">{int(f.total.meetings)}</td><td className="px-4 py-2 text-right tabular-nums">{int(f.total.customers)}</td></tr>
          </tbody>
        </table>
      </div>
    </Section>
  </div>;
}
