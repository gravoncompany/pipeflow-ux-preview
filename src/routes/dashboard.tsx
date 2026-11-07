import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AlarmClock, ArrowRight, CalendarClock, Filter, MessageCircle, RotateCcw } from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { DashboardLayout } from "@/components/crm/dashboard/DashboardLayout";
import { Kpi, PeriodBar, PeriodLabel, int, pct, usePeriod, dateBR } from "@/components/crm/dashboard/dashboard-ui";
import { Button } from "@/components/ui/button";
import { getDashboard, getDashboardToday } from "@/lib/dashboard.functions";
import { parseDashboardSearch } from "@/lib/dashboard-search";
import type { TodayLead } from "@/lib/dashboard-today";
import { GrowthOverview } from '@/components/crm/dashboard/GrowthOverview';
import { DailyBrief } from '@/components/crm/dashboard/DailyBrief';

export const Route = createFileRoute("/dashboard")({
  validateSearch: parseDashboardSearch,
  head: () => ({ meta: [
    { title: "Dashboard · Visão geral — PipeFlow CRM" },
    { name: "description", content: "Receita recorrente contratada, retenção de clientes e expansão da Gravon Company com dados reais." },
    { property: "og:title", content: "Dashboard · Visão geral — PipeFlow CRM" },
    { property: "og:description", content: "MRR, ARR, clientes ativos, retenção e expansão contratada; atividades comerciais preservadas." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: OverviewPage,
});

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) === new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return sameDay ? `hoje, ${time(iso)}` : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const LIMIT = 6;

function TodayGroup({ title, icon, count, empty, children, tone }: { title: string; icon: ReactNode; count: number; empty: string; children: ReactNode; tone?: "alert" }) {
  return <div className="flex min-w-0 flex-col rounded-xl border bg-card shadow-sm">
    <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</p>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone === "alert" && count > 0 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>{count}</span>
    </div>
    {count === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground">{empty}</p> : <ul className="divide-y">{children}</ul>}
  </div>;
}

function LeadRow({ lead, meta, alert }: { lead: TodayLead; meta: string; alert?: string }) {
  return <li>
    <Link to="/" search={{ lead: lead.id }} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/60" aria-label={`Abrir card de ${lead.name}`}>
      <span className="min-w-0">
        <span className="block truncate font-medium">{lead.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{[lead.company, lead.pipelineName].filter(Boolean).join(" · ")}</span>
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
        {alert && <span className="mt-1 inline-block rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">{alert}</span>}
      </span>
      <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
    </Link>
  </li>;
}

function More({ total }: { total: number }) {
  return total > LIMIT ? <li className="px-4 py-2 text-xs text-muted-foreground">+ {total - LIMIT} na lista completa do Pipeline</li> : null;
}

function OverviewPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard" });
  const [unlocked, setUnlocked] = useState(true);
  const { today, period, preset } = usePeriod(search);
  const loadToday = useServerFn(getDashboardToday);
  const load = useServerFn(getDashboard);
  const t = useQuery({ queryKey: ["dashboard-today"], queryFn: () => loadToday(), staleTime: 60_000 });
  const q = useQuery({ queryKey: ["dashboard", period?.from, period?.to], queryFn: () => { if (!period) throw new Error('Período inválido'); return load({ data: period }); }, enabled: Boolean(period), staleTime: 60_000 });

  if (!unlocked || t.data?.needsAuth || q.data?.needsAuth) return <CrmAuthGate onUnlock={(a) => { if (a.level === "full") { setUnlocked(true); void t.refetch(); void q.refetch(); } else setUnlocked(false); }} />;
  const day = t.data && !t.data.needsAuth ? t.data.data : null;
  const c = q.data && !q.data.needsAuth ? q.data.data.commercial : null;

  return <DashboardLayout>
    <main className="min-w-0 flex-1 space-y-8 px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 md:pr-28">
        <div><h1 className="text-2xl font-bold md:text-3xl">Visão geral</h1><p className="mt-1 text-sm text-muted-foreground">Gravon Company · Crescimento e carteira de clientes</p></div>
      </header>

      <DailyBrief awaiting={day ? day.awaiting.length : null} overdueReturns={day ? day.overdue.length : null} />

      <GrowthOverview onNeedsAuth={() => setUnlocked(false)} />

      <section className="space-y-3" aria-labelledby="hoje">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="hoje" className="text-lg font-semibold">Atividades Comerciais{day ? <span className="ml-2 text-sm font-normal text-muted-foreground">{dateBR(day.today)}</span> : null}</h2>
          <p className="text-xs text-muted-foreground">Sempre mostra o dia atual, independentemente do período abaixo.</p>
        </div>
        {t.isError && <p role="alert" className="text-sm text-destructive">{t.error instanceof Error ? t.error.message : "Não foi possível carregar a operação de hoje."}</p>}
        {!day ? <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">{t.isFetching ? "Carregando a operação de hoje…" : ""}</p> :
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <TodayGroup title="Aguardando resposta" icon={<MessageCircle className="size-4 text-primary" />} count={day.awaiting.length} empty="Nenhum lead aguardando resposta.">
              {day.awaiting.slice(0, LIMIT).map((l) => <LeadRow key={l.id} lead={l} meta={`Cliente escreveu ${when(l.at)}`} />)}<More total={day.awaiting.length} />
            </TodayGroup>
            <TodayGroup title="Retornos de hoje" icon={<RotateCcw className="size-4 text-primary" />} count={day.returnsToday.length} empty="Nenhum retorno programado para hoje.">
              {day.returnsToday.slice(0, LIMIT).map((l) => <LeadRow key={l.id} lead={l} meta={l.detail} />)}<More total={day.returnsToday.length} />
            </TodayGroup>
            <TodayGroup title="Retornos atrasados" icon={<AlarmClock className="size-4 text-destructive" />} count={day.overdue.length} empty="Nenhum retorno atrasado." tone="alert">
              {day.overdue.slice(0, LIMIT).map((l) => <LeadRow key={l.id} lead={l} meta={`${l.detail} · era para ${dateBR(l.at)}`} alert={`${l.daysLate} dia${l.daysLate > 1 ? "s" : ""} de atraso`} />)}<More total={day.overdue.length} />
            </TodayGroup>
            <TodayGroup title="Reuniões de hoje" icon={<CalendarClock className="size-4 text-primary" />} count={day.meetings.length} empty="Nenhuma reunião marcada para hoje.">
              {day.meetings.slice(0, LIMIT).map((m) => <li key={m.id}>
                <Link to="/agenda" search={{ reuniao: m.id }} className="flex items-start gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/60" aria-label={`Abrir reunião ${m.summary}`}>
                  <span className="w-12 shrink-0 font-semibold tabular-nums text-primary">{time(m.startsAt)}</span>
                  <span className="min-w-0"><span className="block truncate font-medium">{m.summary}</span><span className="block truncate text-xs text-muted-foreground">{m.leadName}</span></span>
                </Link>
              </li>)}
              {day.meetings.length > LIMIT && <li className="px-4 py-2 text-xs text-muted-foreground">+ {day.meetings.length - LIMIT} na Agenda</li>}
            </TodayGroup>
          </div>}
      </section>

      <section className="space-y-3" aria-labelledby="indicadores">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1"><h2 id="indicadores" className="text-lg font-semibold">Indicadores do período</h2><PeriodLabel period={period} invalid={preset === "custom" && Boolean(today) && !period} /></div>
          <PeriodBar search={search} today={today} onChange={(next) => void navigate({ search: next, replace: true })} onRefresh={() => { void q.refetch(); void t.refetch(); }} refreshing={q.isFetching || t.isFetching} />
        </div>
        {q.isError && <p role="alert" className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Não foi possível carregar os indicadores."}</p>}
        {!c ? <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">{q.isFetching || !period ? "Carregando indicadores…" : ""}</p> :
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi title="Leads recebidos" m={c.received} format={int} />
            <Kpi title="Leads qualificados" m={c.qualified} format={int} />
            <Kpi title="Vendas fechadas" m={c.sales} format={int} />
            <Kpi title="Taxa de conversão" m={c.conversion} format={pct} />
          </div>}
        <Button asChild variant="outline"><Link to="/dashboard/insights" search={{ ...search, aba: "funis" }}><Filter />Ver desempenho por funil<ArrowRight /></Link></Button>
      </section>
    </main>
  </DashboardLayout>;
}
