import { Target, Megaphone, Users, Wallet, Percent, Calculator, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { businessDaysLeft } from "@/lib/ux-format";
import { todaySP } from "@/lib/finance-management";
import { projections, resolveFunnel, funnelRates, contractResult, realizedServiceTotal, brl, dec, pct, div, type GoalData, type FunnelKey } from "@/lib/commercial-goals";

type Props = { data: GoalData; crm: { leads: number; qualified: number; clients: number }; notes: string; plan: string; month?: string };
const count = (v: number | null) => (v == null ? "Não informado" : dec(v, 0));
const money = (v: number | null) => (v == null ? "Não calculável" : brl(v));
const sumOrNull = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <section className="space-y-4"><div><h2 className="text-lg font-semibold">{title}</h2>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>{children}</section>;
}

function Kpi({ title, value, detail, icon: Icon, accent = false }: { title: string; value: string; detail?: string; icon: typeof Target; accent?: boolean }) {
  return <article className={`min-w-0 rounded-xl border p-4 ${accent ? "border-primary/30 bg-primary/5" : "bg-card"}`}>
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-medium text-muted-foreground">{title}</h3><Icon className={`size-4 shrink-0 ${accent ? "text-primary" : "text-muted-foreground"}`} /></div>
    <p className="mt-3 break-words text-2xl font-bold tabular-nums">{value}</p>
    {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
  </article>;
}

function FinCard({ label, projected, realized, realizedOnly }: { label: string; projected?: string; realized: string; realizedOnly?: boolean }) {
  return <article className="min-w-0 rounded-xl border bg-card p-4">
    <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
    <div className={`mt-3 grid gap-3 ${realizedOnly ? "" : "grid-cols-2"}`}>
      {!realizedOnly && <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Projetado</p><p className="break-words text-base font-semibold tabular-nums">{projected}</p></div>}
      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-success">Realizado</p><p className="break-words text-base font-semibold tabular-nums">{realized}</p></div>
    </div>
  </article>;
}

const STAGES: { key: FunnelKey; label: string }[] = [
  { key: "leads", label: "Leads totais" }, { key: "qualified", label: "Leads qualificados" },
  { key: "meetings", label: "Reuniões realizadas" }, { key: "clients", label: "Clientes fechados" },
];

export function CommercialGoalsDashboard({ data: d, crm, notes, plan, month }: Props) {
  const today = todaySP();
  const daysLeft = month ? businessDaysLeft(month, today) : 0;
  const proj = projections(d.goals);
  const funnel = resolveFunnel(d, crm);
  const rates = funnelRates(funnel.value, d.actual.adSpend);
  const base = { extraCommercial: d.actual.extraCommercial, taxes: d.actual.taxes, fees: d.actual.fees };
  const projected = contractResult({ ...base, contracts: proj.contractsTotal, media: d.goals.budget, serviceTotal: proj.serviceTotal, clients: d.goals.clients });
  const realService = realizedServiceTotal(funnel.value.clients, d.goals.serviceCost);
  const actual = contractResult({ ...base, contracts: d.actual.contractsValue, media: d.actual.adSpend, serviceTotal: realService, clients: funnel.value.clients });
  const taxesFees = sumOrNull(d.actual.taxes, d.actual.fees);
  // Funnel targets: explicit target first; qualified falls back to the budget projection; clients to the client goal.
  const target = (k: FunnelKey) => d.funnel.target[k] ?? (k === "qualified" ? proj.qualified : k === "clients" ? d.goals.clients : null);
  const maxBase = Math.max(1, ...STAGES.map((s) => Math.max(funnel.value[s.key] ?? 0, target(s.key) ?? 0)));

  const goalsVsActual: { label: string; goal: number | null; actual: number | null; fmt: (v: number | null) => string; lower?: boolean }[] = [
    { label: "Faturamento contratado", goal: proj.contractsTotal, actual: d.actual.contractsValue, fmt: brl },
    { label: "Clientes fechados", goal: d.goals.clients, actual: funnel.value.clients, fmt: count },
    { label: "Leads qualificados", goal: target("qualified"), actual: funnel.value.qualified, fmt: (v) => (v == null ? "Não informado" : dec(v)) },
    { label: "Leads totais", goal: target("leads"), actual: funnel.value.leads, fmt: count },
    { label: "Reuniões realizadas", goal: target("meetings"), actual: funnel.value.meetings, fmt: count },
    { label: "Investimento em anúncios", goal: d.goals.budget, actual: d.actual.adSpend, fmt: brl, lower: true },
  ];

  return <div className="space-y-10">
    <Section title="Indicadores principais" subtitle={`Projeção do mês · contratos de ${count(d.goals.duration)} meses`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi accent icon={Target} title="Meta de faturamento" value={brl(proj.contractsTotal)} detail={`${count(d.goals.clients)} × ${brl(d.goals.contract)}`} />
        <Kpi icon={Megaphone} title="Investimento previsto em anúncios" value={brl(d.goals.budget)} detail={`Custo por qualificado: ${brl(d.goals.cplQ)}`} />
        <Kpi icon={Users} title="Clientes a fechar" value={count(d.goals.clients)} detail={`Conversão necessária: ${pct(proj.conversion)}`} />
        <Kpi icon={Wallet} title="Saldo estimado" value={money(projected.balance)} detail={projected.missing.length ? `Antes de ${projected.missing.join(", ")}` : "Período completo dos contratos"} />
        <Kpi icon={Percent} title="Margem estimada" value={pct(projected.margin)} detail="Saldo ÷ faturamento" />
        <Kpi icon={Calculator} title="CAC projetado" value={money(projected.cac)} detail={projected.cacPartial ? "Parcial: só mídia" : "Mídia + custos comerciais"} />
      </div>
    </Section>

    <Section title="Funil comercial" subtitle="Leads que entraram no mês neste funil. Reuniões contam apenas as realizadas (registro manual), não as agendadas.">
      <div className="space-y-2 rounded-xl border bg-card p-4">
        {STAGES.map((s, i) => {
          const v = funnel.value[s.key], t = target(s.key), prev = i > 0 ? funnel.value[STAGES[i - 1].key] : null;
          const conv = i > 0 ? div(v, prev) : null;
          return <div key={s.key}>
            {i > 0 && <p className="flex items-center gap-1 py-1 pl-2 text-xs text-muted-foreground"><ArrowRight className="size-3" />Conversão: <strong className="text-foreground">{pct(conv)}</strong></p>}
            <div className="grid items-center gap-3 sm:grid-cols-[11rem_1fr_9rem]">
              <div><p className="text-sm font-medium">{s.label}</p><Badge variant="outline" className="mt-1 text-[10px]">{funnel.origin[s.key]}</Badge></div>
              <div className="space-y-1">
                <div className="h-7 overflow-hidden rounded-md bg-muted"><div className="flex h-full items-center rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground" style={{ width: `${Math.max(4, ((v ?? 0) / maxBase) * 100)}%` }}>{v == null ? "" : dec(v, 0)}</div></div>
                {t != null && <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-muted-foreground/40" style={{ width: `${(t / maxBase) * 100}%` }} /></div>}
              </div>
              <p className="text-sm tabular-nums sm:text-right"><span className="font-semibold">{count(v)}</span><span className="text-muted-foreground"> / meta {t == null ? "—" : dec(t, 0)}</span></p>
            </div>
          </div>;
        })}
        <p className="pt-2 text-xs text-muted-foreground">Barra cheia: realizado · linha fina: meta.</p>
      </div>
    </Section>

    <Section title="Indicadores financeiros" subtitle="Projetado usa as premissas configuradas; realizado usa somente valores registrados. Saldo não é lucro líquido.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <FinCard label="Investimento em anúncios" projected={brl(d.goals.budget)} realized={brl(d.actual.adSpend)} />
        <FinCard label="Valor dos contratos vendidos" projected={brl(proj.contractsTotal)} realized={brl(d.actual.contractsValue)} />
        <FinCard label="Custo por lead" projected="—" realized={money(rates.cpl)} />
        <FinCard label="Custo por lead qualificado" projected={brl(d.goals.cplQ)} realized={money(rates.cplQualified)} />
        <FinCard label="CAC de mídia" projected={money(proj.mediaPerSale)} realized={money(rates.mediaPerSale)} />
        <FinCard label="Custo de atendimento (contrato)" projected={brl(proj.serviceTotal)} realized={money(realService)} />
        <FinCard label="Impostos e taxas" projected={brl(taxesFees)} realized={brl(taxesFees)} />
        <FinCard label="Saldo" projected={money(projected.balance)} realized={money(actual.balance)} />
        <FinCard label="Margem" projected={pct(projected.margin)} realized={pct(actual.margin)} />
        <FinCard realizedOnly label="Caixa efetivamente recebido" realized={brl(d.cash.received)} />
      </div>
      <p className="text-xs text-muted-foreground">Atendimento: {count(d.goals.clients)} clientes × {brl(d.goals.serviceCost)} por contrato completo = {brl(proj.serviceTotal)} (contado uma única vez).{!d.goals.serviceValidated ? " Valor ainda não validado." : ""}</p>
    </Section>

    <Section title="Metas x realizado" subtitle="Realizado vem do CRM ou de registro manual; nunca é preenchido com a projeção.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {goalsVsActual.map((r) => {
          const ratio = div(r.actual, r.goal);
          return <article key={r.label} className="rounded-xl border bg-card p-4">
            <div className="flex items-baseline justify-between gap-2"><h3 className="text-sm font-medium">{r.label}</h3><strong className="text-sm tabular-nums">{pct(ratio)}</strong></div>
            <Progress className="mt-3 h-2" value={ratio == null ? 0 : Math.min(100, ratio * 100)} />
            <p className="mt-2 text-xs text-muted-foreground">Realizado {r.fmt(r.actual)} · Meta {r.fmt(r.goal)}{r.lower ? " · menor é melhor" : ""}</p>
            {/* Ritmo necessário: quanto falta e quanto precisa por dia útil até o fim do mês. */}
            {!r.lower && r.goal != null && r.actual != null && r.goal > r.actual && daysLeft > 0 && <p className="mt-1 text-xs font-medium text-primary">Faltam {r.fmt(r.goal - r.actual)} em {daysLeft} dias úteis ≈ {r.fmt((r.goal - r.actual) / daysLeft)} por dia</p>}
            {!r.lower && r.goal != null && r.actual != null && r.goal > 0 && r.actual >= r.goal && <p className="mt-1 text-xs font-medium text-success">Meta atingida</p>}
          </article>;
        })}
      </div>
    </Section>

    <section className="grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border bg-card p-4"><h3 className="mb-2 font-semibold">Observações</h3><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{notes || "Não informado"}</p></div>
      <div className="rounded-xl border bg-card p-4"><h3 className="mb-2 font-semibold">Plano de ação</h3><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{plan || "Não informado"}</p></div>
    </section>
  </div>;
}
