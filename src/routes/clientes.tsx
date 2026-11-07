import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, List, MoreHorizontal, Plus, Wallet, X } from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { AtendimentoLayout } from "@/components/crm/AtendimentoLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getClientCardLinks, listClients, saveClient } from "@/lib/crm-clients.functions";
import { getCsOverview } from "@/lib/customer-success.functions";
import { getReceiptControl } from "@/lib/receipt-control.functions";
import { receiptRows } from "@/lib/receipt-control";
import { clientReceiptHealth } from "@/lib/receipt-insights";
import { todaySP } from "@/lib/finance-management";
import { dateBR, daysBetween } from "@/lib/ux-format";
import { currency } from "@/lib/revenue";
import { CS_HEALTH } from "@/lib/customer-success";
import { BulkTaskAnalysis } from "@/components/crm/BulkTaskAnalysis";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientCardAction } from "@/components/crm/ClientCardAction";
import { CLIENT_STATUS } from "@/lib/crm-clients";
import { ClientForm, clientToForm, emptyClientForm, formToInput } from "@/components/crm/ClientForm";
import { clearClientListScroll, parseClientListSearch, readClientListState, saveClientListState, type ClientListSearch, type ClientSort } from "@/lib/client-list-state";
import { KpiCard } from "@/components/crm/ux/KpiCard";
import { ClientsHubTabs } from "@/components/crm/ux/ClientsHubTabs";
import { StatusPill, CLIENT_TONE, type StatusTone } from "@/components/crm/ux/StatusPill";

export const Route = createFileRoute("/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes — PipeFlow CRM" },
      { name: "description", content: "Gestão dos clientes da Gravon Company: cadastro, situação contratual e ficha individual." },
      { property: "og:title", content: "Clientes — PipeFlow CRM" },
      { property: "og:description", content: "Gestão dos clientes da Gravon Company." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: parseClientListSearch,
  component: ClientesPage,
});

const STATUS_PLURAL: Record<string, string> = { ativo: "Ativos", implantacao: "Em implantação", pausado: "Pausados", encerrado: "Encerrados" };
const HEALTH_TONE: Record<string, StatusTone> = { saudavel: "success", atencao: "warning", em_risco: "danger" };
const HEALTH_RANK: Record<string, number> = { em_risco: 0, atencao: 1, saudavel: 2 };
const KPI_TONE: Record<StatusTone, "default" | "success" | "warning" | "danger" | "primary"> = { success: "success", warning: "warning", danger: "danger", primary: "primary", partial: "warning", neutral: "default", muted: "default" };
type Cs = { id: string; health: string | null; mrrCents: number; management?: { contracts?: { renewal: string | null; status: string }[] }; finance?: { overdueCents?: number } };
type Row = Record<string, any> & {
  id: string; trade_name: string; status: string;
  mrr: number | null; nextDue: string | null; nextAmount: number; lastPayment: string | null; daysLate: number; overdue: number;
  health: string | null; renewal: string | null; atRisk: boolean;
};

