import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, AlertTriangle, CircleHelp, ChevronDown, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getPortalAds } from "@/lib/portal-ads.functions";
import { getMetaFunnelAds, linkMetaFunnelCampaign } from "@/lib/meta-funnel-ads.functions";
import { aggregateAds, campaignKey, adsPartial, type AdsView } from "@/lib/portal-ads";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { acquisitionValue, funnelSpendValues } from "./funnel-spend-values";

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
const stamp = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Não disponível";
const platformName = (value: string) => (value === "meta_ads" ? "Meta Ads" : "Google Ads");

function Status({ data, source = "Portal Gravon" }: { data: AdsView | undefined; source?: string }) {
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p>Fonte: {source} · {data?.schedule ?? "Atualização diária às 06:15 de Brasília"}</p>
      <p>Última consulta bem-sucedida do CRM: {stamp(data?.succeededAt ?? null)}</p>
      {data?.error && (
        <p role="alert" className="flex items-start gap-2 text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {data.error}
        </p>
      )}
      {data?.stale && data.payload && (
        <p role="status" className="text-warning">
          Dados desatualizados; exibindo a última consulta válida.
        </p>
      )}
      {data?.payload?.accounts.map((a) => (
        <p key={`${a.platform}:${a.account_id}`}>
          {platformName(a.platform)} · {a.account_name || a.account_id} · {a.currency} ·{" "}
          {a.timezone_name} · Fonte sincronizada: {stamp(a.last_synced_at)} · Cobertura:{" "}
          {a.first_date ?? "indisponível"} a {a.last_date ?? "indisponível"}
          {a.status !== "available" ? " · Sem cobertura confirmada" : ""}
        </p>
      ))}
    </div>
  );
}

