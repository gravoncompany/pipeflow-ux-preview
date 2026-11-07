import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarCheck, CalendarIcon, Wallet } from "lucide-react";
import { useLeads } from "@/hooks/use-leads";
import { funnelMetrics } from "@/lib/funnel-metrics";
import { currency } from "@/lib/revenue";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listPipelines } from "@/lib/pipelines.functions";
import { PortalFunnelSpend } from "@/components/crm/PortalAdsSpend";
import { getSaleReview } from "@/lib/sale-classifications.functions";
import { OutboundEmailMetrics } from "@/components/crm/OutboundEmailMetrics";
import { SaleReviewDialog } from "@/components/crm/SaleClassificationDialog";

const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const PRESETS: { label: string; get: () => { from: string; to: string } }[] = [
  {
    label: "Hoje",
    get: () => {
      const t = toISO(new Date());
      return { from: t, to: t };
    },
  },
  {
    label: "7 dias",
    get: () => {
      const t = new Date();
      return { from: toISO(addDays(t, -6)), to: toISO(t) };
    },
  },
  {
    label: "14 dias",
    get: () => {
      const t = new Date();
      return { from: toISO(addDays(t, -13)), to: toISO(t) };
    },
  },
  {
    label: "30 dias",
    get: () => {
      const t = new Date();
      return { from: toISO(addDays(t, -29)), to: toISO(t) };
    },
  },
  {
    label: "Mês atual",
    get: () => {
      const t = new Date();
      const first = new Date(t.getFullYear(), t.getMonth(), 1);
      const last = new Date(t.getFullYear(), t.getMonth() + 1, 0);
      return { from: toISO(first), to: toISO(last) };
    },
  },
  {
    label: "Mês anterior",
    get: () => {
      const t = new Date();
      const first = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const last = new Date(t.getFullYear(), t.getMonth(), 0);
      return { from: toISO(first), to: toISO(last) };
    },
  },
];

const fmt = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const parsed = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("justify-start font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon className="mr-1.5 h-4 w-4" />
          {parsed ? format(parsed, "dd MMM yyyy", { locale: ptBR }) : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parsed}
          defaultMonth={parsed}
          onSelect={(d) => {
            if (d) {
              onChange(toISO(d));
              setOpen(false);
            }
          }}
          initialFocus
          className="pointer-events-auto p-3"
        />
      </PopoverContent>
    </Popover>
  );
}

const dayLabel = (d: string) => {
  const [y, m, day] = (d || "").slice(0, 10).split("-");
  return day && m ? `${day}/${m}` : "";
};

/**
 * Análise de Funis (antiga página "Funil de 30 dias"), sem alteração de métricas.
 * No CRM ela recebe o funil selecionado no Kanban (controlada); na rota /funil
 * ela mantém a seleção própria, como antes.
 */
