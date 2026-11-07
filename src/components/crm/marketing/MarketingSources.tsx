import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { getMarketingSources } from "@/lib/marketing.functions";
import type { DashboardSearch } from "@/lib/dashboard-search";
import { MarketingLayout } from "./MarketingLayout";
import { LoadState, MarketingPeriodBar, Panel, brl, int, pct, useMarketingPeriod } from "./marketing-ui";

const axis = { tick: { fill: "var(--muted-foreground)", fontSize: 11 }, axisLine: false, tickLine: false } as const;

export function MarketingSourcesPage({ search }: { search: DashboardSearch }) {
  const { period } = useMarketingPeriod(search);
  const load = useServerFn(getMarketingSources);
  const q = useQuery({
    queryKey: ["marketing-sources", period?.from, period?.to],
    queryFn: () => { if (!period) throw new Error("Período inválido"); return load({ data: period }); },
    enabled: Boolean(period), staleTime: 60_000,
  });
  if (q.data && "needsAuth" in q.data) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const rows = q.data && !("needsAuth" in q.data) ? q.data : null;

  return (
    <MarketingLayout>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold">Fontes de Aquisição</h1>
          <p className="mt-1 text-sm text-muted-foreground">Origem dos leads pelos parâmetros UTM e identificadores preservados</p>
        </div>
        <MarketingPeriodBar search={search} refreshing={q.isFetching} onRefresh={() => void q.refetch()} />
      </header>

      <LoadState loading={q.isLoading} error={q.error} />
      {rows && (
        <div className="space-y-4">
          <Panel title="Leads por fonte" note="Quantos leads cada origem gerou, qualificou, levou a reunião e converteu em cliente">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  {["Fonte", "Leads", "Qualificados", "Reuniões", "Clientes", "Conversão", "Receita confirmada"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.origin} className="border-b last:border-0">
                      <td className="px-2 py-2 font-medium">{r.origin}</td>
                      <td className="px-2 py-2 tabular-nums">{int(r.leads)}</td>
                      <td className="px-2 py-2 tabular-nums">{int(r.qualified)}</td>
                      <td className="px-2 py-2 tabular-nums">{int(r.meetings)}</td>
                      <td className="px-2 py-2 tabular-nums">{int(r.clients)}</td>
                      <td className="px-2 py-2 tabular-nums">{r.leads ? pct((r.clients / r.leads) * 100) : "—"}</td>
                      <td className="px-2 py-2 tabular-nums">{r.revenue > 0 ? brl(r.revenue) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Leads sem origem determinada ficam em “Não identificada” — nunca são atribuídos automaticamente a uma campanha.
            </p>
          </Panel>
          <Panel title="Comparativo visual">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={rows.map((r) => ({ fonte: r.origin, leads: r.leads, qualificados: r.qualified, clientes: r.clients }))} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="fonte" {...axis} interval={0} angle={-20} textAnchor="end" height={70} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="leads" name="Leads" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="qualificados" name="Qualificados" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="clientes" name="Clientes" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      )}
    </MarketingLayout>
  );
}