function useAds(from: string, to: string, source: "portal" | "meta" = "portal") {
  const read = useServerFn(source === "meta" ? getMetaFunnelAds : getPortalAds);
  const qc = useQueryClient();
  const key = source === "meta" ? "meta-funnel-ads" : "portal-ads";
  const query = useQuery({
    queryKey: [key, from, to],
    queryFn: () => read({ data: { from, to } }),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      const data = await read({ data: { from, to, refresh: true } });
      qc.setQueryData([key, from, to], data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar os gastos.");
    } finally {
      setBusy(false);
    }
  };
  return { query, busy, refresh };
}

export function PortalFunnelSpend({
  from,
  to,
  pipeline,
  options,
  counts,
  cac,
  children,
}: {
  from: string;
  to: string;
  pipeline: string;
  options: { id: string; name: string }[];
  counts: { leads: number; qualified: number; meetings: number };
  cac: {
    newCustomers: number | null;
    pending: number;
    loading: boolean;
    onReview: () => void;
  };
  children: ReactNode;
}) {
  const { query, busy, refresh } = useAds(from, to, "meta");
  const qc = useQueryClient();
  const save = useServerFn(linkMetaFunnelCampaign);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);
  const payload = query.data?.payload ?? null;
  const links = query.data?.links ?? [];
  const { currencies, hasLinks, partial } = funnelSpendValues(payload, links, pipeline, from, to);
  const campaigns = [...new Map((payload?.rows ?? []).map((r) => [campaignKey(r), r])).values()];
  const unlinked = campaigns.filter((c) => !links.some((l) => campaignKey(l) === campaignKey(c)));
  const failure = query.error instanceof Error ? query.error.message : query.data?.error;
  const change = async (c: (typeof campaigns)[number], value: string) => {
    setSaving(campaignKey(c));
    try {
      await save({
        data: {
          account_id: c.account_id,
          campaign_id: c.campaign_id,
          pipeline: value === "none" ? null : value,
        },
      });
      await qc.invalidateQueries({ queryKey: ["meta-funnel-ads"] });
      toast.success("Vínculo salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(null);
    }
  };
  const indicators: {
    label: string;
    n: number | null | undefined;
    cac: boolean;
    subtitle: string;
  }[] = [
    {
      label: "Investimento em tráfego",
      n: undefined,
      cac: false,
      subtitle: "Campanhas vinculadas · API da Meta",
    },
    { label: "Custo por lead", n: counts.leads, cac: false, subtitle: "Investimento por lead novo" },
    {
      label: "Custo por lead qualificado",
      n: counts.qualified,
      cac: false,
      subtitle: "Investimento por qualificado",
    },
    {
      label: "Custo por reunião agendada",
      n: counts.meetings,
      cac: false,
      subtitle: "Investimento por reunião",
    },
    {
      label: "CAC de mídia",
      n: cac.newCustomers,
      cac: true,
      subtitle: "Investimento em anúncios por cliente novo único",
    },
  ];
  const missingReason = query.isPending
    ? "Consultando a Meta…"
    : !payload
      ? "Gastos indisponíveis"
      : !hasLinks
        ? "Associe campanhas para calcular"
        : "Sem gasto informado no período";
  return (
    <>
      <section className="mb-7 space-y-3" aria-label="Investimento e aquisição">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Investimento e aquisição</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Regra dos custos de aquisição"
                >
                  <CircleHelp className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-w-[calc(100vw-2rem)] space-y-2 text-xs" align="start">
                <p>
                  Denominadores: leads que entraram no funil entre as datas selecionadas, inclusive,
                  medidos pelas etapas atuais do CRM — não pela data da venda ou por conversões das
                  plataformas.
                </p>
                <p>
                  Gasto: anúncios das campanhas vinculadas, nas mesmas datas. Valores manuais não
                  são somados; moedas não são misturadas.
                </p>
                <p>
                  CAC de mídia: investimento elegível em anúncios ÷ clientes novos únicos
                  adquiridos no recorte, contados pela data da primeira aquisição confirmada.
                  Renovações e vendas adicionais não entram no denominador.
                </p>
                <p>
                  É um indicador por período, não uma atribuição individual de cada cliente aos
                  anúncios. Não é o CAC total: não inclui todos os custos de marketing e vendas.
                </p>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span role="status" className="text-xs text-muted-foreground">
              {busy || query.isFetching
                ? "Atualizando…"
                : query.data?.succeededAt
                  ? `Consulta válida: ${new Date(query.data.succeededAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                  : "Sem consulta válida"}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || query.isFetching || from > to}
              onClick={() => void refresh()}
            >
              <RefreshCw className={busy ? "animate-spin motion-reduce:animate-none" : ""} />
              Atualizar agora
            </Button>
          </div>
        </div>
        {failure && (
          <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {failure}
          </p>
        )}
        {partial && payload && (
          <p className="text-xs text-warning-foreground">
            Cobertura parcial: os valores consideram somente gastos conhecidos; dias ausentes não
            são zero.
          </p>
        )}
        {query.data?.stale && payload && (
          <p className="text-xs text-warning-foreground">
            Dados desatualizados; exibindo a última consulta válida.
          </p>
        )}
        {unlinked.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">
              {unlinked.length} campanhas sem associação
              {hasLinks ? " · Valores somente das vinculadas." : "."}
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-7 px-0"
              onClick={() => {
                setExpanded(true);
                requestAnimationFrame(() =>
                  sourceRef.current?.scrollIntoView({
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "auto"
                      : "smooth",
                    block: "start",
                  }),
                );
              }}
            >
              <Link2 className="size-3.5" />
              Associar campanhas
            </Button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {indicators.map((i) => (
            <div key={i.label} className="min-w-0 rounded-lg border bg-card p-4">
              <h3 className="min-h-8 text-xs font-medium text-muted-foreground">{i.label}</h3>
              {!currencies.length ? (
                <>
                  <p className="mt-2 text-2xl font-bold">—</p>
                  <p className="mt-1 text-xs text-muted-foreground">{missingReason}</p>
                </>
              ) : (
                currencies.map(({ currency, amount }) => {
                  const result =
                    i.n === undefined
                      ? { state: amount === null ? ("missing" as const) : ("known" as const), value: amount }
                      : i.cac
                        ? acquisitionValue(amount, i.n, { cac: true, pending: cac.pending })
                        : acquisitionValue(amount, i.n);
                  const reason =
                    result.state === "missing"
                      ? "Gasto não informado"
                      : result.state === "pending"
                        ? `${cac.pending} ${cac.pending === 1 ? "fechamento pendente" : "fechamentos pendentes"} de classificação`
                        : result.state === "no-new"
                          ? "Não calculável — nenhum cliente novo no período"
                          : result.state === "unverified"
                            ? cac.loading
                              ? "Carregando classificações…"
                              : "Classificações indisponíveis"
                            : result.state === "zero-denominator"
                              ? "Denominador zero no CRM"
                              : null;
                  return (
                    <div key={currency} className="mt-2">
                      <p
                        className={
                          result.state === "zero-denominator" || result.state === "no-new"
                            ? "text-base font-bold"
                            : "break-words text-2xl font-bold"
                        }
                      >
                        {result.state === "zero-denominator" || result.state === "no-new"
                          ? "Não calculável"
                          : result.value === null
                            ? "—"
                            : money(result.value, currency)}
                      </p>
                      {reason && <p className="mt-1 text-xs text-muted-foreground">{reason}</p>}
                      {result.value !== null && (partial || query.data?.stale) && (
                        <p className="mt-1 text-xs text-warning-foreground">
                          {partial ? "Parcial" : ""}
                          {partial && query.data?.stale ? " · " : ""}
                          {query.data?.stale ? "Desatualizado" : ""}
                        </p>
                      )}
                      {currencies.length > 1 && (
                        <p className="text-xs text-muted-foreground">{currency}</p>
                      )}
                    </div>
                  );
                })
              )}
              <p className="mt-3 text-xs text-muted-foreground">{i.subtitle}</p>
              {i.cac && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-1 h-7 px-0 text-xs"
                  onClick={cac.onReview}
                >
                  Revisar clientes adquiridos
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
      {children}
      <div ref={sourceRef} className="mb-8 scroll-mt-4">
        <Collapsible open={expanded} onOpenChange={setExpanded} className="border-y py-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="h-auto w-full justify-between px-0 text-sm">
              <span>Fonte dos dados e campanhas</span>
              <ChevronDown className={expanded ? "size-4 rotate-180" : "size-4"} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <Status data={query.data} source="API da Meta (conta da Gravon)" />
            {payload?.limitations.map((limitation, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {limitation}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              Vínculo exclusivo pelos IDs de plataforma, conta e campanha. Nenhuma associação pelo
              nome ou atribuição de toda a conta é presumida.
            </p>
            {!campaigns.length && (
              <p className="text-sm text-muted-foreground">
                Nenhuma campanha disponível no período.
              </p>
            )}
            <div className="divide-y">
              {campaigns.map((c) => (
                <div
                  key={campaignKey(c)}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1 basis-56 break-words">
                    <p className="text-sm font-medium">{c.campaign_name || c.campaign_id}</p>
                    <p className="text-xs text-muted-foreground">
                      {platformName(c.platform)} · Conta {c.account_id} · Campanha {c.campaign_id} ·{" "}
                      {c.currency}
                    </p>
                  </div>
                  <Select
                    value={
                      links.find((l) => campaignKey(l) === campaignKey(c))?.pipeline_key ?? "none"
                    }
                    disabled={saving !== null || query.data?.stale}
                    onValueChange={(v) => void change(c, v)}
                  >
                    <SelectTrigger
                      className="w-full sm:w-60"
                      aria-label={`Funil da campanha ${c.campaign_id}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem associação</SelectItem>
                      {options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </>
  );
}

export function PortalFinancialSpend({ year }: { year: number }) {
  const from = `${year}-01-01`,
    to = `${year}-12-31`;
  const { query, busy, refresh } = useAds(from, to);
  const payload = query.data?.payload ?? null;
  const totals = aggregateAds(payload?.rows ?? []);
  const groups = [...new Set(totals.map((t) => `${t.platform}:${t.currency}`))];
  return (
    <section className="border-t py-7" aria-label={`Investimento em tráfego ${year}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Investimento em tráfego {year}</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || query.isFetching}
          onClick={() => void refresh()}
        >
          <RefreshCw className={busy ? "animate-spin motion-reduce:animate-none" : ""} />
          Atualizar agora
        </Button>
      </div>
      <Status data={query.data} />
      {query.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Consulta indisponível."}
        </p>
      )}
      {query.isPending && (
        <p role="status" className="py-4">
          Consultando gastos do Portal...
        </p>
      )}
      <p className="my-3 text-xs text-muted-foreground">
        Somente contas próprias autorizadas pelo Portal, inclusive campanhas sem funil. Lançamentos
        da planilha não são somados. Moedas diferentes permanecem separadas.
      </p>
      {!totals.length && !query.isPending && (
        <p className="py-3 text-sm text-muted-foreground">
          Sem gastos disponíveis. Ausência de dados não representa investimento zero.
        </p>
      )}
      {payload && adsPartial(payload, from, to) && (
        <p className="my-3 text-sm text-warning">
          Cobertura parcial ou indisponível. Histórico depende de sincronização no Portal; meses
          ausentes não são zero.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {groups.map((group) => {
          const [platform, currency] = group.split(":"),
            own = totals.filter((t) => t.platform === platform && t.currency === currency);
          const known = own.filter((t) => t.amount !== null);
          const amount = known.length ? known.reduce((s, t) => s + (t.amount ?? 0), 0) : null;
          return (
            <div key={group} className="border-t pt-4">
              <h3 className="font-semibold">
                {platformName(platform)} · {currency}
              </h3>
              <p className="my-2 text-xl font-semibold">
                {amount === null ? "Não informado" : money(amount, currency)} · valores conhecidos
              </p>
              <div className="divide-y">
                {Array.from({ length: 12 }, (_, i) => {
                  const month = `${year}-${String(i + 1).padStart(2, "0")}`,
                    t = own.find((x) => x.month === month);
                  return (
                    <div key={month} className="flex justify-between gap-3 py-2 text-sm">
                      <span>
                        {new Date(`${month}-02`).toLocaleDateString("pt-BR", {
                          month: "long",
                          timeZone: "UTC",
                        })}
                      </span>
                      <span>
                        {t?.amount != null ? money(t.amount, currency) : "Não informado"}
                        {t?.unknown ? ` · ${t.unknown} dias/linhas desconhecidos` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {[...new Set(totals.map((t) => t.currency))].map((c) => {
        const known = totals.filter((t) => t.currency === c && t.amount !== null);
        return (
          <p key={c} className="mt-4 font-semibold">
            Total entre plataformas ({c}):{" "}
            {known.length
              ? money(
                  known.reduce((s, t) => s + (t.amount ?? 0), 0),
                  c,
                )
              : "Não informado"}{" "}
            · parcial/valores conhecidos
          </p>
        );
      })}
    </section>
  );
}