export function FunnelAnalysis({
  pipeline: controlledPipeline,
  onPipelineChange,
}: {
  pipeline?: string;
  onPipelineChange?: (id: string) => void;
} = {}) {
  const { leads } = useLeads();
  const defaultRange = useMemo(() => {
    const t = new Date();
    return { from: toISO(addDays(t, -29)), to: toISO(t) };
  }, []);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [innerPipeline, setInnerPipeline] = useState("main");
  const pipeline = controlledPipeline ?? innerPipeline;
  const setPipeline = (id: string) => {
    if (onPipelineChange) onPipelineChange(id);
    else setInnerPipeline(id);
  };
  const [reviewOpen, setReviewOpen] = useState(false);
  const fetchPipelines = useServerFn(listPipelines);
  const pipelines = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => fetchPipelines(),
    retry: false,
  });
  const fetchReview = useServerFn(getSaleReview);
  const review = useQuery({
    queryKey: ["sale-review", from, to, pipeline],
    queryFn: () => fetchReview({ data: { from, to, pipeline } }),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const pipelineOptions = [{ id: "main", name: "Funil principal" }, ...(pipelines.data ?? [])];
  const pipelineName = pipelineOptions.find((x) => x.id === pipeline)?.name ?? "Funil";

  const periodLeads = useMemo(() => {
    return leads.filter((l) => {
      if (pipeline === "main" ? l.pipelineId != null : l.pipelineId !== pipeline) return false;
      const d = (l.entryDate || "").slice(0, 10);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [leads, from, to, pipeline]);

  const rows = useMemo(() => {
    const stages = new Map<string, number>();
    for (const lead of periodLeads) stages.set(lead.stage, (stages.get(lead.stage) ?? 0) + 1);
    return funnelMetrics(
      periodLeads.length,
      Array.from(stages, ([stage, count]) => ({ stage, count })),
    );
  }, [periodLeads]);

  const closed = useMemo(() => {
    const inPeriod = periodLeads
      .filter((l) => l.stage === "fechado")
      .map((l) => ({ ...l, amount: l.potentialValue || 0 }))
      .sort((a, b) => b.amount - a.amount);
    return {
      inPeriod,
      totalPeriod: inPeriod.reduce((s, l) => s + l.amount, 0),
      missing: inPeriod.filter((l) => !l.amount).length,
    };
  }, [periodLeads]);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
      <h1 className="text-xl font-bold ">Análise de Funis</h1>
      <p className="text-sm text-muted-foreground">
        Taxas de conversão dos leads de {pipelineName} que entraram no período selecionado.
      </p>

      <section className="my-5 border-y py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Funil</Label>
            <Select value={pipeline} onValueChange={setPipeline}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pipelineOptions.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DateField label="De" value={from} onChange={setFrom} />
          <span className="text-xs text-muted-foreground">até</span>
          <DateField label="Até" value={to} onChange={setTo} />
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const range = p.get();
              const active = from === range.from && to === range.to;
              return (
                <Button
                  key={p.label}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setFrom(range.from);
                    setTo(range.to);
                  }}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {fmt(from)} — {fmt(to)} · {periodLeads.length}{" "}
            {periodLeads.length === 1 ? "lead" : "leads"} no período
          </span>
        </div>
      </section>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {rows.map((r, i) => (
          <div key={r.key} className="min-w-0 rounded-lg border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">
              {r.key === "reun"
                ? "Reuniões agendadas"
                : r.key === "fech"
                  ? "Clientes fechados"
                  : r.label}
            </p>
            <p className="mt-1 text-3xl font-bold">{r.count}</p>
            <p className="text-xs text-muted-foreground">
              {i === 0
                ? "entraram no período"
                : `${r.key === "fech" ? "Oportunidades fechadas · " : ""}${r.hasPreviousBase ? `${r.ofPrev.toFixed(1)}% da etapa anterior` : "Sem base de conversão"}`}
            </p>
          </div>
        ))}
      </div>

      {pipeline !== "main" && (
        <OutboundEmailMetrics pipelineId={pipeline} from={from} to={to} newLeads={rows[0]?.count ?? 0} />
      )}

      <PortalFunnelSpend
        pipeline={pipeline}
        options={pipelineOptions}
        from={from}
        to={to}
        counts={{
          leads: rows[0]?.count ?? 0,
          qualified: rows[2]?.count ?? 0,
          meetings: rows[3]?.count ?? 0,
        }}
        cac={{
          newCustomers: review.data?.newCustomers ?? null,
          pending: review.data?.pending ?? 0,
          loading: review.isPending,
          onReview: () => setReviewOpen(true),
        }}
      >
        <section className="mb-6 space-y-3 border-y py-5">
          <h2 className="mb-4 text-sm font-semibold">Conversão do funil</h2>
          {rows.map((r, i) => (
            <div key={r.key} className="flex flex-col items-center">
              <div
                className="relative flex min-h-14 items-center justify-between gap-2 overflow-hidden rounded-lg bg-primary/10 px-2 py-2 text-xs sm:px-4 sm:text-sm"
                style={{ width: `${Math.max(100 - i * 7, 72)}%` }}
              >
                <div
                  className="absolute inset-y-0 left-0 bg-primary/30"
                  style={{ width: `${r.ofTotal}%` }}
                />
                <span className="relative z-10 font-medium">{r.label}</span>
                <span className="relative z-10 flex items-baseline gap-2">
                  <span className="text-lg font-bold">{r.count}</span>
                  <span className="text-xs text-muted-foreground">{r.ofTotal.toFixed(1)}%</span>
                </span>
              </div>
            </div>
          ))}
        </section>
      </PortalFunnelSpend>

      <div className="mb-8 grid items-stretch gap-4 lg:grid-cols-[1fr_1.15fr]">
        <section className="border-t py-5">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Valor potencial — clientes fechados</h2>
          </div>
          <p className="mt-3 text-3xl font-bold ">{currency(closed.totalPeriod)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {closed.inPeriod.length}{" "}
            {closed.inPeriod.length === 1 ? "cliente fechado" : "clientes fechados"} no período
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Soma do valor potencial preenchido no pipe
            {closed.missing > 0 && ` · ${closed.missing} sem valor`}
          </p>
        </section>

        <section className="flex min-h-0 flex-col border-t">
          <div className="flex items-center gap-2 border-b px-5 py-3">
            <CalendarCheck className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Valor de cada cliente fechado</h2>
          </div>
          <div className="max-h-[260px] overflow-y-auto p-2">
            {closed.inPeriod.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum cliente fechado no período selecionado.
              </p>
            ) : (
              closed.inPeriod.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{l.name || "Sem nome"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {dayLabel(l.entryDate)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-semibold ${l.amount ? "" : "text-muted-foreground"}`}
                  >
                    {l.amount ? currency(l.amount) : "sem valor"}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <SaleReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        from={from}
        to={to}
        pipeline={pipeline}
      />
    </main>
  );
}
