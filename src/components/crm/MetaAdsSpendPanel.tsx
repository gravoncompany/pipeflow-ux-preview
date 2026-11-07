import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { CheckCircle2, Link2, PlugZap, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getMetaAdSpend, getMetaAdsSetup, importMetaAdSpendNow, linkMetaAdAccount, setMetaAdSync, testMetaAdAccount, unlinkMetaAdAccount } from "@/lib/meta-ads-spend.functions";
import { aggregateSpend, periodRange, saoPauloToday, type PeriodKey } from "@/lib/meta-ads-spend";

const PERIODS: [PeriodKey, string][] = [["7d", "7 dias"], ["30d", "30 dias"], ["month", "Mês atual"], ["custom", "Personalizado"]];
const money = (cents: number, currency: string) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: currency || "BRL" });
const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const when = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "nunca");

export function MetaAdsSpendPanel() {
  const setupFn = useServerFn(getMetaAdsSetup); const spendFn = useServerFn(getMetaAdSpend);
  const setup = useQuery({ queryKey: ["meta-ads-setup"], queryFn: () => setupFn(), retry: false });
  const [ownerKey, setOwnerKey] = useState("gravon");
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const today = saoPauloToday();
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const range = period === "custom" && from && to && from <= to ? { from, to } : periodRange(period === "custom" ? "30d" : period, today);
  const owner = ownerKey === "gravon" ? { kind: "gravon" as const } : { kind: "client" as const, clientId: ownerKey };
  const spend = useQuery({ queryKey: ["meta-ads-spend", ownerKey, range.from, range.to], queryFn: () => spendFn({ data: { owner, from: range.from, to: range.to } }), retry: false });
  const clients = setup.data?.clients ?? [];

  const currencies = useMemo(() => [...new Set((spend.data?.rows ?? []).map((r) => r.currency))], [spend.data]);
  const [currencyPick, setCurrencyPick] = useState("");
  const currency = currencies.includes(currencyPick) ? currencyPick : currencies[0] ?? "BRL";
  const agg = useMemo(() => aggregateSpend((spend.data?.rows ?? []).filter((r) => r.currency === currency), range.from, range.to), [spend.data, currency, range.from, range.to]);
  const [open, setOpen] = useState<string | null>(null);
  const linked = spend.data?.accounts.filter((a) => a.active) ?? [];

  return <section className="space-y-8">
    <div>
      <h2 className="text-lg font-semibold">Investimento em tráfego pago · Meta Ads</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Valores lidos da Meta por campanha e conjunto de anúncios, separados por empresa. Este painel é informativo: não cria despesas e não soma com as cobranças do banco (Open Finance).</p>
    </div>

    <div className="flex flex-wrap items-end gap-4">
      <div className="grid gap-1.5"><Label>Empresa</Label>
        <Select value={ownerKey} onValueChange={setOwnerKey}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="gravon">Gravon</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.trade_name}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1.5"><Label>Período</Label>
        <div className="flex flex-wrap gap-1">{PERIODS.map(([k, l]) => <Button key={k} size="sm" variant={period === k ? "default" : "outline"} onClick={() => setPeriod(k)}>{l}</Button>)}</div></div>
      {period === "custom" && <>
        <div className="grid gap-1.5"><Label htmlFor="ads-from">De</Label><Input id="ads-from" type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div className="grid gap-1.5"><Label htmlFor="ads-to">Até</Label><Input id="ads-to" type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
      </>}
      {currencies.length > 1 && <div className="grid gap-1.5"><Label>Moeda</Label><Select value={currency} onValueChange={setCurrencyPick}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>}
    </div>

    {spend.isError ? <p className="text-sm text-destructive">{spend.error instanceof Error ? spend.error.message : "Não foi possível ler o investimento."}</p>
      : !spend.data ? <p className="text-sm text-muted-foreground">Carregando…</p>
      : linked.length === 0 ? <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Nenhuma conta de anúncios vinculada a esta empresa. Vincule uma conta abaixo.</p>
      : <>
        <div className="grid gap-4 sm:grid-cols-3">
          <Kpi label="Investimento total" value={money(agg.totalCents, currency)} detail={`${day(range.from)} a ${day(range.to)}`} />
          <Kpi label="Média diária" value={money(agg.dailyAverageCents, currency)} detail={`${agg.days.length} dias`} />
          <Kpi label="Última importação" value={when(linked.map((a) => a.last_sync_at).filter(Boolean).sort().at(-1) ?? null)} detail={linked.some((a) => !a.sync_enabled) ? "Há contas com importação desligada" : undefined} />
        </div>
        <div className="h-72 rounded-lg border bg-card p-4" aria-label="Evolução dos gastos">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={agg.days.map((d) => ({ dia: day(d.date), Investimento: d.cents / 100 }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="dia" minTickGap={16} /><YAxis tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} width={70} />
              <Tooltip formatter={(v) => money(Number(v) * 100, currency)} />
              <Area dataKey="Investimento" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-lg border bg-card">
          <h3 className="border-b px-4 py-3 text-sm font-semibold">Campanhas e conjuntos de anúncios</h3>
          {agg.campaigns.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Sem investimento no período.</p>
            : <ul className="divide-y">{agg.campaigns.map((c) => <li key={c.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/50" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                <span className="min-w-0 truncate font-medium">{c.name || c.id}</span><span className="shrink-0 tabular-nums">{money(c.cents, currency)}</span></button>
              {open === c.id && <ul className="bg-muted/30 pb-2">{c.adsets.map((a) => <li key={a.id} className="flex justify-between gap-3 px-8 py-1.5 text-xs"><span className="min-w-0 truncate text-muted-foreground">{a.name || a.id}</span><span className="shrink-0 tabular-nums">{money(a.cents, currency)}</span></li>)}</ul>}
            </li>)}</ul>}
        </div>
      </>}

    <AccountsManager />
  </section>;
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>;
}

function AccountsManager() {
  const setupFn = useServerFn(getMetaAdsSetup); const link = useServerFn(linkMetaAdAccount); const test = useServerFn(testMetaAdAccount);
  const sync = useServerFn(setMetaAdSync); const importNow = useServerFn(importMetaAdSpendNow); const unlink = useServerFn(unlinkMetaAdAccount);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["meta-ads-setup"], queryFn: () => setupFn(), retry: false });
  const [pick, setPick] = useState(""); const [owner, setOwner] = useState("gravon"); const [busy, setBusy] = useState("");
  const d = q.data;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["meta-ads-setup"] }), qc.invalidateQueries({ queryKey: ["meta-ads-spend"] })]);
  async function run(key: string, fn: () => Promise<string>) {
    if (busy) return; setBusy(key);
    try { toast.success(await fn()); } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível concluir."); } finally { setBusy(""); await refresh(); }
  }
  if (!d) return null;
  const ownerName = (a: { owner_kind: string; client_id: string | null }) => a.owner_kind === "gravon" ? "Gravon" : d.clients.find((c) => c.id === a.client_id)?.trade_name ?? "Cliente";
  const free = d.discovered.filter((x) => !d.accounts.some((a) => a.ad_account_id === x.id));

  return <section className="border-t pt-6">
    <h3 className="font-semibold">Contas de anúncios da Meta</h3>
    <p className="mt-1 text-sm text-muted-foreground">Cada conta pertence a uma única empresa. Teste a conexão antes de ativar a importação; com ela ligada, os últimos 30 dias são atualizados uma vez por dia.</p>
    {!d.admin && <p className="mt-3 text-sm text-muted-foreground">Entre com sua conta administrativa para vincular, testar ou ativar contas.</p>}
    {d.discoveryFailure && <p className="mt-3 text-sm text-destructive">{d.discoveryFailure}</p>}
    <ul className="mt-4 space-y-3">{d.accounts.map((a) => <li key={a.id} className="rounded-lg border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-medium">{a.account_name || a.ad_account_id} <span className="font-normal text-muted-foreground">· {ownerName(a)} · {a.currency || "moeda ?"}</span></p>
          <p className="mt-1 text-xs text-muted-foreground">Teste: {a.last_test_at ? `${when(a.last_test_at)} · ${a.last_test_ok ? "ok" : "falhou"}` : "não testada"} · Importação: {a.last_sync_at ? `${when(a.last_sync_at)} · ${a.last_sync_status === "ok" ? "ok" : "falhou"}` : "nunca"}</p>
          {(a.testFailure || a.syncFailure) && <p className="mt-1 text-xs text-destructive">{a.syncFailure ?? a.testFailure}</p>}</div>
        {d.admin && <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run(`t${a.id}`, async () => { const r = await test({ data: { id: a.id } }); if (!r.ok) throw new Error(r.failure ?? "O teste falhou."); return `Conexão ok. Últimos 7 dias: ${r.last7Cents === null ? "—" : money(r.last7Cents, r.currency ?? "BRL")}.`; })}><PlugZap />Testar</Button>
          <div className="flex items-center gap-2"><Switch id={`sync-${a.id}`} checked={a.sync_enabled} disabled={Boolean(busy) || (!a.sync_enabled && !a.last_test_ok)} onCheckedChange={(v) => void run(`s${a.id}`, async () => { const r = await sync({ data: { id: a.id, enabled: v, revision: a.revision } }); if (r.failure) throw new Error(`Importação ativada, mas a primeira leitura falhou: ${r.failure}`); return v ? `Importação ativada: ${r.imported} registros diários importados.` : "Importação desligada."; })} /><Label htmlFor={`sync-${a.id}`}>Importação automática</Label></div>
          {a.sync_enabled && <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void run(`i${a.id}`, async () => { const r = await importNow({ data: { id: a.id } }); if (!r.ok) throw new Error(r.failure ?? "Falhou."); return `${r.imported} registros diários atualizados.`; })}><RefreshCw />Importar agora</Button>}
          <Button size="sm" variant="ghost" className="text-destructive" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Desvincular esta conta? A importação para; o histórico já importado continua nesta empresa.")) void run(`u${a.id}`, async () => { await unlink({ data: { id: a.id, revision: a.revision } }); return "Conta desvinculada."; }); }}><Unlink />Desvincular</Button>
        </div>}
      </div>
      {a.sync_enabled && <p className="mt-2 flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3" />Importação diária ativa</p>}
    </li>)}</ul>
    {d.admin && <div className="mt-4 flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5"><Label>Conta de anúncios</Label>
        <Select value={pick} onValueChange={setPick}><SelectTrigger className="w-72"><SelectValue placeholder={free.length ? "Escolha uma conta" : "Nenhuma conta livre na conexão"} /></SelectTrigger>
          <SelectContent>{free.map((x) => <SelectItem key={x.id} value={x.id}>{x.name || x.id} · {x.currency}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1.5"><Label>Empresa</Label>
        <Select value={owner} onValueChange={setOwner}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="gravon">Gravon</SelectItem>{d.clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.trade_name}</SelectItem>)}</SelectContent></Select></div>
      <Button disabled={!pick || Boolean(busy)} onClick={() => void run("link", async () => { await link({ data: { adAccountId: pick, owner: owner === "gravon" ? { kind: "gravon" } : { kind: "client", clientId: owner } } }); setPick(""); return "Conta vinculada. Agora teste a conexão."; })}><Link2 />Vincular</Button>
    </div>}
    {d.admin && <p className="mt-3 text-xs text-muted-foreground">Contas de clientes aparecem aqui quando estão liberadas na conexão com a Meta (Gerenciador de Negócios da Gravon).</p>}
  </section>;
}
