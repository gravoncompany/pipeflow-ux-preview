import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw } from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { discoverMarketingAccounts, getMarketingOverview, setMarketingIntegration } from "@/lib/marketing.functions";
import type { DashboardSearch } from "@/lib/dashboard-search";
import { MarketingLayout } from "./MarketingLayout";
import { Empty, LoadState, MarketingPeriodBar, Panel, Stat, brl, int, pct, useMarketingPeriod } from "./marketing-ui";

const axis = { tick: { fill: "var(--muted-foreground)", fontSize: 11 }, axisLine: false, tickLine: false } as const;

/** Contas de anúncios descobertas nas conexões existentes; o usuário escolhe quais alimentam o Marketing. */
function Connections({ onChanged }: { onChanged: () => void }) {
  const discover = useServerFn(discoverMarketingAccounts);
  const save = useServerFn(setMarketingIntegration);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const q = useQuery({ queryKey: ["marketing-accounts"], queryFn: () => discover(), enabled: open, staleTime: 60_000 });
  const d = q.data && !("needsAuth" in q.data) ? q.data : null;

  async function toggle(platform: "meta" | "google", id: string, name: string, active: boolean) {
    setBusy(`${platform}:${id}`);
    try {
      const r = await save({ data: { platform, accountId: id, accountName: name, active } });
      if ("needsAuth" in r) return;
      toast.success(active ? "Conta habilitada no Marketing." : "Conta removida do Marketing.");
      await q.refetch(); onChanged();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  }

  return (
    <Panel title="Contas de anúncios" note="Escolha quais contas das conexões Meta e Google alimentam este módulo. Nada é alterado nas plataformas.">
      {!open ? <Button variant="outline" onClick={() => setOpen(true)}>Gerenciar contas</Button> : (
        <div className="space-y-4">
          {q.isLoading && <p className="text-sm text-muted-foreground">Consultando as conexões…</p>}
          {d && (
            <>
              {d.metaError && <p className="text-sm text-muted-foreground">Meta: {d.metaError} <Link to="/configuracoes/integracoes/meta-ads" className="text-primary underline">Abrir integração</Link></p>}
              {d.googleError && <p className="text-sm text-muted-foreground">Google Ads: {d.googleError} <Link to="/configuracoes/integracoes/google-ads" className="text-primary underline">Abrir integração</Link></p>}
              {([["Meta Ads", "meta", d.meta], ["Google Ads", "google", d.google]] as const).map(([label, platform, accounts]) => (
                <div key={platform}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                  {accounts.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conta encontrada nesta conexão.</p> : (
                    <ul className="divide-y rounded-lg border">
                      {accounts.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate">{a.name || a.id}</span>
                          <Switch aria-label={`Usar ${a.name || a.id} no Marketing`} checked={a.enabled} disabled={busy === `${platform}:${a.id}`}
                            onCheckedChange={(v) => void toggle(platform, a.id, a.name, v)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

export function MarketingOverviewPage({ search }: { search: DashboardSearch }) {
  const { period } = useMarketingPeriod(search);
  const load = useServerFn(getMarketingOverview);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["marketing-overview", period?.from, period?.to],
    queryFn: () => { if (!period) throw new Error("Período inválido"); return load({ data: period }); },
    enabled: Boolean(period), staleTime: 60_000,
  });
  if (q.data && "needsAuth" in q.data) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const d = q.data && !("needsAuth" in q.data) ? q.data : null;

  return (
    <MarketingLayout>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold">Visão Geral de Marketing</h1>
          <p className="mt-1 text-sm text-muted-foreground">Investimento, geração de leads e resultado comercial consolidados</p>
        </div>
        <MarketingPeriodBar search={search} refreshing={q.isFetching} onRefresh={() => void q.refetch()} />
      </header>

      <LoadState loading={q.isLoading} error={q.error} />
      {d && (
        <div className="space-y-6">
          {d.configuredAccounts === 0 && (
            <Empty>Nenhuma conta de anúncios habilitada ainda. Habilite abaixo em “Contas de anúncios” — os indicadores de investimento aparecem assim que uma conta responder. Nenhum dado fictício é exibido.</Empty>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Investimento total" value={brl(d.totalSpend)} hint="Soma das contas habilitadas, sem duplicar plataformas" />
            <Stat label="Google Ads" value={d.google?.available ? brl(d.google.spend) : "—"} hint={d.google?.available ? undefined : d.google?.error ?? "Nenhuma conta Google habilitada"} />
            <Stat label="Meta Ads" value={d.meta?.available ? brl(d.meta.spend) : "—"} hint={d.meta?.available ? undefined : d.meta?.error ?? "Nenhuma conta Meta habilitada"} />
            <Stat label="Impressões · Cliques" value={`${int((d.meta?.impressions ?? 0) + (d.google?.impressions ?? 0))} · ${int((d.meta?.clicks ?? 0) + (d.google?.clicks ?? 0))}`} />
            <Stat label="CPC médio" value={d.totalSpend && (d.meta || d.google) ? (() => { const clicks = (d.meta?.clicks ?? 0) + (d.google?.clicks ?? 0); return clicks ? brl(d.totalSpend / clicks) : "—"; })() : "—"} />
            <Stat label="CTR médio" value={(() => { const imps = (d.meta?.impressions ?? 0) + (d.google?.impressions ?? 0); const clicks = (d.meta?.clicks ?? 0) + (d.google?.clicks ?? 0); return imps ? pct((clicks / imps) * 100) : "—"; })()} />
            <Stat label="Leads gerados" value={int(d.summary.leads)} />
            <Stat label="Custo por lead" value={d.costPerLead !== null ? brl(d.costPerLead) : "—"} hint={d.costPerLead === null ? "Precisa de investimento e leads no período" : undefined} />
            <Stat label="Leads qualificados" value={int(d.summary.qualified)} />
            <Stat label="Custo por qualificado" value={d.costPerQualified !== null ? brl(d.costPerQualified) : "—"} />
            <Stat label="Reuniões agendadas" value={int(d.summary.meetings)} />
            <Stat label="Vendas realizadas" value={int(d.summary.sales)} />
            <Stat label="Receita atribuída" value={d.summary.revenue > 0 ? brl(d.summary.revenue) : "—"}
              hint={d.summary.hasUnconfirmedSaleValue ? "Há vendas sem valor confirmado; receita subestimada" : "Soma dos valores fechados confirmados"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Evolução no período" note="Leads, qualificados e vendas por dia">
              <div className="h-64">
                <ResponsiveContainer>
                  <LineChart data={d.series} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" {...axis} tickFormatter={(v: string) => v.slice(8, 10)} />
                    <YAxis {...axis} allowDecimals={false} />
                    <Tooltip /><Legend />
                    <Line type="monotone" dataKey="leads" name="Leads" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="qualificados" name="Qualificados" stroke="var(--chart-2)" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="vendas" name="Vendas" stroke="var(--chart-3)" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Google Ads × Meta Ads" note="Comparação do período; plataformas sem conta habilitada aparecem zeradas">
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={[
                    { plataforma: "Google Ads", investimento: d.google?.spend ?? 0, cliques: d.google?.clicks ?? 0, resultados: d.google?.results ?? 0 },
                    { plataforma: "Meta Ads", investimento: d.meta?.spend ?? 0, cliques: d.meta?.clicks ?? 0, resultados: d.meta?.results ?? 0 },
                  ]} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="plataforma" {...axis} />
                    <YAxis {...axis} />
                    <Tooltip formatter={(v: number, name: string) => (name === "investimento" ? brl(v) : int(v))} /><Legend />
                    <Bar dataKey="investimento" name="Investimento" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="cliques" name="Cliques" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="resultados" name="Resultados" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <Connections onChanged={() => void qc.invalidateQueries({ queryKey: ["marketing-overview"] })} />
        </div>
      )}
    </MarketingLayout>
  );
}
