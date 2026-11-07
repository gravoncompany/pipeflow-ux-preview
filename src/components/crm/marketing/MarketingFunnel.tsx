import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { getMarketingFunnel } from "@/lib/marketing.functions";
import type { DashboardSearch } from "@/lib/dashboard-search";
import { MarketingLayout } from "./MarketingLayout";
import { Empty, LoadState, MarketingPeriodBar, Panel, int, pct, useMarketingPeriod } from "./marketing-ui";

export function MarketingFunnelPage({ search }: { search: DashboardSearch }) {
  const { period } = useMarketingPeriod(search);
  const load = useServerFn(getMarketingFunnel);
  const q = useQuery({
    queryKey: ["marketing-funnel", period?.from, period?.to],
    queryFn: () => { if (!period) throw new Error("Período inválido"); return load({ data: period }); },
    enabled: Boolean(period), staleTime: 60_000,
  });
  if (q.data && "needsAuth" in q.data) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const d = q.data && !("needsAuth" in q.data) ? q.data : null;

  return (
    <MarketingLayout>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold">Funil de Conversão</h1>
          <p className="mt-1 text-sm text-muted-foreground">Etapas reais do CRM: Lead → Contato → Qualificado → Reunião → Fechado</p>
        </div>
        <MarketingPeriodBar search={search} refreshing={q.isFetching} onRefresh={() => void q.refetch()} />
      </header>

      <LoadState loading={q.isLoading} error={q.error} />
      {d && (
        <div className="space-y-4">
          {d.total === 0 && <Empty>Nenhum lead entrou no período selecionado. Amplie o período para ver o funil.</Empty>}
          <Panel title="Etapas do funil" note="Coorte pela data de entrada, medida pelas etapas atuais dos cards">
            <ol className="space-y-2">
              {d.steps.map((s) => (
                <li key={s.key} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-sm font-medium">{s.label}</span>
                  <div className="h-7 min-w-1 rounded-md bg-primary/80" style={{ width: `${Math.max(2, s.ofTotal)}%` }} aria-hidden />
                  <span className="shrink-0 text-sm tabular-nums">
                    {int(s.count)}
                    {s.from && s.hasPreviousBase && <span className="ml-2 text-xs text-muted-foreground">({pct(s.ofPrev)} da etapa anterior)</span>}
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="w-36 shrink-0 font-medium">Leads perdidos</span>
                <span className="tabular-nums">{int(d.lost)}</span>
              </li>
            </ol>
            <div className="mt-4">
              <Link to="/" className="inline-flex items-center gap-1 text-sm text-primary underline">
                Abrir os registros no CRM <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </Panel>
          <Panel title="Conversão por fonte de aquisição" note="Clientes fechados sobre leads gerados no período">
            {d.bySource.length === 0 ? <Empty>Sem dados de origem no período.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground">
                    {["Fonte", "Leads", "Clientes", "Conversão"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {d.bySource.map((r) => (
                      <tr key={r.origin} className="border-b last:border-0">
                        <td className="px-2 py-2 font-medium">{r.origin}</td>
                        <td className="px-2 py-2 tabular-nums">{int(r.leads)}</td>
                        <td className="px-2 py-2 tabular-nums">{int(r.clients)}</td>
                        <td className="px-2 py-2 tabular-nums">{r.leads ? pct(r.conversion) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </MarketingLayout>
  );
}
