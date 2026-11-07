import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getMarketingCampaigns } from "@/lib/marketing.functions";
import type { DashboardSearch } from "@/lib/dashboard-search";
import { MarketingLayout } from "./MarketingLayout";
import { Empty, LoadState, MarketingPeriodBar, Panel, brl, int, pct, useMarketingPeriod } from "./marketing-ui";

const META_STATUS: Record<string, string> = { ENABLED: "Ativa", PAUSED: "Pausada", ARCHIVED: "Arquivada" };

export function MarketingCampaignsPage({ search }: { search: DashboardSearch }) {
  const { period } = useMarketingPeriod(search);
  const [platform, setPlatform] = useState("all");
  const [campaign, setCampaign] = useState("");
  const load = useServerFn(getMarketingCampaigns);
  const q = useQuery({
    queryKey: ["marketing-campaigns", period?.from, period?.to],
    queryFn: () => { if (!period) throw new Error("Período inválido"); return load({ data: period }); },
    enabled: Boolean(period), staleTime: 60_000,
  });
  if (q.data && "needsAuth" in q.data) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const d = q.data && !("needsAuth" in q.data) ? q.data : null;

  const metaRows = (d?.meta ?? []).flatMap((a) => a.rows.map((r) => ({ ...r, account: a.account, error: a.error })));
  const googleRows = (d?.google ?? []).flatMap((a) => a.rows.map((r) => ({ ...r, account: a.account, currency: a.currency, error: a.error })));
  const names = [...new Set([...metaRows.map((r) => r.name), ...googleRows.map((r) => r.name)])].sort();
  const match = (name: string) => !campaign || name === campaign;
  const metaFiltered = metaRows.filter((r) => match(r.name));
  const googleFiltered = googleRows.filter((r) => match(r.name));
  const errors = [...new Set([...(d?.meta ?? []).map((a) => a.error), ...(d?.google ?? []).map((a) => a.error)].filter(Boolean))] as string[];

  return (
    <MarketingLayout>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="mt-1 text-sm text-muted-foreground">Desempenho das campanhas de Google Ads e Meta Ads</p>
        </div>
        <MarketingPeriodBar search={search} refreshing={q.isFetching} onRefresh={() => void q.refetch()} />
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="w-44 bg-card" aria-label="Plataforma"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as plataformas</SelectItem>
            <SelectItem value="google">Google Ads</SelectItem>
            <SelectItem value="meta">Meta Ads</SelectItem>
          </SelectContent>
        </Select>
        <Select value={campaign || "all"} onValueChange={(v) => setCampaign(v === "all" ? "" : v)}>
          <SelectTrigger className="w-64 bg-card" aria-label="Campanha"><SelectValue placeholder="Todas as campanhas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as campanhas</SelectItem>
            {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <LoadState loading={q.isLoading} error={q.error} />
      {d && d.configured === 0 && (
        <Empty>Nenhuma conta de anúncios habilitada. Habilite contas na <Link to="/marketing" className="text-primary underline">Visão Geral</Link> ou conecte uma nova em <Link to="/configuracoes/integracoes/meta-ads" className="text-primary underline">Integrações</Link>.</Empty>
      )}
      {errors.map((e) => <p key={e} role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{e}</p>)}

      {d && (platform === "all" || platform === "google") && (
        <Panel title="Google Ads" note="Orçamento diário, investimento e conversões do período">
          {googleFiltered.length === 0 ? <Empty>{d.google.length === 0 ? "Nenhuma conta Google habilitada no Marketing." : "Nenhuma campanha com dados no período."}</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  {["Campanha", "Conta", "Status", "Orçamento/dia", "Investimento", "Impressões", "Cliques", "CTR", "CPC médio", "Conversões", "Custo/conversão"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {googleFiltered.map((r) => (
                    <tr key={`${r.account}:${r.id}`} className="border-b last:border-0">
                      <td className="max-w-56 truncate px-2 py-2 font-medium">{r.name}</td>
                      <td className="max-w-40 truncate px-2 py-2 text-muted-foreground">{r.account}</td>
                      <td className="px-2 py-2">{META_STATUS[r.status] ?? r.status}</td>
                      <td className="px-2 py-2 tabular-nums">{r.budget !== null ? brl(r.budget) : "—"}</td>
                      <td className="px-2 py-2 tabular-nums">{brl(r.spend)}</td>
                      <td className="px-2 py-2 tabular-nums">{int(r.impressions)}</td>
                      <td className="px-2 py-2 tabular-nums">{int(r.clicks)}</td>
                      <td className="px-2 py-2 tabular-nums">{r.ctr !== null ? pct(r.ctr) : "—"}</td>
                      <td className="px-2 py-2 tabular-nums">{r.cpc !== null ? brl(r.cpc) : "—"}</td>
                      <td className="px-2 py-2 tabular-nums">{int(r.conversions)}</td>
                      <td className="px-2 py-2 tabular-nums">{r.costPerConversion !== null ? brl(r.costPerConversion) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {d && (platform === "all" || platform === "meta") && (
        <div className="mt-4">
          <Panel title="Meta Ads" note="Resultados conforme o objetivo de cada campanha (conversas, leads etc.)">
            {metaFiltered.length === 0 ? <Empty>{d.meta.length === 0 ? "Nenhuma conta Meta habilitada no Marketing." : "Nenhuma campanha com dados no período."}</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground">
                    {["Campanha", "Conta", "Investimento", "Alcance", "Impressões", "Cliques no link", "CTR", "CPC", "Conversas", "Leads", "Custo/resultado"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {metaFiltered.map((r, i) => {
                      const results = (r.conversations ?? 0) + (r.leads ?? 0);
                      return (
                        <tr key={`${r.account}:${i}`} className="border-b last:border-0">
                          <td className="max-w-56 truncate px-2 py-2 font-medium">{r.name}</td>
                          <td className="max-w-40 truncate px-2 py-2 text-muted-foreground">{r.account}</td>
                          <td className="px-2 py-2 tabular-nums">{brl(r.spend)}</td>
                          <td className="px-2 py-2 tabular-nums">{int(r.reach)}</td>
                          <td className="px-2 py-2 tabular-nums">{int(r.impressions)}</td>
                          <td className="px-2 py-2 tabular-nums">{int(r.linkClicks)}</td>
                          <td className="px-2 py-2 tabular-nums">{r.impressions ? pct((r.linkClicks / r.impressions) * 100) : "—"}</td>
                          <td className="px-2 py-2 tabular-nums">{r.linkClicks ? brl(r.spend / r.linkClicks) : "—"}</td>
                          <td className="px-2 py-2 tabular-nums">{r.conversations !== null ? int(r.conversations) : "—"}</td>
                          <td className="px-2 py-2 tabular-nums">{r.leads !== null ? int(r.leads) : "—"}</td>
                          <td className="px-2 py-2 tabular-nums">{results ? brl(r.spend / results) : "—"}</td>
                        </tr>
                      );
                    })}
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
