import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, FlaskConical, Lock, RefreshCw } from "lucide-react";
import { PipeflowSymbol } from "@/components/brand/PipeflowLogo";
import { CrmSidebar } from "@/components/crm/CrmSidebar";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import {
  AchievementList,
  MilestoneDialog,
  RevenuePanel,
  UniverseScene,
  type CelebrationView,
} from "@/components/crm/GravonUniverse";
import { Button } from "@/components/ui/button";
import { getUniverseFinance } from "@/lib/gravon-universe.functions";
import { FINANCE_YEAR } from "@/lib/finance";
import {
  ACCUMULATED_GOAL,
  JOURNEYS,
  brl,
  compactBrl,
  currentMonthIndex,
  historyRows,
  journeyProgress,
  revenueFor,
  type HistoryRow,
  type UniverseMode,
} from "@/lib/gravon-universe-journey";
import {
  celebrationScope,
  evaluateCelebration,
  readBaseline,
  simulatedValueFor,
  writeBaseline,
} from "@/lib/gravon-universe-celebration";

/**
 * Controles de simulação existem somente no laboratório: o servidor confirma a mesma
 * configuração exigida pelo guard do laboratório (APP_ENV=test e OUTBOUND_MODE=mock).
 * Em qualquer outro ambiente a barra não aparece e valores simulados são ignorados.
 */
// Pipeflow (produção): a simulação do laboratório fica sempre desligada; somente dados reais da planilha.
const getUniverseLabMode = createServerFn({ method: "GET" }).handler(async (): Promise<boolean> => false);

