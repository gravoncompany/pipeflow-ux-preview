import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Copy, Download, FileSpreadsheet, Landmark, Plus, RefreshCw, Settings2, Sparkles, Wallet } from "lucide-react";
import { getReceiptControl } from "@/lib/receipt-control.functions";
import { autoReconcileBankReceipts, reconcileBankReceipt } from "@/lib/polp.functions";
import { receiptRows, receiptSummary, RECEIPT_LABELS, type ReceiptRow, type ReceiptStatus } from "@/lib/receipt-control";
import { receiptActionQueue, receiptAging, AGING_BUCKETS, type QueueItem } from "@/lib/receipt-insights";
import { dateBR } from "@/lib/ux-format";
import { todaySP } from "@/lib/finance-management";
import { currency } from "@/lib/revenue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CrmAuthGate } from "./CrmAuthGate";
import { ReceiptScheduleDialog } from "./ReceiptScheduleDialog";
import { ReceiptDetailDialog } from "./ReceiptDetailDialog";
import { ReceiptStatusLabel } from "./ReceiptStatus";
import { ReceiptMonthTable } from "./ReceiptMonthTable";
import { ReceiptYearTable } from "./ReceiptYearTable";
import { ReceiptOrganizeDialog } from "./ReceiptOrganizeDialog";
import { ReceiptImportDialog } from "./ReceiptImportDialog";
import { KpiCard } from "./ux/KpiCard";
import { StatusPill } from "./ux/StatusPill";
import { useConfirm } from "./ux/ConfirmDialog";
import { toast } from "sonner";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const money = (cents: number) => currency(cents / 100);
export type ReceiptTab = "anual" | "mes" | "conciliacao" | "configuracoes" | "relatorio";
export type ReceiptSearch = { cliente?: string; situacao?: ReceiptStatus; q?: string; ano?: number; mes?: number; aba?: ReceiptTab };
const TABS: readonly ReceiptTab[] = ["anual", "mes", "conciliacao", "configuracoes", "relatorio"];

/** Filtros do Controle de Recebimentos na URL, para salvar e compartilhar uma visão (ex.: atrasados de novembro). */
export function parseReceiptSearch(s: Record<string, unknown>): ReceiptSearch {
  const num = (v: unknown, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : undefined; };
  return {
    cliente: typeof s.cliente === "string" && /^[0-9a-f-]{36}$/i.test(s.cliente) ? s.cliente : undefined,
    situacao: typeof s.situacao === "string" && s.situacao in RECEIPT_LABELS ? (s.situacao as ReceiptStatus) : undefined,
    q: typeof s.q === "string" && s.q.trim() ? s.q.slice(0, 120) : undefined,
    ano: num(s.ano, 2020, 2100),
    mes: num(s.mes, 1, 12),
    aba: typeof s.aba === "string" && (TABS as readonly string[]).includes(s.aba) ? (s.aba as ReceiptTab) : undefined,
  };
}

function reminderText(name: string, row: ReceiptRow) {
  return `Olá, ${name}! Tudo bem? Passando para lembrar da cobrança "${row.description}" com vencimento em ${dateBR(row.due_date)}, no valor de ${money(row.remaining)}. Se já realizou o pagamento, por favor desconsidere e nos envie o comprovante. Obrigado!`;
}