function ClientesPage() {
  const q = useQuery({ queryKey: ["crm-clients"], queryFn: () => listClients(), retry: false });
  const qc = useQueryClient();
  const cards = useQuery({ queryKey: ["crm-client-card-links"], queryFn: () => getClientCardLinks(), retry: false, enabled: q.isSuccess });
  // Leituras complementares: se o acesso não permitir (ex.: financeiro restrito), as colunas mostram "—".
  const cs = useQuery({ queryKey: ["customer-success"], queryFn: () => getCsOverview(), retry: false, enabled: q.isSuccess, staleTime: 60_000 });
  const readReceipts = useServerFn(getReceiptControl);
  const receipts = useQuery({ queryKey: ["receipt-control"], queryFn: () => readReceipts(), retry: false, enabled: q.isSuccess, staleTime: 60_000, refetchOnWindowFocus: false });
  const linkByClient = new Map((cards.data?.links ?? []).map((l) => [l.clientId, l]));
  const navigate = useNavigate({ from: "/clientes" });
  const save = useServerFn(saveClient);
  const params = Route.useSearch();
  const search = params.q ?? "";
  const status = params.situacao ?? "todos";
  const sort: ClientSort = params.ordem ?? "nome";
  const setParams = (patch: Partial<ClientListSearch>) => void navigate({ search: (prev: ClientListSearch) => ({ ...prev, ...patch }), replace: true });
  const setSearch = (v: string) => setParams({ q: v || undefined });
  const setStatus = (v: string) => setParams({ situacao: v === "todos" ? undefined : v, filtro: undefined });
  // Volta da página do cliente: recupera a posição da lista depois que ela carrega.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !q.data) return;
    restored.current = true;
    const saved = readClientListState();
    if (saved?.scrollY) requestAnimationFrame(() => window.scrollTo(0, saved.scrollY!));
    clearClientListScroll();
  }, [q.data]);
  const rememberList = () => saveClientListState({ ...params, scrollY: window.scrollY });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<typeof emptyClientForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = todaySP();

  const csById = useMemo(() => new Map(((cs.data as { clients?: Cs[] } | undefined)?.clients ?? []).map((c) => [c.id, c])), [cs.data]);
  const finById = useMemo(() => {
    const d = receipts.data;
    if (!d) return null;
    const waiting = new Set(d.bank.map((b) => b.clientId));
    return clientReceiptHealth(receiptRows(d.charges, d.payments, waiting), today);
  }, [receipts.data, today]);

  const rows: Row[] = useMemo(() => ((q.data?.clients ?? []) as Record<string, any>[]).map((c) => {
    const s = csById.get(c.id);
    const f = finById?.get(c.id);
    const renewal = (s?.management?.contracts ?? []).filter((x) => x.status !== "encerrado" && x.renewal).map((x) => x.renewal!).sort()[0] ?? null;
    const daysLate = f?.maxDaysLate ?? 0;
    const overdue = f?.openOverdue ?? s?.finance?.overdueCents ?? 0;
    return {
      ...c, id: c.id, trade_name: c.trade_name, status: c.status,
      mrr: s?.mrrCents ? s.mrrCents : f?.monthly ? f.monthly : null,
      nextDue: f?.nextDue ?? null, nextAmount: f?.nextAmount ?? 0, lastPayment: f?.lastPayment ?? null, daysLate, overdue,
      health: s?.health ?? null, renewal,
      atRisk: s?.health === "em_risco" || daysLate > 15 || (renewal ? daysBetween(today, renewal) <= 30 : false),
    };
  }), [q.data, csById, finById, today]);

  if (q.isPending) return <AtendimentoLayout><ClientsSkeleton /></AtendimentoLayout>;
  if (q.isError) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const { counts } = q.data;
  const filtered = rows.filter((c) => {
    const hay = `${c.trade_name} ${c.legal_name} ${c.cnpj} ${c.contact_name} ${c.email} ${c.whatsapp} ${c.internal_responsible ?? ""}`.toLowerCase();
    if (search && !hay.includes(search.toLowerCase())) return false;
    if (status !== "todos" && c.status !== status) return false;
    if (params.filtro === "atrasados" && !(c.overdue > 0)) return false;
    if (params.filtro === "risco" && !c.atRisk) return false;
    return true;
  });
  const dir = sort === "nome" || sort === "vencimento" || sort === "renovacao" || sort === "saude" ? 1 : -1;
  const keyOf = (c: Row): string | number => sort === "mrr" ? c.mrr ?? -1 : sort === "atraso" ? c.overdue : sort === "vencimento" ? c.nextDue ?? "9999" : sort === "renovacao" ? c.renewal ?? "9999" : sort === "saude" ? HEALTH_RANK[c.health ?? ""] ?? 3 : c.trade_name.toLocaleLowerCase();
  const sorted = [...filtered].sort((a, b) => { const x = keyOf(a), y = keyOf(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const totalMrr = rows.filter((c) => c.status === "ativo" || c.status === "implantacao").reduce((n, c) => n + (c.mrr ?? 0), 0);
  const lateCount = rows.filter((c) => c.overdue > 0).length;
  const riskCount = rows.filter((c) => c.atRisk && c.status !== "encerrado").length;
  const hasFinance = !!finById || csById.size > 0;
  async function submit() {
    if (!editing) return;
    setBusy(true); setError("");
    try {
      await save({ data: formToInput(editing) });
      await qc.invalidateQueries({ queryKey: ["crm-clients"] });
      setEditing(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar."); }
    setBusy(false);
  }
  const open = (id: string) => { rememberList(); void navigate({ to: "/clientes/$id", params: { id } }); };
  const sortHead = (k: ClientSort, label: string, className = "") => (
    <th className={`p-3 font-medium ${className}`} aria-sort={sort === k ? (dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setParams({ ordem: k === "nome" ? undefined : k })}>
        {label}{sort === k ? (dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </th>
  );
  const healthPill = (c: Row) => c.health ? <StatusPill tone={HEALTH_TONE[c.health] ?? "neutral"}>{CS_HEALTH[c.health as keyof typeof CS_HEALTH] ?? c.health}</StatusPill> : null;
  const finCell = (c: Row) => !hasFinance ? <span className="text-muted-foreground">—</span>
    : c.overdue > 0 ? <StatusPill tone="danger" title={`${currency(c.overdue / 100)} em aberto`}>{c.daysLate ? `Atrasado ${c.daysLate}d` : "Atrasado"}</StatusPill>
    : c.nextDue || c.lastPayment ? <StatusPill tone="success">Em dia</StatusPill> : <span className="text-xs text-muted-foreground">Sem cobranças</span>;
  const menu = (c: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Mais ações para ${c.trade_name}`} onClick={(e) => e.stopPropagation()}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => open(c.id)}>Abrir ficha</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setEditing(clientToForm(c))}>Editar cadastro</DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/financeiro/recebimentos" search={{ cliente: c.id }}><Wallet className="size-4" />Ver recebimentos</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/clientes/$id" params={{ id: c.id }} search={{ aba: "relacionamento" }} onClick={rememberList}>Conversas e tarefas</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <AtendimentoLayout><div className="w-full min-w-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
      <ClientsHubTabs active="carteira" />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">Carteira da Gravon Company: situação, receita recorrente e o que precisa de atenção.</p>
        </div>
        <Button onClick={() => setEditing({ ...emptyClientForm })}><Plus className="size-4" />Novo cliente</Button>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        {(["ativo", "implantacao", "pausado", "encerrado"] as const).map((k) => (
          <KpiCard key={k} label={STATUS_PLURAL[k]} value={counts[k]} tone={KPI_TONE[CLIENT_TONE[k]]} active={status === k} onClick={() => setStatus(status === k ? "todos" : k)} />
        ))}
        <KpiCard label="MRR da carteira" value={hasFinance ? currency(totalMrr / 100) : "—"} hint="Ativos e em implantação" tone="primary" />
        <KpiCard label="Com atraso" value={hasFinance ? lateCount : "—"} tone="danger" active={params.filtro === "atrasados"} onClick={() => setParams({ filtro: params.filtro === "atrasados" ? undefined : "atrasados" })} />
        <KpiCard label="Precisam de atenção" value={hasFinance ? riskCount : "—"} hint="Risco, atraso ou renovação" tone="warning" active={params.filtro === "risco"} onClick={() => setParams({ filtro: params.filtro === "risco" ? undefined : "risco" })} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-sm" placeholder="Pesquisar por nome, CNPJ, contato, responsável…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Pesquisar clientes" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-52" aria-label="Filtrar por situação"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as situações</SelectItem>
            {Object.entries(CLIENT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        {(search || status !== "todos" || params.filtro) && <Button variant="ghost" onClick={() => setParams({ q: undefined, situacao: undefined, filtro: undefined })}>Limpar filtros</Button>}
        <span className="text-sm text-muted-foreground">{sorted.length} de {rows.length}</span>
        <div className="ml-auto flex rounded-md border p-0.5" role="group" aria-label="Modo de visualização">
          <Button size="sm" variant={params.visao === "quadro" ? "ghost" : "secondary"} onClick={() => setParams({ visao: undefined })} aria-pressed={params.visao !== "quadro"}><List className="size-4" />Lista</Button>
          <Button size="sm" variant={params.visao === "quadro" ? "secondary" : "ghost"} onClick={() => setParams({ visao: "quadro" })} aria-pressed={params.visao === "quadro"}><Columns3 className="size-4" />Quadro</Button>
        </div>
      </div>

      {params.visao === "quadro" ? (
        <div className="overflow-x-auto pb-2"><div className="grid min-w-[1000px] grid-cols-4 gap-3">
          {(["implantacao", "ativo", "pausado", "encerrado"] as const).map((k) => {
            const list = sorted.filter((c) => c.status === k);
            return (
              <section key={k} className="rounded-lg border bg-muted/30">
                <h2 className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold"><StatusPill tone={CLIENT_TONE[k]}>{CLIENT_STATUS[k]}</StatusPill><span className="text-muted-foreground">{list.length}</span></h2>
                <div className="space-y-2 p-2">
                  {list.map((c) => (
                    <article key={c.id} className="cursor-pointer rounded-md border bg-card p-3 text-sm transition-colors hover:border-primary/60" onClick={(e) => { if ((e.target as HTMLElement).closest("button,a,[role=menuitem]")) return; open(c.id); }}>
                      <div className="flex items-start justify-between gap-2"><p className="font-medium text-primary">{c.trade_name}</p>{menu(c)}</div>
                      <p className="text-xs text-muted-foreground">{c.internal_responsible || "Sem responsável"}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">{finCell(c)}{healthPill(c)}</div>
                      {c.mrr ? <p className="mt-2 text-xs tabular-nums">MRR <strong>{currency(c.mrr / 100)}</strong></p> : null}
                    </article>
                  ))}
                  {!list.length && <p className="p-3 text-xs text-muted-foreground">Nenhum cliente.</p>}
                </div>
              </section>
            );
          })}
        </div></div>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="w-10 p-3"><Checkbox aria-label="Selecionar todos os clientes" checked={sorted.length > 0 && sorted.every((c) => selected.has(c.id))} onCheckedChange={(v) => setSelected(v ? new Set(sorted.map((c) => c.id)) : new Set())} /></th>
                {sortHead("nome", "Cliente", "min-w-56")}
                <th className="p-3 font-medium">Situação</th>
                {sortHead("mrr", "MRR", "text-right")}
                {sortHead("vencimento", "Próximo vencimento")}
                {sortHead("atraso", "Financeiro")}
                {sortHead("saude", "Saúde")}
                {sortHead("renovacao", "Renovação")}
                <th className="p-3 font-medium">Serviços</th>
                <th className="p-3 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const renewDays = c.renewal ? daysBetween(today, c.renewal) : null;
                return (
                  <tr key={c.id} className="cursor-pointer border-t transition-colors hover:bg-muted/40" onClick={(e) => { if ((e.target as HTMLElement).closest("button,a,[role=checkbox],[role=menuitem]")) return; open(c.id); }}>
                    <td className="p-3"><Checkbox aria-label={`Selecionar ${c.trade_name}`} checked={selected.has(c.id)} onCheckedChange={(v) => setSelected((p) => { const n = new Set(p); v ? n.add(c.id) : n.delete(c.id); return n; })} /></td>
                    <td className="p-3">
                      <Link to="/clientes/$id" params={{ id: c.id }} onClick={rememberList} className="font-medium text-primary underline-offset-4 hover:underline">{c.trade_name}</Link>
                      <span className="block text-xs text-muted-foreground">{[c.internal_responsible ? `Resp.: ${c.internal_responsible}` : null, c.contact_name || c.whatsapp || c.email].filter(Boolean).join(" · ") || "—"}</span>
                    </td>
                    <td className="p-3"><StatusPill tone={CLIENT_TONE[c.status] ?? "neutral"}>{CLIENT_STATUS[c.status as keyof typeof CLIENT_STATUS] ?? c.status}</StatusPill></td>
                    <td className="p-3 text-right tabular-nums">{c.mrr ? currency(c.mrr / 100) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-3 tabular-nums">{c.nextDue ? <>{dateBR(c.nextDue)}<span className="block text-xs text-muted-foreground">{currency(c.nextAmount / 100)}</span></> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-3">{finCell(c)}{c.lastPayment && <span className="mt-1 block text-xs text-muted-foreground">últ. pgto {dateBR(c.lastPayment)}</span>}</td>
                    <td className="p-3">{healthPill(c) ?? <span className="text-xs text-muted-foreground">Sem avaliação</span>}</td>
                    <td className="p-3 tabular-nums">{c.renewal ? <>{dateBR(c.renewal)}{renewDays !== null && renewDays <= 30 && <span className="mt-1 block"><StatusPill tone={renewDays < 0 ? "danger" : "warning"}>{renewDays < 0 ? "vencida" : `em ${renewDays}d`}</StatusPill></span>}</> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="max-w-48 truncate p-3 text-muted-foreground" title={(c.services ?? []).join(", ")}>{(c.services ?? []).join(", ") || "—"}</td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <ClientCardAction link={linkByClient.get(c.id)} clientName={c.trade_name} />
                        {menu(c)}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!sorted.length && <tr><td className="p-8 text-center text-muted-foreground" colSpan={10}>Nenhum cliente encontrado com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Barra de ações em lote: só aparece com seleção. */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-30 mx-auto flex w-fit flex-wrap items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg">
          <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
          <BulkTaskAnalysis clients={rows.filter((c) => selected.has(c.id))} onDone={() => undefined} />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X className="size-4" />Limpar</Button>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar cliente" : "Novo cliente"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <ClientForm value={editing} onChange={setEditing} />
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button disabled={busy || editing.tradeName.trim().length < 2} onClick={() => void submit()}>{busy ? "Salvando…" : "Salvar cliente"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div></AtendimentoLayout>
  );
}

function ClientsSkeleton() {
  return (
    <div role="status" aria-label="Carregando clientes" className="flex-1 animate-pulse space-y-4 p-6">
      <div className="h-8 w-48 rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">{Array.from({ length: 7 }, (_, i) => <div key={i} className="h-20 rounded-lg bg-muted" />)}</div>
      <div className="h-96 rounded-lg bg-muted" />
    </div>
  );
}