const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const Route = createFileRoute("/gravon-universe")({
  head: () => ({
    meta: [
      { title: "Universo Pipeflow — PipeFlow CRM" },
      {
        name: "description",
        content: "Jornadas Mensal e Acumulada de receita confirmada.",
      },
      { property: "og:title", content: "Universo Pipeflow — PipeFlow CRM" },
      { property: "og:description", content: "Jornadas Mensal e Acumulada de receita confirmada." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GravonUniversePage,
});

const MODES: UniverseMode[] = ["mensal", "acumulada"];

function GravonUniversePage() {
  const fetchFinance = useServerFn(getUniverseFinance);
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const fetchLabMode = useServerFn(getUniverseLabMode);
  const labMode = useQuery({
    queryKey: ["gravon-universe-lab-mode"],
    queryFn: () => fetchLabMode(),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const isLab = labMode.data === true;
  const [limited, setLimited] = useState(false);
  const [mode, setMode] = useState<UniverseMode>("mensal");
  const [selected, setSelected] = useState<number | null>(null);
  /** Mês consultado na Jornada Mensal; null = mês corrente (reinício automático). */
  const [chosenMonth, setChosenMonth] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["gravon-universe-finance", FINANCE_YEAR],
    queryFn: () => fetchFinance({ data: { force: false } }),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const data = query.data?.months;
  const months = useMemo(() => data ?? [], [data]);
  const monthIndex = useMemo(() => currentMonthIndex(new Date(), FINANCE_YEAR), []);
  const journey = JOURNEYS[mode];
  const viewMonth =
    mode === "mensal" && chosenMonth != null && chosenMonth <= monthIndex
      ? chosenMonth
      : monthIndex;
  const realValue = revenueFor(mode, months, viewMonth);
  /** Laboratório: valor apenas visual para demonstrar conquistas; nunca é salvo. */
  const [simulated, setSimulated] = useState<Partial<Record<UniverseMode, number>>>({});
  const scope = celebrationScope(mode, FINANCE_YEAR, monthIndex, viewMonth);
  const simValue = scope && isLab ? simulated[mode] : undefined;
  const value = simValue ?? realValue;
  const progress = useMemo(() => journeyProgress(value, journey.milestones), [value, journey]);

  // Celebração apenas de conquistas novas, uma vez por escopo (mês corrente / acumulado).
  const ready = query.isSuccess && !query.data?.needsAuth && !query.data?.error;
  const simBaselines = useRef<Partial<Record<UniverseMode, number>>>({});
  const [celebration, setCelebration] = useState<(CelebrationView & { mode: UniverseMode }) | null>(
    null,
  );
  useEffect(() => {
    if (!ready || !scope) return;
    const isSim = simValue != null;
    const storage = browserStorage();
    const previous = isSim ? (simBaselines.current[mode] ?? null) : readBaseline(storage, scope);
    const result = evaluateCelebration(previous, progress.achieved);
    if (isSim) simBaselines.current[mode] = result.baseline;
    else writeBaseline(storage, scope, result.baseline);
    if (result.indices.length)
      setCelebration({
        key: `${scope}:${isSim ? "sim" : "real"}:${result.baseline}:${Date.now()}`,
        indices: result.indices,
        mode,
      });
  }, [ready, scope, mode, simValue, progress.achieved]);
  useEffect(() => {
    if (!celebration) return;
    const timer = window.setTimeout(() => setCelebration(null), 3300);
    return () => window.clearTimeout(timer);
  }, [celebration]);

  const simulate = (kind: "next" | "three" | "correction" | "stop") => {
    if (!isLab) return;
    setSelected(null);
    if (kind === "stop") {
      setSimulated((s) => ({ ...s, [mode]: undefined }));
      return;
    }
    if (simValue == null) simBaselines.current[mode] = progress.achieved;
    const { milestones } = journey;
    const target =
      kind === "correction"
        ? Math.max(0, (milestones[progress.achieved - 1]?.threshold ?? 0) - 1)
        : simulatedValueFor(milestones, progress.achieved, kind === "three" ? 3 : 1);
    setSimulated((s) => ({ ...s, [mode]: target }));
  };
  const rows = useMemo(() => historyRows(months, monthIndex), [months, monthIndex]);
  const monthName = (i: number) => months[i]?.month || "mês atual";
  const periodLabel =
    monthIndex < 0
      ? `Jornada de ${FINANCE_YEAR} ainda não iniciada`
      : mode === "mensal"
        ? `${monthName(viewMonth)} de ${FINANCE_YEAR}${viewMonth === monthIndex ? " · mês atual" : ""}`
        : `${months[0]?.month || "Janeiro"} a ${monthName(monthIndex)} de ${FINANCE_YEAR}`;
  const considered =
    mode === "mensal" ? months.slice(viewMonth, viewMonth + 1) : months.slice(0, monthIndex + 1);
  const errors = viewMonth < 0 ? [] : considered.filter((m) => m.status === "error");
  const empty = value <= 0;

  if (query.data?.needsAuth) {
    if (limited)
      return (
        <div className="flex h-screen bg-background">
          <CrmSidebar />
          <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Lock className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Universo Pipeflow restrito</h1>
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

  const error =
    query.data?.error ||
    (query.error ? "Não foi possível carregar a receita confirmada. Tente novamente." : null);

  return (
    <div className="flex h-screen bg-background">
      <CrmSidebar
        onLogout={() => {
          window.location.href = "/";
        }}
      />
      <main className="dark min-w-0 flex-1 overflow-y-auto bg-universe-backdrop p-4 text-white md:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-start gap-3">
            <PipeflowSymbol className="mt-1 h-9 w-9 shrink-0 rounded-lg bg-white/10 p-1" />
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/50">
                Pipeflow
              </p>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Universo Pipeflow</h1>
              <p className="mt-1 max-w-2xl text-sm text-white/60">
                {mode === "mensal"
                  ? "Metas de receita confirmada do mês, de R$ 10 mil a R$ 50 mil. O progresso recomeça automaticamente a cada mês."
                  : `Toda a receita confirmada somada ao longo do tempo, sem reinício mensal, até o objetivo final de ${compactBrl(ACCUMULATED_GOAL)}.`}{" "}
                Clique em um planeta para ver os detalhes da conquista.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="Jornada"
              className="flex rounded-lg border border-white/10 bg-white/[0.03] p-1"
            >
              {MODES.map((id) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={mode === id}
                  onClick={() => {
                    setMode(id);
                    setSelected(null);
                    setCelebration(null);
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    mode === id
                      ? "bg-primary text-primary-foreground"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {JOURNEYS[id].label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="icon"
              title="Atualizar"
              aria-label="Atualizar"
              className="border-white/10 bg-transparent text-white hover:bg-white/10"
              onClick={async () => {
                // Sincronização manual: ignora o cache e relê a planilha agora.
                setSyncing(true);
                try { queryClient.setQueryData(["gravon-universe-finance", FINANCE_YEAR], await fetchFinance({ data: { force: true } })); }
                finally { setSyncing(false); }
              }}
              disabled={query.isFetching || syncing}
            >
              <RefreshCw className={`h-4 w-4 ${query.isFetching || syncing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </header>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-white/40">
            Receita confirmada lida do Google Sheets (aba {FINANCE_YEAR}, linha “Valor Total”)
            {query.data?.updatedAt ? ` · sincronizado em ${new Date(query.data.updatedAt).toLocaleString("pt-BR")}` : ""}.
          </p>
          {mode === "mensal" && monthIndex >= 0 && (
            <label className="flex items-center gap-2 text-sm text-white/70">
              Mês consultado
              <select
                value={viewMonth}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setChosenMonth(next === monthIndex ? null : next);
                  setSelected(null);
                  setCelebration(null);
                }}
                className="rounded-md border border-white/10 bg-[#0d0f14] px-2 py-1 text-sm text-white"
              >
                {months.slice(0, monthIndex + 1).map((m, i) => (
                  <option key={i} value={i}>
                    {m.month || `Mês ${i + 1}`}
                    {i === monthIndex ? " (atual)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {ready && scope && isLab && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#e3b75f]/25 bg-[#e3b75f]/[0.04] px-3 py-2 text-xs text-white/70">
            <FlaskConical className="h-4 w-4 shrink-0 text-[#e3b75f]" />
            <span className="font-medium text-white/80">Simulação de laboratório</span>
            <span className="text-white/50">
              {simValue != null
                ? `Valor visual ${brl(simValue)} — não é salvo nem altera o Financeiro.`
                : "Experimente a celebração sem alterar dados financeiros."}
            </span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <SimButton onClick={() => simulate("next")} disabled={!progress.next}>
                Atingir próxima meta
              </SimButton>
              <SimButton onClick={() => simulate("three")} disabled={!progress.next}>
                Atingir 3 metas
              </SimButton>
              <SimButton onClick={() => simulate("correction")} disabled={progress.achieved === 0}>
                Simular correção
              </SimButton>
              {simValue != null && (
                <SimButton onClick={() => simulate("stop")}>Voltar aos dados reais</SimButton>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        {!error && errors.length > 0 && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Valor inválido no Financeiro em {errors.map((m) => m.month).join(", ")}; não é contado
            como receita até ser corrigido.
          </p>
        )}
        {!error && mode === "acumulada" && value < 0 && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Correções e cancelamentos deixaram o acumulado negativo ({brl(value)}); a jornada fica
            no Início até o saldo voltar a ser positivo.
          </p>
        )}

        {query.isLoading ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[340px_1fr]">
            <div className="h-64 animate-pulse rounded-2xl bg-white/5" />
            <div className="aspect-[1000/620] animate-pulse rounded-2xl bg-white/5" />
          </div>
        ) : (
          <>
            <div key={mode} className="gu-fade mt-5 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
              {/* No desktop a coluna acompanha a altura da cena, sem áreas vazias. */}
              <div className="relative">
                <div className="flex flex-col gap-4 xl:absolute xl:inset-0">
                  <RevenuePanel
                    progress={progress}
                    journey={journey}
                    periodLabel={periodLabel}
                    empty={empty}
                    onOpenNext={() => setSelected(progress.achieved)}
                  />
                  <div className="flex max-h-72 min-h-0 flex-col xl:max-h-none xl:flex-1">
                    <AchievementList
                      progress={progress}
                      journey={journey}
                      onSelect={setSelected}
                      selected={selected}
                    />
                  </div>
                </div>
              </div>
              <UniverseScene
                progress={progress}
                journey={journey}
                onSelect={setSelected}
                selected={selected}
                celebration={celebration?.mode === mode ? celebration : null}
              />
            </div>
            {mode === "mensal" ? (
              <MonthlyHistory
                rows={rows}
                viewMonth={viewMonth}
                onView={(i) => {
                  setChosenMonth(i === monthIndex ? null : i);
                  setSelected(null);
                }}
              />
            ) : (
              <AccumulatedHistory rows={rows} />
            )}
          </>
        )}

        <MilestoneDialog
          index={selected}
          onClose={() => setSelected(null)}
          progress={progress}
          journey={journey}
          months={months}
          monthIndex={monthIndex}
          periodLabel={periodLabel}
        />
      </main>
    </div>
  );
}

function SimButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-[#e3b75f]/30 px-2.5 py-1 text-xs text-[#f3d38c] transition-colors hover:bg-[#e3b75f]/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const monthValue = (r: HistoryRow) =>
  r.status === "error" ? (
    <span className="text-amber-300">valor inválido</span>
  ) : r.value == null ? (
    <span className="text-white/40">—</span>
  ) : (
    brl(r.value)
  );

function HistoryFrame({
  title,
  subtitle,
  children,
  empty,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  empty: boolean;
}) {
  return (
    <section
      className="mt-6 rounded-2xl border border-white/10 bg-[#0d0f14] p-5"
      aria-label={title}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-white/50">{subtitle}</p>
        </div>
        <Link to="/financeiro" className="text-sm text-[#e3b75f] hover:underline">
          Abrir Financeiro
        </Link>
      </div>
      {empty ? (
        <p className="py-8 text-center text-sm text-white/60">
          Ainda não há meses de {FINANCE_YEAR} para exibir.
        </p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  );
}

function MonthlyHistory({
  rows,
  viewMonth,
  onView,
}: {
  rows: HistoryRow[];
  viewMonth: number;
  onView: (index: number) => void;
}) {
  return (
    <HistoryFrame
      title={`Histórico mensal · ${FINANCE_YEAR}`}
      subtitle="Cada mês começa do zero; os meses anteriores ficam preservados para consulta."
      empty={rows.length === 0}
    >
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs text-white/50">
            <th className="py-2 pr-4 font-medium">Mês</th>
            <th className="py-2 pr-4 text-right font-medium">Receita confirmada</th>
            <th className="py-2 pr-4 font-medium">Planeta do mês</th>
            <th className="py-2 pr-4 text-right font-medium">Até a próxima meta</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Ação</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr
              key={r.index}
              className={`border-b border-white/5 last:border-0 ${r.index === viewMonth ? "bg-[#e3b75f]/10" : ""}`}
            >
              <td className="py-2 pr-4">{r.month}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{monthValue(r)}</td>
              <td className="py-2 pr-4 text-[#e3b75f]">
                {r.monthly?.name ?? <span className="text-white/40">Início</span>}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-white/70">
                {r.monthlyPercent}%
              </td>
              <td className="py-2 text-right">
                {r.index === viewMonth ? (
                  <span className="text-xs text-white/50">Exibindo</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onView(r.index)}
                    className="text-xs text-[#e3b75f] hover:underline"
                  >
                    Ver mês
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </HistoryFrame>
  );
}

function AccumulatedHistory({ rows }: { rows: HistoryRow[] }) {
  return (
    <HistoryFrame
      title={`Evolução acumulada · ${FINANCE_YEAR}`}
      subtitle="Receita confirmada somada mês a mês; correções e cancelamentos reduzem o total."
      empty={rows.length === 0}
    >
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs text-white/50">
            <th className="py-2 pr-4 font-medium">Mês</th>
            <th className="py-2 pr-4 text-right font-medium">Receita do mês</th>
            <th className="py-2 pr-4 text-right font-medium">Acumulado</th>
            <th className="py-2 pr-4 font-medium">Planeta acumulado</th>
            <th className="py-2 font-medium">Desbloqueado no mês</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index} className="border-b border-white/5 last:border-0">
              <td className="py-2 pr-4">{r.month}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{monthValue(r)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{brl(r.cumulative)}</td>
              <td className="py-2 pr-4 text-[#e3b75f]">
                {r.accumulated?.name ?? <span className="text-white/40">Início</span>}
              </td>
              <td className="py-2 text-white/80">
                {r.unlocked.length ? (
                  r.unlocked.map((m) => m.name).join(", ")
                ) : (
                  <span className="text-white/40">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </HistoryFrame>
  );
}