function exportCsv(rows: ReceiptRow[], names: Map<string, string>, label: string) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const br = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const lines = [["Cliente", "Descrição", "Recorrência", "Vencimento", "Valor", "Recebido", "Saldo", "Situação"].join(";"),
    ...rows.map((r) => [esc(names.get(r.client_id) ?? "Cliente"), esc(r.description), r.recurrence, dateBR(r.due_date), br(r.amountCents), br(r.received), br(r.remaining), RECEIPT_LABELS[r.statusLabel]].join(";"))];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `recebimentos-${label}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReceiptControl({ initialClient, search: urlSearch }: { initialClient?: string; search?: ReceiptSearch }) {
  const read = useServerFn(getReceiptControl), auto = useServerFn(autoReconcileBankReceipts), reconcile = useServerFn(reconcileBankReceipt), qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  // Atualiza ao voltar para a janela, sem recarregar a tela enquanto o usuário confere valores.
  const q = useQuery({ queryKey: ["receipt-control"], queryFn: () => read(), retry: false, refetchOnWindowFocus: true, staleTime: 20_000 });
  const today = todaySP();
  const params: ReceiptSearch = { ...urlSearch, cliente: urlSearch?.cliente ?? initialClient };
  const year = params.ano ?? Number(today.slice(0, 4));
  const month = params.mes ?? Number(today.slice(5, 7));
  const client = params.cliente ?? "all";
  const search = params.q ?? "";
  const status = params.situacao ?? "all";
  const tab: ReceiptTab = params.aba ?? "anual";
  const setParams = (patch: Partial<ReceiptSearch>) => void navigate({ to: "/financeiro/recebimentos", search: (prev: ReceiptSearch) => ({ ...prev, ...patch }), replace: true } as never);
  const [configureClient, setConfigureClient] = useState("");
  const [yearDraft, setYearDraft] = useState<string | null>(null);
  const [config, setConfig] = useState<string | null>(null), [detail, setDetail] = useState<string | null>(null), [notice, setNotice] = useState(""), [organize, setOrganize] = useState(false), [importing, setImporting] = useState(false);
  const mutation = useMutation({
    mutationFn: async (action: { kind: "auto" } | { kind: "manual"; transactionId: string; chargeId: string; accountId: string }) => {
      if (action.kind === "auto") { const r = await auto({ data: { confirmed: true } }); if (!r.ok) throw new Error(r.error); setNotice(`${r.reconciled} conciliado(s) · ${r.reviewed} analisado(s)${r.needsAccount ? " · selecione uma conta financeira na revisão manual" : ""}`); }
      else { const r = await reconcile({ data: { transactionId: action.transactionId, target: { type: "client_charge", id: action.chargeId }, accountId: action.accountId, confirmed: true } }); if (!r.ok) throw new Error(r.error); setNotice("Recebimento conciliado."); }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receipt-control"] }),
  });
  const waiting = useMemo(() => new Set(q.data?.bank.map((b) => b.clientId) ?? []), [q.data]);
  const allRows = useMemo(() => receiptRows(q.data?.charges ?? [], q.data?.payments ?? [], waiting), [q.data, waiting]);
  const names = useMemo(() => new Map(q.data?.clients.map((c) => [c.id, c.trade_name])), [q.data]);
  if (q.isError) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const yearRange = { start: `${year}-01-01`, end: `${year}-12-31` };
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const matches = (r: ReceiptRow) => (client === "all" || r.client_id === client) && (!search || `${names.get(r.client_id)} ${r.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const scoped = allRows.filter(matches);
  const filtered = scoped.filter((r) => status === "all" || r.statusLabel === status);
  const yearRows = filtered.filter((r) => r.due_date >= yearRange.start && r.due_date <= yearRange.end);
  const monthRows = filtered.filter((r) => r.due_date.startsWith(`${monthKey}-`));
  const periodRows = tab === "mes" ? monthRows : yearRows;
  const summary = receiptSummary(periodRows);
  const queue = receiptActionQueue(scoped, today);
  const aging = receiptAging(scoped, today);
  const selectedRow = allRows.find((r) => r.id === detail);
  const shift = (dir: number) => { const d = new Date(Date.UTC(year, month - 1 + dir, 1)); setParams({ ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 }); };
  const data = q.data;
  const bankPending = data?.bank.filter((b) => (client === "all" || b.clientId === client) && b.date >= yearRange.start && b.date <= yearRange.end) ?? [];
  const schedules = data?.schedules.filter((s) => client === "all" || s.client_id === client) ?? [];
  const periodLabel = tab === "mes" ? `${MONTHS[month - 1]}/${year}` : String(year);
  const toggleStatus = (s: ReceiptStatus) => setParams({ situacao: status === s ? undefined : s });
  const copyReminder = async (item: QueueItem) => {
    try { await navigator.clipboard.writeText(reminderText(names.get(item.row.client_id) ?? "", item.row)); toast.success("Lembrete copiado. Cole na conversa do cliente para enviar."); }
    catch { toast.error("Não foi possível copiar o lembrete."); }
  };
  return (
    <main className="min-w-0 flex-1 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Wallet className="size-6 text-primary" />Controle de Recebimentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">O que cobrar hoje, o que entrou e o que falta conciliar · {client !== "all" ? <>cliente <strong>{names.get(client) ?? "selecionado"}</strong> · </> : null}período {periodLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="icon" title={`Atualizar recebimentos${q.dataUpdatedAt ? ` · atualizado às ${new Date(q.dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}`} aria-label="Atualizar recebimentos" onClick={() => void q.refetch()}><RefreshCw className={q.isFetching ? "animate-spin size-4" : "size-4"} /></Button>
          <Button variant="outline" disabled={!data} onClick={() => setOrganize(true)}><Sparkles className="size-4" />Organizar com Pipeflow IA</Button>
          <Button variant="outline" disabled={!data} onClick={() => setImporting(true)}><FileSpreadsheet className="size-4" />Importar planilha</Button>
          <Button variant="outline" disabled={!data || !periodRows.length} onClick={() => exportCsv(periodRows, names, periodLabel.replace("/", "-"))}><Download className="size-4" />Exportar</Button>
          <Button onClick={() => { setConfigureClient(client === "all" ? "" : client); setConfig("new"); }} disabled={!data}><Plus className="size-4" />Configurar recebimento</Button>
        </div>
      </header>

      {!data ? <ReceiptSkeleton /> : (
        <>
          {/* Fila do dia: o que precisa de ação agora, independente da aba. */}
          <section aria-label="O que fazer hoje" className="grid gap-3 py-5 lg:grid-cols-3">
            <QueueColumn tone="danger" icon={<AlertTriangle className="size-4" />} title="Atrasados" total={queue.totals.overdue} items={queue.overdue} names={names} empty="Nenhuma cobrança atrasada."
              badge={(i) => <StatusPill tone="danger">{i.days} {i.days === 1 ? "dia" : "dias"}</StatusPill>} onOpen={(i) => setDetail(i.row.id)} onReminder={copyReminder} />
            <QueueColumn tone="warning" icon={<CalendarClock className="size-4" />} title="Vencem em 7 dias" total={queue.totals.dueSoon} items={queue.dueSoon} names={names} empty="Nada vencendo nos próximos 7 dias."
              badge={(i) => <StatusPill tone="warning">{i.days === 0 ? "hoje" : i.days === 1 ? "amanhã" : `em ${i.days} dias`}</StatusPill>} onOpen={(i) => setDetail(i.row.id)} onReminder={copyReminder} />
            <QueueColumn tone="neutral" icon={<Landmark className="size-4" />} title="Aguardando conciliação" total={queue.totals.reconciling} items={queue.reconciling} names={names} empty="Nenhum recebimento aguardando conciliação."
              badge={() => <StatusPill tone="neutral">banco</StatusPill>} onOpen={() => setParams({ aba: "conciliacao" })} actionLabel="Conciliar" />
          </section>

          <div className="grid grid-cols-2 gap-3 pb-5 xl:grid-cols-5">
            <KpiCard label={`Previsto · ${periodLabel}`} value={money(summary.expected)} tone="primary" active={status === "all"} onClick={() => setParams({ situacao: undefined })} />
            <KpiCard label="Recebido" value={money(summary.received)} tone="success" active={status === "pago"} onClick={() => toggleStatus("pago")} hint="Clique para filtrar" />
            <KpiCard label="Pendente" value={money(summary.pending)} tone="warning" active={status === "pendente"} onClick={() => toggleStatus("pendente")} hint="Clique para filtrar" />
            <KpiCard label="Atrasado" value={money(summary.overdue)} tone="danger" active={status === "atrasado"} onClick={() => toggleStatus("atrasado")} hint="Clique para filtrar" />
            <KpiCard label="Realizado" value={`${summary.percent.toLocaleString("pt-BR")}%`} hint={<span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-success" style={{ width: `${Math.min(100, summary.percent)}%` }} /></span>} />
          </div>

          <div className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-2 border-y bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
            <Input className="w-24" aria-label="Ano dos recebimentos" type="number" min={2020} max={2100} value={yearDraft ?? String(year)}
              onChange={(e) => setYearDraft(e.target.value)} onBlur={() => { const n = Number(yearDraft); if (yearDraft !== null && Number.isInteger(n) && n >= 2020 && n <= 2100) setParams({ ano: n }); setYearDraft(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            {tab === "mes" && <>
              <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => shift(-1)}><ChevronLeft /></Button>
              <Select value={String(month)} onValueChange={(v) => setParams({ mes: Number(v) })}><SelectTrigger className="w-24" aria-label="Mês"><SelectValue /></SelectTrigger><SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent></Select>
              <Button variant="outline" size="icon" aria-label="Próximo mês" onClick={() => shift(1)}><ChevronRight /></Button>
            </>}
            <Input className="min-w-40 flex-1" placeholder="Buscar cliente ou cobrança" aria-label="Buscar cliente ou cobrança" value={search} onChange={(e) => setParams({ q: e.target.value || undefined })} />
            <Select value={client} onValueChange={(v) => setParams({ cliente: v === "all" ? undefined : v })}><SelectTrigger className="w-48" aria-label="Filtrar cliente"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os clientes</SelectItem>{data.clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.trade_name}</SelectItem>)}</SelectContent></Select>
            <Select value={status} onValueChange={(v) => setParams({ situacao: v === "all" ? undefined : (v as ReceiptStatus) })}><SelectTrigger className="w-48" aria-label="Situação"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as situações</SelectItem>{Object.entries(RECEIPT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
            {(client !== "all" || status !== "all" || search) && <Button variant="ghost" onClick={() => setParams({ cliente: undefined, situacao: undefined, q: undefined })}>Limpar filtros</Button>}
          </div>

          {data.rosterError && <p role="alert" className="py-2 text-sm text-destructive">{data.rosterError}</p>}

          <Tabs value={tab} onValueChange={(v) => setParams({ aba: v === "anual" ? undefined : (v as ReceiptTab) })} className="mt-4">
            <div className="overflow-x-auto border-b">
              <TabsList className="h-auto min-w-max justify-start rounded-none bg-transparent p-0">
                {([["anual", `Visão anual · ${year}`], ["mes", `Quinzenais e semanais · ${MONTHS[month - 1]}`], ["conciliacao", `Conciliação${bankPending.length ? ` (${bankPending.length})` : ""}`], ["relatorio", "Aging e relatório"], ["configuracoes", `Configurações (${schedules.length})`]] as const).map(([v, l]) => (
                  <TabsTrigger key={v} value={v} className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none">{l}</TabsTrigger>
                ))}
              </TabsList>
            </div>
            {(tab === "anual" || tab === "mes") && <div className="flex flex-wrap gap-4 py-3">{Object.keys(RECEIPT_LABELS).map((k) => <ReceiptStatusLabel key={k} status={k as ReceiptStatus} />)}</div>}

            <TabsContent value="anual" className="mt-0">
              <ReceiptYearTable title="Clientes mensais" recurrence="mensal" year={year} allRows={allRows} rows={filtered} names={names} onDetail={setDetail} roster={data.roster.filter((s) => s.frequency === "mensal")} clients={data.clients} search={search} clientFilter={client} statusFilter={status} onConfigure={(id) => { setConfigureClient(id); setConfig("new"); }} />
              <ReceiptYearTable title="Demais clientes da planilha" recurrence="outros" year={year} allRows={allRows} rows={filtered} names={names} onDetail={setDetail} roster={data.roster.filter((s) => s.frequency !== "mensal")} clients={data.clients} search={search} clientFilter={client} statusFilter={status} onConfigure={(id) => { setConfigureClient(id); setConfig("new"); }} />
            </TabsContent>

            <TabsContent value="mes" className="mt-0">
              <ReceiptMonthTable title="Clientes quinzenais" recurrence="quinzenal" month={monthKey} allRows={allRows} rows={filtered} names={names} onDetail={setDetail} />
              <ReceiptMonthTable title="Clientes semanais" recurrence="semanal" month={monthKey} allRows={allRows} rows={filtered} names={names} onDetail={setDetail} />
              {filtered.some((r) => !["mensal", "quinzenal", "semanal"].includes(r.recurrence)) && (
                <section className="border-t py-5">
                  <h2 className="mb-3 text-lg font-semibold">Outras cobranças <span className="text-sm font-normal text-muted-foreground">· incluídas no resumo anual</span></h2>
                  <div className="divide-y rounded-md border">
                    {filtered.filter((r) => !["mensal", "quinzenal", "semanal"].includes(r.recurrence)).sort((a, b) => a.due_date.localeCompare(b.due_date)).map((r) => (
                      <button type="button" key={r.id} onClick={() => setDetail(r.id)} className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50">
                        <span className="min-w-40 flex-1 font-medium">{names.get(r.client_id)}</span>
                        <span className="text-muted-foreground">{r.description}</span>
                        <span className="tabular-nums">{dateBR(r.due_date)}</span>
                        <span className="w-28 text-right tabular-nums">{money(r.amountCents)}</span>
                        <ReceiptStatusLabel status={r.statusLabel} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </TabsContent>

            <TabsContent value="conciliacao" className="mt-0">
              <section className="py-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div><h2 className="text-lg font-semibold">Conciliação de recebimentos</h2><p className="text-sm text-muted-foreground">Entradas do banco já vinculadas a clientes, esperando a cobrança correspondente.</p></div>
                  <Button variant="outline" disabled={mutation.isPending} onClick={async () => {
                    if (await confirm({ title: "Conciliar correspondências exatas?", description: "Somente correspondências inequívocas do banco serão conciliadas. Nenhum cliente é criado e nenhuma movimentação é alterada.", details: [["Pendentes no período", String(bankPending.length)]], confirmLabel: "Conciliar" })) mutation.mutate({ kind: "auto" });
                  }}><RefreshCw className="size-4" />Conciliar correspondências exatas</Button>
                </div>
                {notice && <p role="status" className="mb-3 text-sm text-primary">{notice}</p>}
                {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
                <div className="divide-y rounded-md border">
                  {bankPending.map((b) => <BankPending key={b.id} bank={b} name={names.get(b.clientId) ?? "Cliente"} rows={allRows.filter((r) => r.client_id === b.clientId && r.remaining >= b.amount)} accounts={data.accounts} busy={mutation.isPending}
                    onConfirm={(chargeId, accountId) => mutation.mutate({ kind: "manual", transactionId: b.id, chargeId, accountId })} />)}
                  {!bankPending.length && <p className="p-4 text-sm text-muted-foreground">Nenhum recebimento vinculado aguardando conciliação.</p>}
                </div>
                <Link to="/financeiro/movimentacoes" className="mt-4 inline-block text-sm text-primary underline">Consultar extrato e revisar vínculos bancários</Link>
              </section>
            </TabsContent>

            <TabsContent value="relatorio" className="mt-0">
              <AgingReport aging={aging} rows={scoped.filter((r) => r.remaining > 0 && r.overdue)} names={names} today={today} onStatus={(s) => setParams({ situacao: s, aba: undefined })} />
            </TabsContent>

            <TabsContent value="configuracoes" className="mt-0">
              <section className="py-5">
                <h2 className="mb-1 text-lg font-semibold">Configurações de recebimentos</h2>
                <p className="mb-4 text-sm text-muted-foreground">Agendas que geram as cobranças. Cobranças existentes permanecem nas tabelas.</p>
                <div className="divide-y rounded-md border">
                  {schedules.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-3 text-sm">
                      <span className="min-w-40 flex-1 font-medium">{names.get(s.client_id)}</span>
                      <span className="text-muted-foreground">{s.config.description}</span>
                      <StatusPill tone="primary" icon={false}>{s.config.frequency === "quinzenal_fixa" ? "Quinzenal · datas fixas" : s.config.frequency}</StatusPill>
                      <span className="w-28 text-right tabular-nums">{money(s.config.amount)}</span>
                      <Button variant="ghost" size="icon" aria-label={`Configurar ${s.config.description}`} onClick={() => setConfig(s.id)}><Settings2 className="size-4" /></Button>
                    </div>
                  ))}
                  {!schedules.length && <p className="p-4 text-sm text-muted-foreground">Nenhuma configuração cadastrada. Cobranças existentes permanecem nas tabelas.</p>}
                </div>
              </section>
            </TabsContent>
          </Tabs>

          <div className="sticky bottom-0 z-20 -mx-4 mt-2 hidden flex-wrap md:flex gap-x-6 gap-y-1 border-t bg-background/95 px-4 py-3 text-sm backdrop-blur md:-mx-8 md:px-8">
            <span className="text-muted-foreground">Totais · {periodLabel}{status !== "all" ? ` · ${RECEIPT_LABELS[status as ReceiptStatus]}` : ""}</span>
            <span>Previsto <strong className="tabular-nums">{money(summary.expected)}</strong></span>
            <span>Recebido <strong className="tabular-nums text-success">{money(summary.received)}</strong></span>
            <span>Pendente <strong className="tabular-nums">{money(summary.pending)}</strong></span>
            <span>Atrasado <strong className="tabular-nums text-destructive">{money(summary.overdue)}</strong></span>
          </div>

          {config && <ReceiptScheduleDialog data={data} initialClient={configureClient} existing={data.schedules.find((s) => s.id === config)} onClose={() => setConfig(null)} />}
          {selectedRow && <ReceiptDetailDialog row={selectedRow} clientName={names.get(selectedRow.client_id)} rows={allRows} accounts={data.accounts} audit={data.audit} onClose={() => setDetail(null)} />}
          {organize && <ReceiptOrganizeDialog schedules={data.schedules} charges={data.charges} names={names} onClose={() => setOrganize(false)} />}
          {importing && <ReceiptImportDialog clients={data.clients} schedules={data.schedules} year={year} onClose={() => setImporting(false)} />}
        </>
      )}
    </main>
  );
}

function ReceiptSkeleton() {
  return (
    <div role="status" aria-label="Carregando recebimentos" className="animate-pulse space-y-4 py-5">
      <div className="grid gap-3 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-40 rounded-lg bg-muted" />)}</div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-lg bg-muted" />)}</div>
      <div className="h-80 rounded-lg bg-muted" />
    </div>
  );
}

function QueueColumn({ title, icon, tone, total, items, names, empty, badge, onOpen, onReminder, actionLabel = "Abrir" }: {
  title: string; icon: React.ReactNode; tone: "danger" | "warning" | "neutral"; total: number; items: QueueItem[]; names: Map<string, string>; empty: string;
  badge: (i: QueueItem) => React.ReactNode; onOpen: (i: QueueItem) => void; onReminder?: (i: QueueItem) => void; actionLabel?: string;
}) {
  const [all, setAll] = useState(false);
  const accent = { danger: "text-destructive", warning: "text-foreground", neutral: "text-muted-foreground" }[tone];
  const bar = { danger: "bg-destructive", warning: "bg-receipt-pending", neutral: "bg-muted-foreground" }[tone];
  const shown = all ? items : items.slice(0, 5);
  return (
    <article className="relative overflow-hidden rounded-lg border bg-card">
      <span className={`absolute inset-x-0 top-0 h-1 ${bar}`} aria-hidden />
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h2 className={`flex items-center gap-2 text-sm font-semibold ${accent}`}>{icon}{title} <span className="font-normal text-muted-foreground">({items.length})</span></h2>
        <span className="text-sm font-semibold tabular-nums">{money(total)}</span>
      </header>
      {items.length === 0 ? <p className="px-4 pb-4 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="divide-y">
          {shown.map((i) => (
            <li key={i.row.id} className="space-y-1.5 px-4 py-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <Link to="/clientes/$id" params={{ id: i.row.client_id }} search={{ aba: undefined }} className="min-w-0 truncate font-medium text-primary hover:underline">{names.get(i.row.client_id) ?? "Cliente"}</Link>
                <span className="shrink-0 font-semibold tabular-nums">{money(i.row.remaining)}</span>
              </div>
              <div className="flex items-center gap-2">
                {badge(i)}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{i.row.description} · venc. {dateBR(i.row.due_date)}</span>
                {onReminder && <Button variant="ghost" size="icon" className="size-7" title="Copiar lembrete de cobrança" aria-label={`Copiar lembrete para ${names.get(i.row.client_id) ?? "cliente"}`} onClick={() => onReminder(i)}><Copy className="size-3.5" /></Button>}
                <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onOpen(i)}>{actionLabel}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > 5 && <button type="button" className="w-full border-t px-4 py-2 text-xs text-primary hover:bg-muted/50" onClick={() => setAll((v) => !v)}>{all ? "Mostrar menos" : `Ver todos (${items.length})`}</button>}
    </article>
  );
}

function AgingReport({ aging, rows, names, today, onStatus }: { aging: ReturnType<typeof receiptAging>; rows: ReceiptRow[]; names: Map<string, string>; today: string; onStatus: (s: ReceiptStatus) => void }) {
  const total = Object.values(aging).reduce((n, b) => n + b.amount, 0);
  const overdueTotal = total - aging.a_vencer.amount;
  const byClient = [...rows.reduce((m, r) => m.set(r.client_id, (m.get(r.client_id) ?? 0) + r.remaining), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const colors: Record<string, string> = { a_vencer: "bg-primary", d1_15: "bg-receipt-pending", d16_30: "bg-receipt-partial", d31_60: "bg-destructive/70", d60: "bg-destructive" };
  return (
    <section className="space-y-6 py-5">
      <div>
        <h2 className="text-lg font-semibold">Aging de recebíveis</h2>
        <p className="text-sm text-muted-foreground">Saldo em aberto por idade do vencimento, em {dateBR(today)}. Inadimplência: <strong className="text-foreground">{total ? Math.round((overdueTotal / total) * 1000) / 10 : 0}%</strong> do saldo em aberto.</p>
      </div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Distribuição do saldo em aberto por idade">
        {AGING_BUCKETS.map((b) => total > 0 && aging[b.key].amount > 0 ? <span key={b.key} className={colors[b.key]} style={{ width: `${(aging[b.key].amount / total) * 100}%` }} title={`${b.label}: ${money(aging[b.key].amount)}`} /> : null)}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {AGING_BUCKETS.map((b) => (
          <article key={b.key} className="rounded-lg border bg-card p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`size-2 rounded-full ${colors[b.key]}`} />{b.label}</p>
            <p className="mt-2 text-lg font-semibold tabular-nums">{money(aging[b.key].amount)}</p>
            <p className="text-xs text-muted-foreground">{aging[b.key].count} cobrança(s)</p>
          </article>
        ))}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Maiores saldos atrasados por cliente</h3><Button variant="link" className="h-auto p-0" onClick={() => onStatus("atrasado")}>Ver na tabela</Button></div>
        {byClient.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum saldo atrasado.</p> : (
          <ol className="divide-y rounded-md border">
            {byClient.slice(0, 10).map(([id, amount]) => (
              <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Link to="/clientes/$id" params={{ id }} search={{ aba: undefined }} className="min-w-0 flex-1 truncate font-medium text-primary hover:underline">{names.get(id) ?? "Cliente"}</Link>
                <span className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-muted sm:block"><span className="block h-full bg-destructive" style={{ width: `${(amount / (byClient[0]?.[1] || 1)) * 100}%` }} /></span>
                <span className="w-28 text-right font-semibold tabular-nums">{money(amount)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function BankPending({ bank, name, rows, accounts, busy, onConfirm }: { bank: { id: string; date: string; amount: number }; name: string; rows: ReceiptRow[]; accounts: { id: string; name: string }[]; busy: boolean; onConfirm: (charge: string, account: string) => void }) {
  const [charge, setCharge] = useState(""), [account, setAccount] = useState(accounts.length === 1 ? accounts[0].id : "");
  const confirm = useConfirm();
  const chosen = rows.find((r) => r.id === charge);
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-3 text-sm">
      <span className="min-w-40 flex-1"><strong>{name}</strong> <span className="text-muted-foreground">· {dateBR(bank.date)} ·</span> <span className="tabular-nums">{money(bank.amount)}</span></span>
      <Select value={charge} onValueChange={setCharge}><SelectTrigger className="w-64" aria-label="Cobrança para conciliar"><SelectValue placeholder="Escolher cobrança" /></SelectTrigger><SelectContent>{rows.map((r) => <SelectItem key={r.id} value={r.id}>{dateBR(r.due_date)} · {r.description} · {money(r.remaining)}</SelectItem>)}</SelectContent></Select>
      <Select value={account} onValueChange={setAccount}><SelectTrigger className="w-40" aria-label="Conta para conciliar"><SelectValue placeholder="Conta" /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
      <Button variant="outline" disabled={busy || !charge || !account} onClick={async () => {
        if (await confirm({ title: "Confirmar vínculo do recebimento?", description: "A entrada do banco será vinculada à cobrança selecionada.", details: [["Cliente", name], ["Entrada no banco", `${dateBR(bank.date)} · ${money(bank.amount)}`], ["Cobrança", chosen ? `${chosen.description} · venc. ${dateBR(chosen.due_date)}` : "—"], ["Conta", accounts.find((a) => a.id === account)?.name ?? "—"]], confirmLabel: "Confirmar vínculo" })) onConfirm(charge, account);
      }}>Confirmar vínculo</Button>
    </div>
  );
}
