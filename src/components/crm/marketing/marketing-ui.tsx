import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PeriodBar, PeriodLabel, usePeriod } from "@/components/crm/dashboard/dashboard-ui";
import type { DashboardSearch } from "@/lib/dashboard-search";

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const int = (v: number) => v.toLocaleString("pt-BR");
export const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function LoadState({ loading, error }: { loading: boolean; error: unknown }) {
  if (loading) return <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>;
  if (error) return <p role="alert" className="py-10 text-center text-sm text-destructive">{error instanceof Error ? error.message : "Não foi possível carregar."}</p>;
  return null;
}

/** Barra de período compartilhada pelas páginas de Marketing (7/30/90 dias, mês atual, personalizado). */
export function MarketingPeriodBar({ search, refreshing, onRefresh }: { search: DashboardSearch; refreshing: boolean; onRefresh: () => void }) {
  const navigate = useNavigate();
  const { today, period } = usePeriod(search);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <PeriodBar search={search} onChange={(next) => void navigate({ to: ".", search: next, replace: true })} onRefresh={onRefresh} refreshing={refreshing} today={today} />
      <PeriodLabel period={period} invalid={search.p === "custom" && !period} />
    </div>
  );
}

export function useMarketingPeriod(search: DashboardSearch) {
  const { today, period } = usePeriod(search);
  return { today, period };
}
