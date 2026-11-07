import { ClientOnly } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERIOD_PRESETS, buckets, bucketOf, isContacted, isQualified, todaySaoPaulo, type Granularity, type Metric, type PeriodPreset } from "@/lib/dashboard";
import { resolvePeriod, type DashboardSearch } from "@/lib/dashboard-search";
import type { DashboardData } from "@/lib/dashboard.server";

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: v >= 1000 ? 0 : 2 });
export const int = (v: number) => v.toLocaleString("pt-BR");
export const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const dateBR = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR");
const label = (b: string, g: Granularity) => g === "month" ? new Date(`${b}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }) : new Date(`${b}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
export const C = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
export const axis = { tick: { fill: "var(--muted-foreground)", fontSize: 11 }, axisLine: false, tickLine: false } as const;

export function Kpi({ title, m, format }: { title: string; m: Metric; format: (v: number) => string }) {
  return <div className="surface surface-hover lab-rise rounded-xl border bg-card p-4">
    <p className="text-xs font-medium text-muted-foreground">{title}</p>
    {m.state === "ok" && m.value !== null
      ? <p className="mt-1 text-2xl font-semibold tabular-nums">{format(m.value)}</p>
      : <p className={`mt-1 text-sm font-semibold ${m.state === "integration" ? "text-primary" : "text-muted-foreground"}`}>{m.state === "integration" ? "Integração necessária" : "Dados indisponíveis"}</p>}
    {m.note && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{m.note}</p>}
  </div>;
}

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return <section className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">{title}</h2>{note && <p className="text-xs text-muted-foreground">{note}</p>}</div>
    {children}
  </section>;
}

export function ChartCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <div className="surface lab-rise rounded-2xl border bg-card p-5">
    <p className="font-semibold tracking-tight">{title}</p>{note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    <div className="mt-4 h-[280px]"><ClientOnly fallback={<div className="lab-skeleton h-full rounded-xl" />}><ResponsiveContainer width="100%" height="100%">{children as ReactElement}</ResponsiveContainer></ClientOnly></div>
  </div>;
}

/** Dia de hoje (São Paulo) só depois de montar, para não divergir entre servidor e navegador. */
export function useToday() {
  const [today, setToday] = useState("");
  useEffect(() => { setToday(todaySaoPaulo()); }, []);
  return today;
}

export function usePeriod(search: DashboardSearch) {
  const today = useToday();
  return { today, period: resolvePeriod(search, today), preset: search.p ?? "30d" };
}

/** Filtro de período compartilhado (Visão geral e Insights). */
export function PeriodBar({ search, onChange, onRefresh, refreshing, today, children }: {
  search: DashboardSearch; onChange: (next: DashboardSearch) => void; onRefresh: () => void; refreshing: boolean; today: string; children?: ReactNode;
}) {
  const preset = search.p ?? "30d";
  const pick = (p: PeriodPreset) => {
    if (p !== "custom") return onChange({ p });
    const from = new Date(Date.parse(`${today}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    onChange({ p, de: search.de ?? from, ate: search.ate ?? today });
  };
  return <div className="flex flex-wrap items-end gap-2">
    <Select value={preset} onValueChange={(v) => pick(v as PeriodPreset)}>
      <SelectTrigger className="w-[180px] bg-card" aria-label="Período"><SelectValue /></SelectTrigger>
      <SelectContent>{PERIOD_PRESETS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
    </Select>
    {preset === "custom" && <>
      <Input type="date" aria-label="De" className="w-[150px] bg-card" value={search.de ?? ""} onChange={(e) => onChange({ ...search, de: e.target.value || undefined })} />
      <Input type="date" aria-label="Até" className="w-[150px] bg-card" value={search.ate ?? ""} onChange={(e) => onChange({ ...search, ate: e.target.value || undefined })} />
    </>}
    {children}
    <Button variant="outline" size="icon" aria-label="Atualizar dados" onClick={onRefresh}><RefreshCw className={refreshing ? "animate-spin" : ""} /></Button>
  </div>;
}

export function PeriodLabel({ period, invalid }: { period: { from: string; to: string } | null; invalid: boolean }) {
  if (invalid) return <p role="alert" className="text-sm text-destructive">Escolha uma data inicial anterior ou igual à final.</p>;
  if (!period) return null;
  return <p className="text-xs text-muted-foreground">Período: <span className="font-medium text-foreground">{dateBR(period.from)} a {dateBR(period.to)}</span></p>;
}

/** Séries dos gráficos a partir dos dados reais do período (mesmas regras do Dashboard anterior). */
export function buildCharts(d: DashboardData, period: { from: string; to: string }, g: Granularity) {
  const keys = buckets(period.from, period.to, g);
  const blank = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;
  const leads = blank(), qual = blank(), sales = blank(), comp = blank(), outLeads = blank(), outContacts = blank(), outOpps = blank();
  for (const l of d.series.leads) {
    if (l.entryDate >= period.from && l.entryDate <= period.to) {
      const b = bucketOf(l.entryDate, g); leads[b]++; if (isQualified(l.stage)) qual[b]++;
      if (d.series.outboundId && l.pipelineId === d.series.outboundId) { outLeads[b]++; if (isContacted(l.stage)) outContacts[b]++; if (isQualified(l.stage)) outOpps[b]++; }
    }
    const c = l.closedAt ?? l.entryDate;
    if (l.stage === "fechado" && c >= period.from && c <= period.to) sales[bucketOf(c, g)]++;
  }
  const monthlyOnly = d.series.revenueMonthly.length > 0 || d.series.investmentMonthly.length > 0;
  const fg: Granularity = monthlyOnly ? "month" : g;
  const fkeys = buckets(period.from, period.to, fg);
  const revB = Object.fromEntries(fkeys.map((k) => [k, null as number | null])), invB = { ...revB };
  for (const r of d.series.revenueDaily) { const b = bucketOf(r.date, fg); revB[b] = (revB[b] ?? 0) + r.value; }
  for (const r of d.series.revenueMonthly) revB[r.month] = (revB[r.month] ?? 0) + r.value;
  for (const r of d.series.investmentDaily) { const b = bucketOf(r.date, fg); invB[b] = (invB[b] ?? 0) + r.value; }
  for (const r of d.series.investmentMonthly) invB[r.month] = (invB[r.month] ?? 0) + r.value;
  for (const day of d.series.b2bDaily) if (day) comp[bucketOf(day, g)] = (comp[bucketOf(day, g)] ?? 0) + 1;
  return {
    commercial: keys.map((k) => ({ k: label(k, g), leads: leads[k], qualificados: qual[k], vendas: sales[k] })),
    finance: fkeys.map((k) => ({ k: label(k, fg), investimento: invB[k], faturamento: revB[k], resultado: revB[k] !== null && invB[k] !== null ? (revB[k] as number) - (invB[k] as number) : null })),
    financeMonthly: monthlyOnly && g !== "month",
    outbound: keys.map((k) => ({ k: label(k, g), empresas: comp[k] ?? 0, leads: outLeads[k], contatos: outContacts[k], oportunidades: outOpps[k] })),
  };
}
