import { ClientOnly } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Wallet, RefreshCw, ExternalLink, AlertTriangle, Lock } from "lucide-react";
import { CrmSidebar } from "@/components/crm/CrmSidebar";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { getFinance } from "@/lib/finance.functions";
import { FINANCE_SPREADSHEET, FINANCE_YEAR } from "@/lib/finance";
import { currency } from "@/lib/revenue";
import { PortalFinancialSpend } from "@/components/crm/PortalAdsSpend";

const thousands = (n: number) => (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

export function FinanceLegacySources() {
  const fetchFinance = useServerFn(getFinance);
  const [limited, setLimited] = useState(false);
  const narrow = useIsNarrow();
  const query = useQuery({
    queryKey: ["financeiro", FINANCE_YEAR],
    queryFn: () => fetchFinance(),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (query.data?.needsAuth) {
    if (limited)
      return (
        <div className="flex h-screen bg-background">
          <CrmSidebar />
          <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Lock className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Financeiro restrito</h1>
            <p className="text-sm text-muted-foreground">Entre com a senha de acesso completo.</p>
            <Button onClick={() => setLimited(false)}>Entrar novamente</Button>
          </main>
        </div>
      );
    return (
      <CrmAuthGate
        onUnlock={(access) => {
          if (access.level === "full") void query.refetch();
          else setLimited(true);
        }}
      />
    );
  }
  const months = query.data?.months ?? [];
  const MonthTick = ({
    x = 0,
    y = 0,
    payload,
    list = months,
  }: {
    x?: number;
    y?: number;
    payload?: { value: string; index: number };
    list?: typeof months;
  }) => {
    const m = list.find((mm) => mm.short === payload?.value) ?? list[payload?.index ?? -1];
    const label =
      m?.value != null
        ? narrow
          ? thousands(m.value)
          : currency(m.value)
        : m?.status === "error"
          ? "erro"
          : "—";
    const color =
      m?.status === "error"
        ? "var(--destructive)"
        : m?.status === "empty"
          ? "var(--muted-foreground)"
          : "var(--foreground)";
    if (narrow)
      return (
        <g transform={`translate(${x},${y})`}>
          <text
            transform="translate(0,66) rotate(-90)"
            textAnchor="start"
            dy={-3}
            fontSize={9}
            fill={color}
          >
            <tspan fontWeight={600} fill="var(--muted-foreground)">
              {payload?.value} ·{" "}
            </tspan>
            {label}
          </text>
        </g>
      );
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          dy={14}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="var(--muted-foreground)"
        >
          {payload?.value}
        </text>
        <text dy={31} textAnchor="middle" fontSize={10.5} fill={color}>
          {label}
        </text>
      </g>
    );
  };
  const filled = months.filter((m) => m.value !== null);
  const total = filled.reduce((sum, m) => sum + (m.value ?? 0), 0);
  const highest = filled.reduce<(typeof filled)[number] | null>(
    (best, m) => (!best || (m.value ?? 0) > (best.value ?? 0) ? m : best),
    null,
  );
  const issues = months.filter((m) => m.status === "error");
  const error =
    query.data?.error ||
    (query.error ? "Não foi possível carregar o Financeiro. Tente novamente." : null);
  const updated = query.data?.updatedAt
    ? new Date(query.data.updatedAt).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const renderChart = (list: typeof months, title: string, label: string, color: string) => (
    <section className="py-7" aria-label={label}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {title} · {FINANCE_YEAR}
        </h2>
        <span className="text-xs text-muted-foreground">
          {narrow ? `Janeiro — Dezembro · valores em R$ mil` : "Janeiro — Dezembro"}
        </span>
      </div>
      <div className="h-[320px] w-full md:h-[380px]">
        <ClientOnly fallback={<div className="h-full bg-muted/30" />}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={list} margin={{ top: 10, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="short"
                axisLine={false}
                tickLine={false}
                interval={0}
                height={narrow ? 72 : 48}
                tick={<MonthTick list={list} />}
              />
              <YAxis
                width={60}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickFormatter={(value: number) => `${value / 1000} mil`}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const month = payload[0]?.payload;
                  return (
                    <div className="rounded-md border bg-popover p-3 text-sm shadow-sm">
                      <p className="font-medium">{month.month}</p>
                      <p className="mt-1" style={{ color }}>
                        {month.value === null ? "Sem valor" : currency(month.value)}
                      </p>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="value"
                fill={color}
                radius={[4, 4, 0, 0]}
                maxBarSize={52}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ClientOnly>
      </div>
    </section>
  );

  return (
    <div className="bg-background">
      <div className="min-w-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <Wallet className="h-5 w-5" />
              <span className="text-sm font-medium">Gravon · {FINANCE_YEAR}</span>
            </div>
            <h2 className="text-xl font-bold">Fontes conectadas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Receita mensal</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a
                href={`https://docs.google.com/spreadsheets/d/${FINANCE_SPREADSHEET}/edit?gid=1601409282#gid=1601409282`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink />
                Planilha
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw
                className={query.isFetching ? "animate-spin motion-reduce:animate-none" : ""}
              />
              Atualizar
            </Button>
          </div>
        </header>
        {query.isPending ? (
          <p role="status" className="py-20 text-center text-muted-foreground">
            Carregando receita mensal...
          </p>
        ) : error ? (
          <div role="alert" className="my-8 space-y-3">
            <AlertTriangle className="text-destructive" />
            <p className="break-words text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-6 border-b py-7 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Receita total registrada</p>
                <p className="mt-2 text-3xl font-bold">{currency(total)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {filled.length} meses com valor
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Média mensal registrada</p>
                <p className="mt-2 text-3xl font-semibold">
                  {currency(filled.length ? total / filled.length : 0)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Somente meses com valor</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Maior receita mensal</p>
                <p className="mt-2 text-3xl font-semibold text-primary">
                  {highest ? currency(highest.value ?? 0) : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {highest?.month ?? "Sem valores"}
                </p>
              </div>
            </div>
            {issues.length > 0 && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  {issues.map((m) => `${m.month} (${m.cell})`).join(", ")}: erro na planilha. Valor
                  não incluído no total.
                </p>
              </div>
            )}
            {renderChart(
              months,
              "Faturamento mensal",
              "Gráfico de faturamento mensal",
              "var(--primary)",
            )}
            <PortalFinancialSpend year={FINANCE_YEAR} />
            <section className="border-t pt-6">
              <h2 className="mb-4 text-base font-semibold">Receita por mês</h2>
              <div className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
                {months.map((m) => (
                  <div
                    key={m.cell}
                    className="flex items-center justify-between gap-3 border-b py-3 text-sm"
                  >
                    <span>{m.month}</span>
                    <span
                      className={
                        m.status === "error"
                          ? "font-medium text-destructive"
                          : m.status === "empty"
                            ? "text-muted-foreground"
                            : "font-semibold"
                      }
                    >
                      {m.value !== null
                        ? currency(m.value)
                        : m.status === "error"
                          ? "Erro na planilha"
                          : "Sem valor"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <footer className="mt-6 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Finanças Gestão · aba 2026 · receita D52:O52 · investimento em tráfego: Portal
                Gravon
              </span>
              <span>{updated ? `Última leitura: ${updated}` : ""}</span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
