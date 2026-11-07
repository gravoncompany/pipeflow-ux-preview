import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity, ArrowLeft, Brain, Building2, ClipboardList, FileText, FolderKanban, Globe, History, Instagram, LayoutDashboard,
  Mail, MessageCircle, MessagesSquare, Pencil, Target, Wallet,
} from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { AtendimentoLayout } from "@/components/crm/AtendimentoLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  addClientKnowledge, addClientRecord, approveClientPlan, cancelClientCharge, generateClientPlan,
  generateClientSummary, getClient, getClientDocumentUrl, registerClientPayment, runPaymentReminders,
  saveClient, saveClientCharge, saveClientPlan, saveClientTask, uploadClientDocument,
} from "@/lib/crm-clients.functions";
import {
  CHARGE_STATUS, CLIENT_STATUS, DOC_CATEGORY, KNOWLEDGE_KIND, KNOWLEDGE_KIND_LABEL, RECORD_KIND, RECURRENCE, TASK_PRIORITY, TASK_STATUS,
} from "@/lib/crm-clients";
import { buildClientHistory } from "@/lib/client-history";
import { getClientHypercashHistory } from "@/lib/hypercash.functions";
import { CHARGE_STATUS_LABEL as HC_CHARGE_LABEL, SUBSCRIPTION_STATUS_LABEL as HC_SUB_LABEL, type ChargeStatus as HcChargeStatus, type SubscriptionStatus as HcSubStatus } from "@/lib/hypercash";
import { readClientListState } from "@/lib/client-list-state";
import { ClientForm, clientToForm, formToInput } from "@/components/crm/ClientForm";
import { currency } from "@/lib/revenue";
import { ClientCampaignPanel, ClientKnowledgeBase, ClientProjects } from "@/components/crm/ClientPhase1";
import { cn } from "@/lib/utils";
import { ClientBankHistory } from "@/components/crm/ClientBankHistory";
import { ClientReceiptIndicator } from "@/components/crm/ClientReceiptIndicator";
import { ClientSuccessPanel } from "@/components/crm/CustomerSuccess";
import { TaskBoard, type BoardTask } from "@/components/crm/TaskBoard";
import { TaskHistory } from "@/components/crm/TaskHistory";

import { CLIENT_TABS as TABS, CLIENT_GROUPS, isClientSection, resolveClientSection, type ClientSection, type ClientTabKey as TabKey } from "@/lib/client-tabs";
import { receiptRows, type ReceiptCharge } from "@/lib/receipt-control";
import { clientReceiptHealth } from "@/lib/receipt-insights";
import { todaySP } from "@/lib/finance-management";
import { dateBR } from "@/lib/ux-format";
import { StatusPill, CLIENT_TONE } from "@/components/crm/ux/StatusPill";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/clientes_/$id")({
  validateSearch: (s: Record<string, unknown>): { aba?: ClientSection } => ({ aba: isClientSection(s.aba) && s.aba !== "visao" ? s.aba : undefined }),
  head: () => ({
    meta: [
      { title: "Cliente — PipeFlow CRM" },
      { name: "description", content: "Página do cliente: visão geral, cadastro, projetos, histórico, conhecimento, planejamento, documentos, conversas, registros e financeiro." },
      { property: "og:title", content: "Cliente — PipeFlow CRM" },
      { property: "og:description", content: "Página completa do cliente da Gravon Company." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientPage,
});

const fmtDate = (d: string | null) => (d ? new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR") : "—");
const fmtDateTime = (d: string) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function Empty({ icon: Icon, title, text }: { icon: ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function BackToClients() {
  // Recupera busca e situação da lista; a posição é restaurada pela própria lista.
  const [saved, setSaved] = useState<ReturnType<typeof readClientListState>>(null);
  useEffect(() => setSaved(readClientListState()), []);
  return (
    <Link to="/clientes" search={{ q: saved?.q, situacao: saved?.situacao, ordem: saved?.ordem, filtro: saved?.filtro, visao: saved?.visao }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Voltar para clientes
    </Link>
  );
}

function ClientPage() {
  const { id } = Route.useParams();
  const { aba } = Route.useSearch();
  const { group, tab } = resolveClientSection(aba);
  const navigate = useNavigate({ from: "/clientes/$id" });
  const q = useQuery({ queryKey: ["crm-client", id], queryFn: () => getClient({ data: { id } }), retry: false });
  if (q.isPending) return <AtendimentoLayout><div className="flex-1 p-6"><BackToClients /><p className="py-6 text-muted-foreground">Carregando cliente…</p></div></AtendimentoLayout>;
  if (q.isError) {
    if (q.error instanceof Error && q.error.message === "Cliente não encontrado.")
      return <AtendimentoLayout><div className="flex-1 space-y-4 p-6"><BackToClients /><Empty icon={Building2} title="Cliente não encontrado" text="Este cadastro não existe mais ou o endereço está incorreto." /></div></AtendimentoLayout>;
    return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  }
  const d = q.data;
  const c = d.client;
  const select = (k: ClientSection) => void navigate({ search: { aba: k === "visao" ? undefined : k }, replace: true });
  const groupDef = CLIENT_GROUPS.find((g) => g.key === group)!;
  const subTabs = TABS.filter((t) => (groupDef.tabs as readonly string[]).includes(t.key));
  return (
    <AtendimentoLayout><div className="w-full flex-1 space-y-5 p-4 md:p-8">
      <BackToClients />
      {/* Cabeçalho fixo com o essencial do cliente e as ações mais usadas. */}
      <header className="sticky top-0 z-20 -mx-4 space-y-3 border-b bg-background/95 px-4 pb-3 pt-2 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate text-2xl font-semibold">{c.trade_name}</h1>
              <StatusPill tone={CLIENT_TONE[c.status] ?? "neutral"}>{CLIENT_STATUS[c.status as keyof typeof CLIENT_STATUS]}</StatusPill>
            </div>
            <p className="text-sm text-muted-foreground">
              {c.internal_responsible ? `Responsável: ${c.internal_responsible}` : "Sem responsável definido"}
              {c.relationship_start ? ` · Cliente desde ${fmtDate(c.relationship_start)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.whatsapp && waLink(c.whatsapp) && <Button asChild size="sm" variant="outline"><a href={waLink(c.whatsapp)} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4" />WhatsApp</a></Button>}
            <Button size="sm" variant="outline" onClick={() => select("registros")}><ClipboardList className="size-4" />Nova tarefa</Button>
            <Button size="sm" variant="outline" onClick={() => select("financeiro")}><Wallet className="size-4" />Registrar pagamento</Button>
            <Button size="sm" variant={tab === "cadastro" ? "default" : "ghost"} onClick={() => select("cadastro")}><Pencil className="size-4" />Cadastro</Button>
          </div>
        </div>
        <ClientKeyFacts d={d} onFinance={() => select("financeiro")} />
      </header>
      <nav aria-label="Seções do cliente" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul role="tablist" className="flex w-max gap-1 border-b md:w-auto">
          {CLIENT_GROUPS.map((g) => (
            <li key={g.key}>
              <button
                type="button"
                role="tab"
                aria-selected={group === g.key && tab !== "cadastro"}
                onClick={() => select(g.key)}
                className={cn(
                  "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors",
                  group === g.key && tab !== "cadastro" ? "border-primary font-medium text-primary" : "border-transparent text-foreground/70 hover:text-foreground",
                )}
              >
                <g.icon className="size-4 shrink-0" />{g.label}
              </button>
            </li>
          ))}
        </ul>
        {subTabs.length > 1 && tab !== "cadastro" && (
          <ul className="mt-3 flex w-max gap-1 rounded-lg bg-muted p-1" aria-label={`Abas de ${groupDef.label}`}>
            {subTabs.map((t) => (
              <li key={t.key}>
                <button type="button" aria-pressed={tab === t.key} onClick={() => select(t.key)}
                  className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors", tab === t.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  <t.icon className="size-3.5" />{t.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div role="tabpanel">
        {tab === "visao" && <VisaoGeral d={d} onSelect={select} />}
        {tab === "cadastro" && <Cadastro d={d} />}
        {tab === "projetos" && <ClientProjectsTab d={d} onUpload={(pid: string) => { try { sessionStorage.setItem("pipeflow:client-doc-project", pid); } catch { /* opcional */ } select("documentos"); }} />}
        {tab === "historico" && <Historico d={d} />}
        {tab === "conhecimento" && <Conhecimento d={d} />}
        {tab === "planejamento" && <Planejamento d={d} />}
        {tab === "documentos" && <Documentos d={d} />}
        {tab === "conversas" && <Conversas d={d} />}
        {tab === "registros" && <Registros d={d} />}
        {tab === "financeiro" && <Financeiro d={d} />}
        {tab === "posvenda" && <ClientSuccessPanel key={id} clientId={id} />}
      </div>
    </div></AtendimentoLayout>
  );
}

function useRefresh(clientId: string) {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["crm-client", clientId] }),
    qc.invalidateQueries({ queryKey: ["crm-clients"] }),
  ]);
}

const waLink = (v: string) => { const n = v.replace(/\D/g, ""); return n ? `https://wa.me/${n.length <= 11 ? `55${n}` : n}` : ""; };
const webLink = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);
const igLink = (v: string) => {
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return t;
  const handle = t.replace(/^@/, "").replace(/^(www\.)?instagram\.com\//i, "").split(/[/?#]/)[0];
  return handle ? `https://instagram.com/${handle}` : "";
};

function Shortcut({ href, icon: Icon, label, value }: { href: string; icon: ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <a href={href} target={href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer" title={`${label}: ${value}`}
      className="inline-flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground">
      <Icon className="size-4 shrink-0 text-primary" /><span className="truncate">{value}</span>
    </a>
  );
}

function ClientKeyFacts({ d, onFinance }: { d: any; onFinance: () => void }) {
  const today = todaySP();
  const rows = useMemo(() => receiptRows((d.charges ?? []) as ReceiptCharge[], d.payments ?? []), [d.charges, d.payments]);
  const h = clientReceiptHealth(rows, today).get(d.client.id);
  const facts: [string, ReactNode, string?][] = [
    ["Mensalidade do mês", h?.monthly ? currency(h.monthly / 100) : "—"],
    ["Próximo vencimento", h?.nextDue ? <>{dateBR(h.nextDue)} <span className="text-xs font-normal text-muted-foreground">· {currency(h.nextAmount / 100)}</span></> : "—"],
    ["Situação financeira", !rows.length ? <span className="text-sm font-normal text-muted-foreground">Sem cobranças</span> : h?.openOverdue ? <StatusPill tone="danger">{currency(h.openOverdue / 100)} · {h.maxDaysLate}d</StatusPill> : <StatusPill tone="success">Em dia</StatusPill>],
    ["Último pagamento", h?.lastPayment ? dateBR(h.lastPayment) : "—"],
    ["Tarefas abertas", String((d.tasks ?? []).filter((t: any) => t.status !== "concluida").length)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
      {facts.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="truncate font-semibold tabular-nums">{k === "Situação financeira" ? <button type="button" onClick={onFinance} className="text-left">{v}</button> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

function VisaoGeral({ d, onSelect }: { d: any; onSelect: (k: ClientSection) => void }) {
  const c = d.client;
  const openTasks = d.tasks.filter((t: any) => t.status !== "concluida");
  const nextAppts = d.appointments.filter((a: any) => a.status === "scheduled" && new Date(a.starts_at) > new Date());
  const openCharges = d.charges.filter((ch: any) => ch.status === "pendente" || ch.status === "vencido");
  const instagram = d.linkedInstagram ? igLink(d.linkedInstagram) : "";
  const shortcuts = [
    c.whatsapp && waLink(c.whatsapp) ? { href: waLink(c.whatsapp), icon: MessageCircle, label: "WhatsApp", value: c.whatsapp } : null,
    c.email ? { href: `mailto:${c.email}`, icon: Mail, label: "E-mail", value: c.email } : null,
    c.website ? { href: webLink(c.website), icon: Globe, label: "Site", value: c.website.replace(/^https?:\/\//i, "").replace(/\/$/, "") } : null,
    instagram ? { href: instagram, icon: Instagram, label: "Instagram", value: d.linkedInstagram } : null,
  ].filter(Boolean) as { href: string; icon: any; label: string; value: string }[];
  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Empresa</dt><dd className="font-medium">{c.trade_name}{c.legal_name && c.legal_name !== c.trade_name ? <span className="block text-xs font-normal text-muted-foreground">{c.legal_name}</span> : null}</dd></div>
          <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{CLIENT_STATUS[c.status as keyof typeof CLIENT_STATUS]}</dd></div>
          <div><dt className="text-muted-foreground">Responsável</dt><dd className="font-medium">{c.internal_responsible || "—"}</dd></div>
        </dl>
        {shortcuts.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4" aria-label="Atalhos de contato">
            {shortcuts.map((s) => <Shortcut key={s.label} {...s} />)}
          </div>
        )}
      </section>
      {(() => {
        const fields = [["Razão social", c.legal_name], ["CNPJ", c.cnpj], ["Telefone", c.phone || c.whatsapp], ["E-mail", c.email], ["Endereço", c.address], ["Responsável interno", c.internal_responsible]];
        const missing = fields.filter(([, v]) => !String(v ?? "").trim()).map(([l]) => l);
        if (!missing.length) return null;
        const pct = Math.round(((fields.length - missing.length) / fields.length) * 100);
        return (
          <section className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed p-4">
            <div className="min-w-48 flex-1">
              <p className="text-sm font-medium">Cadastro {pct}% completo</p>
              <Progress value={pct} className="mt-2 h-2" />
              <p className="mt-2 text-xs text-muted-foreground">Faltam: {missing.join(", ")}.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onSelect("cadastro")}><Pencil className="size-4" />Completar cadastro</Button>
          </section>
        );
      })()}
      <RecentActivity d={d} onMore={() => onSelect("historico")} />
      <ClientCampaignPanel clientId={c.id} knowledge={d.knowledge} />
      <ClientReceiptIndicator clientId={c.id} charges={d.charges} payments={d.payments}/>
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryBox title="Próximas tarefas" empty="Nenhuma tarefa pendente.">
          {openTasks.slice(0, 5).map((t: any) => (
            <p key={t.id} className="text-sm">• {t.title} <span className="text-muted-foreground">({TASK_STATUS[t.status as keyof typeof TASK_STATUS]}{t.due_date ? `, ${fmtDate(t.due_date)}` : ""})</span></p>
          ))}
        </SummaryBox>
        <SummaryBox title="Próximas reuniões" empty="Nenhuma reunião agendada.">
          {nextAppts.slice(0, 5).map((a: any) => <p key={a.id} className="text-sm">• {a.summary} — {fmtDateTime(a.starts_at)}</p>)}
        </SummaryBox>
        <SummaryBox title="Cobranças em aberto" empty="Nenhuma cobrança em aberto.">
          {openCharges.slice(0, 5).map((ch: any) => (
            <p key={ch.id} className="text-sm">• {ch.description} — {currency(Number(ch.amount))} <span className="text-muted-foreground">({CHARGE_STATUS[ch.status as keyof typeof CHARGE_STATUS]}, {fmtDate(ch.due_date)})</span></p>
          ))}
        </SummaryBox>
      </div>
    </div>
  );
}

function RecentActivity({ d, onMore }: { d: any; onMore: () => void }) {
  const items = useMemo(() => buildClientHistory(d, { record: RECORD_KIND as Record<string, string> }).slice(0, 6), [d]);
  if (items.length <= 1) return null;
  return (
    <section className="rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Atividade recente</h2><Button variant="link" className="h-auto p-0" onClick={onMore}>Ver histórico completo</Button></div>
      <ol className="relative space-y-3 border-l pl-5">
        {items.map((it) => (
          <li key={it.id} className="relative">
            <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
            <p className="text-xs text-muted-foreground">{it.kind} · {fmtDateTime(it.at)}</p>
            <p className="line-clamp-2 text-sm">{it.title}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SummaryBox({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children.length ? children : <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

function Cadastro({ d }: any) {
  const c = d.client;
  const refresh = useRefresh(c.id);
  const save = useServerFn(saveClient);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try { await save({ data: formToInput(form) }); await refresh(); setEditing(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar."); }
    setBusy(false);
  }
  const rows: [string, ReactNode][] = [
    ["Nome fantasia", c.trade_name],
    ["Razão social", c.legal_name],
    ["CNPJ", c.cnpj],
    ["Responsável / contato", c.contact_name],
    ["Telefone", c.phone],
    ["WhatsApp", c.whatsapp],
    ["E-mail", c.email],
    ["Site", c.website],
    ["Instagram", d.linkedInstagram],
    ["Endereço", c.address],
    ["Início do relacionamento", c.relationship_start ? fmtDate(c.relationship_start) : ""],
    ["Situação", CLIENT_STATUS[c.status as keyof typeof CLIENT_STATUS]],
    ["Responsável interno", c.internal_responsible],
    ["Serviços contratados", (c.services ?? []).join(", ")],
    ["Lembrete de pagamento", `${c.reminder_days} dias antes do vencimento`],
    ["Observações", c.notes],
  ];
  return (
    <section className="rounded-xl border p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Dados do cadastro</h2>
        <Button size="sm" variant="outline" onClick={() => { setForm(clientToForm(c)); setError(""); setEditing(true); }}><Pencil className="size-4" /> Editar cadastro</Button>
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className={k === "Endereço" || k === "Observações" || k === "Serviços contratados" ? "sm:col-span-2" : undefined}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      {d.linkedInstagram && <p className="mt-3 text-xs text-muted-foreground">O Instagram vem do contato do funil vinculado a este cliente.</p>}
      <Dialog open={editing} onOpenChange={(v) => { if (!busy) setEditing(v); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Editar cadastro</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-4">
              <ClientForm value={form} onChange={setForm} />
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button disabled={busy || form.tradeName.trim().length < 2} onClick={() => void submit()}>{busy ? "Salvando…" : "Salvar"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ClientProjectsTab({ d, onUpload }: any) {
  const refresh = useRefresh(d.client.id);
  return <ClientProjects clientId={d.client.id} projects={d.projects ?? []} documents={d.documents} onChanged={refresh} onUpload={onUpload} />;
}

function Historico({ d }: any) {
  const items = useMemo(() => buildClientHistory(d, { record: RECORD_KIND as Record<string, string> }), [d]);
  if (items.length <= 1)
    return <Empty icon={History} title="Nenhuma atividade registrada" text="Registros, tarefas, documentos, pagamentos e reuniões deste cliente aparecerão aqui, do mais recente ao mais antigo." />;
  return (
    <ol className="relative space-y-4 border-l pl-6">
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span className="absolute -left-[29px] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
          <div className="text-xs text-muted-foreground">{it.kind} · {fmtDateTime(it.at)}{it.detail ? ` · ${it.detail}` : ""}</div>
          <p className="whitespace-pre-wrap text-sm">{it.title}</p>
        </li>
      ))}
    </ol>
  );
}

function Conhecimento({ d }: any) {
  const c = d.client;
  const refresh = useRefresh(c.id);
  const add = useServerFn(addClientKnowledge);
  const summarize = useServerFn(generateClientSummary);
  const [kind, setKind] = useState("manual");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const summaries = d.knowledge.filter((k: any) => k.kind === "resumo");
  const entries = d.knowledge.filter((k: any) => k.kind !== "resumo" && k.kind !== "relatorio_ia");
  async function submit() {
    setBusy(true); setError("");
    try { await add({ data: { clientId: c.id, kind: kind as any, title, text, source } }); setTitle(""); setText(""); setSource(""); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao registrar."); }
    setBusy(false);
  }
  async function runSummary() {
    setBusy(true); setError("");
    try { await summarize({ data: { id: c.id } }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao gerar o resumo."); }
    setBusy(false);
  }
  return (
    <div className="space-y-4">
    <ClientKnowledgeBase clientId={c.id} />
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-4">
        <div className="rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Resumo Inteligente do Cliente</h2>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void runSummary()}>Atualizar resumo com IA</Button>
          </div>
          {summaries[0] ? (
            <>
              <p className="whitespace-pre-wrap text-sm">{summaries[0].text}</p>
              <p className="mt-2 text-xs text-muted-foreground">Gerado em {fmtDateTime(summaries[0].created_at)} a partir das fontes autorizadas deste cliente. As fontes originais são preservadas abaixo.</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum resumo gerado. A IA usa apenas as informações deste cliente — nunca de outro.</p>
          )}
        </div>
        <div className="rounded-xl border p-4">
          <h2 className="mb-3 font-semibold">Adicionar conhecimento</h2>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger aria-label="Tipo de conhecimento"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(KNOWLEDGE_KIND).filter(([k]) => k !== "resumo").map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Título</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div><Label>Conteúdo</Label><Textarea rows={4} value={text} onChange={e => setText(e.target.value)} /></div>
            <div><Label>Fonte</Label><Input value={source} onChange={e => setSource(e.target.value)} placeholder="Ex.: reunião de 20/10, contrato assinado" /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button disabled={busy || !text.trim()} onClick={() => void submit()}>Registrar</Button>
          </div>
        </div>
      </section>
      <section className="rounded-xl border p-4">
        <h2 className="mb-2 font-semibold">Base de conhecimento</h2>
        <div className="space-y-3">
          {entries.map((k: any) => (
            <article key={k.id} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{KNOWLEDGE_KIND_LABEL[k.kind] ?? k.kind} · {fmtDateTime(k.created_at)}{k.source ? ` · Fonte: ${k.source}` : ""}</div>
              {k.title && <div className="font-medium">{k.title}</div>}
              <p className="whitespace-pre-wrap text-sm">{k.text}</p>
            </article>
          ))}
          {!entries.length && <p className="text-sm text-muted-foreground">Nenhum registro de conhecimento ainda.</p>}
        </div>
      </section>
    </div>
    </div>
  );
}

function Planejamento({ d }: any) {
  const c = d.client;
  const refresh = useRefresh(c.id);
  const savePlan = useServerFn(saveClientPlan);
  const genPlan = useServerFn(generateClientPlan);
  const approve = useServerFn(approveClientPlan);
  const plan = d.plans[0] ?? null;
  const versions = plan ? d.versions.filter((v: any) => v.plan_id === plan.id) : [];
  const current = versions.find((v: any) => v.version === plan?.current_version) ?? null;
  const [content, setContent] = useState<string | null>(null);
  const [briefing, setBriefing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const editorValue = content ?? current?.content ?? "";
  const dirty = content !== null && content !== (current?.content ?? "");
  async function generate() {
    setBusy(true); setError("");
    try { const r = await genPlan({ data: { clientId: c.id, briefing } }); setContent(r.content); setSaved("Rascunho gerado pela IA — revise antes de salvar ou aprovar."); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao gerar."); }
    setBusy(false);
  }
  async function save(origin: "manual" | "ia") {
    setBusy(true); setError(""); setSaved("");
    try {
      await savePlan({ data: { clientId: c.id, planId: plan?.id ?? null, title: plan?.title ?? `Planejamento estratégico — ${c.trade_name}`, content: editorValue, origin, expectedVersion: plan?.current_version ?? 0 } });
      setContent(null); await refresh(); setSaved("Planejamento salvo como nova versão (rascunho).");
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar."); }
    setBusy(false);
  }
  async function approveCurrent() {
    if (!plan) return;
    setBusy(true); setError("");
    try { await approve({ data: { planId: plan.id, version: plan.current_version, revision: Number(plan.revision), confirmed: true } }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao aprovar."); }
    setBusy(false);
  }
  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Planejamento estratégico {plan && <span className="text-sm font-normal text-muted-foreground">— versão {plan.current_version} ({plan.status === "aprovado" ? `aprovado: v${plan.approved_version}` : "rascunho"})</span>}</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void generate()}>{plan ? "Atualizar planejamento com IA" : "Gerar planejamento com IA"}</Button>
            <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={() => void save(content !== null && !current ? "ia" : "manual")}>Salvar versão</Button>
            <Button size="sm" disabled={busy || !plan || dirty} onClick={() => void approveCurrent()}>Aprovar versão atual</Button>
            <Button size="sm" variant="ghost" onClick={() => window.print()}>Exportar PDF</Button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">Sugestões da IA nunca substituem uma versão aprovada: geram um novo rascunho para revisão humana. Somente versões aprovadas são tratadas como estratégia vigente. A exportação em PDF usa a impressão do navegador.</p>
        <Textarea aria-label="Editor do planejamento" rows={18} className="font-mono text-sm" value={editorValue} onChange={e => setContent(e.target.value)} placeholder="Escreva o planejamento ou gere um rascunho com a IA." />
        {saved && <p className="mt-2 text-sm text-primary">{saved}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-3">
          <Label>Briefing para a IA (opcional)</Label>
          <Input value={briefing} onChange={e => setBriefing(e.target.value)} placeholder="Ex.: foco em captação de clientes de odontologia no próximo trimestre" />
        </div>
      </section>
      <section className="rounded-xl border p-4">
        <h2 className="mb-2 font-semibold">Histórico de versões</h2>
        {versions.map((v: any) => (
          <p key={v.id} className="text-sm">
            • v{v.version} — {v.origin === "ia" ? "gerada pela IA" : "edição manual"} em {fmtDateTime(v.created_at)}
            {plan?.approved_version === v.version ? " (aprovada)" : ""}
          </p>
        ))}
        {!versions.length && <p className="text-sm text-muted-foreground">Nenhuma versão ainda.</p>}
      </section>
    </div>
  );
}

function Documentos({ d }: any) {
  const c = d.client;
  const refresh = useRefresh(c.id);
  const upload = useServerFn(uploadClientDocument);
  const getUrl = useServerFn(getClientDocumentUrl);
  const [category, setCategory] = useState("contrato");
  const [aiAuthorized, setAiAuthorized] = useState(false);
  const [projectId, setProjectId] = useState("");
  useEffect(() => { try { const v = sessionStorage.getItem("pipeflow:client-doc-project"); if (v && (d.projects ?? []).some((p: any) => p.id === v)) setProjectId(v); sessionStorage.removeItem("pipeflow:client-doc-project"); } catch { /* opcional */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = d.documents.filter((doc: any) => !search || `${doc.name} ${doc.category}`.toLowerCase().includes(search.toLowerCase()));
  async function submit() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.set("clientId", c.id); form.set("category", category); form.set("aiAuthorized", String(aiAuthorized)); form.set("file", file); if (projectId) form.set("projectId", projectId);
      await upload({ data: form });
      setFile(null); setAiAuthorized(false); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao enviar."); }
    setBusy(false);
  }
  async function open(docId: string) {
    setError("");
    try { const r = await getUrl({ data: { documentId: docId } }); window.open(r.url, "_blank", "noopener"); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao abrir."); }
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 font-semibold">Enviar documento</h2>
        <div className="space-y-3">
          <div>
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Categoria do documento"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(DOC_CATEGORY).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label htmlFor="doc-project">Projeto (opcional)</Label><select id="doc-project" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">Sem projeto</option>{(d.projects ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><Label>Arquivo (até 15 MB)</Label><Input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={aiAuthorized} onCheckedChange={v => setAiAuthorized(v === true)} />
            Autorizo a Pipeflow IA a consultar este documento no atendimento deste cliente.
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button disabled={!file || busy} onClick={() => void submit()}>{busy ? "Enviando…" : "Enviar"}</Button>
        </div>
      </section>
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Biblioteca</h2>
          <Input className="max-w-48" placeholder="Pesquisar" value={search} onChange={e => setSearch(e.target.value)} aria-label="Pesquisar documentos" />
        </div>
        <div className="space-y-2">
          {filtered.map((doc: any) => (
            <div key={doc.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <div>
                <div className="font-medium">{doc.name}</div>
                <div className="text-xs text-muted-foreground">
                  {DOC_CATEGORY[doc.category as keyof typeof DOC_CATEGORY]} · {(doc.size_bytes / 1024).toFixed(0)} KB · {fmtDateTime(doc.created_at)}
                  {doc.ai_authorized ? " · autorizado para a IA" : " · não autorizado para a IA"}
                  {doc.project_id ? ` · projeto: ${(d.projects ?? []).find((p: any) => p.id === doc.project_id)?.name ?? "—"}` : ""}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => void open(doc.id)}>Visualizar</Button>
            </div>
          ))}
          {!filtered.length && <p className="text-sm text-muted-foreground">Nenhum documento.</p>}
        </div>
      </section>
    </div>
  );
}

function Conversas({ d }: any) {
  const c = d.client;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Conversas WhatsApp</h2>
          {d.conversationKey && <Button size="sm" asChild>
            <Link to="/whatsapp" search={{ contato: d.conversationKey, conta: d.conversationInstance || undefined }}><MessagesSquare />Abrir conversa no CRM</Link>
          </Button>}
        </div>
        {d.conversationInstance && <p className="mb-1 text-xs text-muted-foreground">Conta de WhatsApp da conversa: <strong>{d.conversationInstance}</strong></p>}
        <p className="mb-3 text-xs text-muted-foreground">Histórico existente do contato vinculado — sem duplicar conversas nem alterar a integração com a Evolution API.</p>
        {!c.lead_id && <p className="text-sm text-muted-foreground">Este cliente não está vinculado a um contato do funil; vincule convertendo a partir de Contatos.</p>}
        {c.lead_id && !d.conversations.length && <p className="text-sm text-muted-foreground">Nenhuma mensagem registrada para este contato.</p>}
        <div className="space-y-2">
          {d.conversations.map((m: any) => (
            <div key={m.id} className={`rounded-lg border p-3 text-sm ${m.from_me ? "bg-muted/40" : ""}`}>
              <div className="text-xs text-muted-foreground">{m.from_me ? "Gravon" : m.push_name || "Cliente"} · {fmtDateTime(m.sent_at)}</div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-xl border p-4">
        <h2 className="mb-2 font-semibold">Reuniões (Agenda)</h2>
        <p className="mb-3 text-xs text-muted-foreground">Reuniões da Agenda comercial vinculadas a este cliente — a configuração do Google Calendar não foi alterada.</p>
        {d.appointments.map((a: any) => (
          <p key={a.id} className="text-sm">• {a.summary} — {fmtDateTime(a.starts_at)} ({a.status === "cancelled" ? "cancelada" : "agendada"})</p>
        ))}
        {!d.appointments.length && <p className="text-sm text-muted-foreground">Nenhuma reunião registrada.</p>}
      </section>
    </div>
  );
}

function Registros({ d }: any) {
  const c = d.client;
  const refresh = useRefresh(c.id);
  const addRecord = useServerFn(addClientRecord);
  const saveTask = useServerFn(saveClientTask);
  const [kind, setKind] = useState("observacao");
  const [description, setDescription] = useState("");
  const [task, setTask] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submitRecord() {
    setBusy(true); setError("");
    try { await addRecord({ data: { clientId: c.id, kind: kind as any, description } }); setDescription(""); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao registrar."); }
    setBusy(false);
  }
  async function submitTask() {
    setBusy(true); setError("");
    try {
      await saveTask({ data: { id: task.id, clientId: c.id, title: task.title, description: task.description, responsible: task.responsible, priority: task.priority, dueDate: task.dueDate || null, status: task.status, revision: task.revision } });
      setTask(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar a tarefa."); }
    setBusy(false);
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-4">
        <div className="rounded-xl border p-4">
          <h2 className="mb-3 font-semibold">Adicionar Registro</h2>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger aria-label="Tipo de registro"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(RECORD_KIND).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Descrição</Label><Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} /></div>
            <Button disabled={busy || !description.trim()} onClick={() => void submitRecord()}>Registrar</Button>
          </div>
        </div>
        <div className="rounded-xl border p-4">
          <h2 className="mb-2 font-semibold">Registros</h2>
          <div className="space-y-2">
            {d.records.map((r: any) => (
              <article key={r.id} className="rounded-lg border p-3 text-sm">
                <div className="text-xs text-muted-foreground">{RECORD_KIND[r.kind as keyof typeof RECORD_KIND]} · {r.author} · {fmtDateTime(r.created_at)}</div>
                <p className="whitespace-pre-wrap">{r.description}</p>
              </article>
            ))}
            {!d.records.length && <p className="text-sm text-muted-foreground">Nenhum registro.</p>}
          </div>
        </div>
      </section>
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Tarefas <Link to="/tarefas" className="ml-2 text-xs font-normal text-primary hover:underline">Ver central</Link></h2>
          <Button size="sm" variant="outline" onClick={() => setTask({ id: null, title: "", description: "", responsible: "", priority: "media", dueDate: "", status: "pendente", revision: 0 })}>Nova tarefa</Button>
        </div>
        <TaskBoard tasks={d.tasks as BoardTask[]} context={`client:${d.client.id}`} onChanged={refresh} />
        <TaskHistory clientId={d.client.id} />
      </section>
      <Dialog open={!!task} onOpenChange={() => setTask(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{task?.id ? "Editar tarefa" : "Nova tarefa"}</DialogTitle></DialogHeader>
          {task && (
            <div className="space-y-3">
              <div><Label>Título</Label><Input value={task.title} onChange={e => setTask({ ...task, title: e.target.value })} /></div>
              <div><Label>Descrição</Label><Textarea rows={3} value={task.description} onChange={e => setTask({ ...task, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Responsável</Label><Input value={task.responsible} onChange={e => setTask({ ...task, responsible: e.target.value })} /></div>
                <div><Label>Prazo</Label><Input type="date" value={task.dueDate} onChange={e => setTask({ ...task, dueDate: e.target.value })} /></div>
                <div>
                  <Label>Prioridade</Label>
                  <Select value={task.priority} onValueChange={v => setTask({ ...task, priority: v })}>
                    <SelectTrigger aria-label="Prioridade"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TASK_PRIORITY).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={task.status} onValueChange={v => setTask({ ...task, status: v })}>
                    <SelectTrigger aria-label="Status da tarefa"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TASK_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button disabled={busy || task.title.trim().length < 2} onClick={() => void submitTask()}>Salvar tarefa</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Financeiro({ d }: any) {
  const c = d.client;
  const refresh = useRefresh(c.id);
  const fetchHc = useServerFn(getClientHypercashHistory);
  const hc = useQuery({ queryKey: ["client-hypercash", c.id], queryFn: () => fetchHc({ data: { clientId: c.id } }), retry: false });
  const saveCharge = useServerFn(saveClientCharge);
  const pay = useServerFn(registerClientPayment);
  const cancel = useServerFn(cancelClientCharge);
  const reminders = useServerFn(runPaymentReminders);
  const [charge, setCharge] = useState<any>(null);
  const [payment, setPayment] = useState<any>(null);
  const [payConfirmed, setPayConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const paymentsByCharge = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of d.payments) m.set(p.charge_id, [...(m.get(p.charge_id) ?? []), p]);
    return m;
  }, [d.payments]);
  async function submitCharge() {
    setBusy(true); setError("");
    try {
      await saveCharge({ data: { id: charge.id, clientId: c.id, description: charge.description, amount: Number(charge.amount) || 0, dueDate: charge.dueDate, recurrence: charge.recurrence, recurrenceInterval: Number(charge.recurrenceInterval) || 0, paymentMethod: charge.paymentMethod, revision: charge.revision } });
      setCharge(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar a cobrança."); }
    setBusy(false);
  }
  async function submitPayment() {
    setBusy(true); setError("");
    try {
      await pay({ data: { chargeId: payment.id, amount: Number(payment.amount) || 0, method: payment.method, note: payment.note, confirmed: true } });
      setPayment(null); setPayConfirmed(false); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao registrar o pagamento."); }
    setBusy(false);
  }
  async function runReminders() {
    setBusy(true); setError(""); setNotice("");
    try { const r = await reminders({ data: { confirmed: true } }); setNotice(r.created ? `${r.created} lembrete(s) viraram tarefas internas. Nenhum e-mail foi enviado.` : "Nenhuma cobrança no prazo de lembrete."); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao gerar lembretes."); }
    setBusy(false);
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {([["Previsto", d.finance.previsto], ["Pendente", d.finance.pendente], ["Vencido", d.finance.vencido], ["Recebido", d.finance.recebido]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border p-4"><div className="text-xl font-semibold">{currency(v)}</div><div className="text-sm text-muted-foreground">{k}</div></div>
        ))}
      </div>
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Cobranças</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void runReminders()}>Gerar lembretes (tarefas internas)</Button>
            <Button size="sm" onClick={() => setCharge({ id: null, description: "", amount: "", dueDate: "", recurrence: "unica", recurrenceInterval: 0, paymentMethod: "", revision: 0 })}>Nova cobrança</Button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">Valores previstos são separados dos efetivamente recebidos. Pagamentos só são registrados com confirmação. Lembretes criam apenas tarefas para o gestor — envios por e-mail ficam desativados até a Brevo ser conectada e validada.</p>
        {notice && <p className="mb-2 text-sm text-primary">{notice}</p>}
        {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr><th className="p-2">Descrição</th><th className="p-2">Valor</th><th className="p-2">Vencimento</th><th className="p-2">Recorrência</th><th className="p-2">Status</th><th className="p-2">Ações</th></tr>
            </thead>
            <tbody>
              {d.charges.map((ch: any) => (
                <tr key={ch.id} className="border-t">
                  <td className="p-2">{ch.description}{(paymentsByCharge.get(ch.id) ?? []).map((p: any) => <span key={p.id} className="block text-xs text-muted-foreground">Recebido {currency(Number(p.amount))} em {fmtDate(p.paid_at)} ({p.method || "—"})</span>)}</td>
                  <td className="p-2">{currency(Number(ch.amount))}</td>
                  <td className="p-2">{fmtDate(ch.due_date)}</td>
                  <td className="p-2">{RECURRENCE[ch.recurrence as keyof typeof RECURRENCE]}{ch.recurrence === "personalizada" ? ` (${ch.recurrence_interval}d)` : ""}</td>
                  <td className="p-2">{CHARGE_STATUS[ch.status as keyof typeof CHARGE_STATUS]}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {(ch.status === "pendente" || ch.status === "vencido") && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => { setPayment({ id: ch.id, amount: String(ch.amount), method: ch.payment_method, note: "" }); setPayConfirmed(false); }}>Registrar pagamento</Button>
                          <Button size="sm" variant="ghost" onClick={() => setCharge({ id: ch.id, description: ch.description, amount: String(ch.amount), dueDate: ch.due_date, recurrence: ch.recurrence, recurrenceInterval: ch.recurrence_interval, paymentMethod: ch.payment_method, revision: Number(ch.revision) })}>Editar</Button>
                          <Button size="sm" variant="ghost" onClick={async () => { setError(""); try { await cancel({ data: { chargeId: ch.id, revision: Number(ch.revision), confirmed: true } }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao cancelar."); } }}>Cancelar</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!d.charges.length && <tr><td className="p-4 text-center text-muted-foreground" colSpan={6}>Nenhuma cobrança.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {(hc.data?.subscriptions.length || hc.data?.charges.length) ? (
        <section className="rounded-xl border p-4">
          <h2 className="mb-1 font-semibold">HyperCash</h2>
          <p className="mb-3 text-xs text-muted-foreground">Assinaturas e recebimentos sincronizados da HyperCash. Pagamentos confirmados entram no “Recebido” acima uma única vez; estornos e pendentes ficam apenas aqui até a confirmação.</p>
          {hc.data?.subscriptions.length ? (
            <ul className="mb-3 space-y-1 text-sm">
              {hc.data.subscriptions.map((s: any) => (
                <li key={s.subscription_id} className="flex flex-wrap justify-between gap-2 rounded-md border px-3 py-2">
                  <span>{s.product_name ?? "Assinatura"} <span className="text-muted-foreground">· {HC_SUB_LABEL[s.status as HcSubStatus] ?? s.status}</span></span>
                  <span className="text-muted-foreground">{currency(Number(s.amount_cents ?? 0) / 100)} · próxima {s.next_billing_date ? fmtDate(s.next_billing_date.slice(0, 10)) : "—"}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {hc.data?.charges.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-2">Cobrança</th><th className="p-2">Valor</th><th className="p-2">Status</th><th className="p-2">Pago em</th><th className="p-2">Transação</th></tr></thead>
                <tbody>
                  {hc.data.charges.map((h: any) => (
                    <tr key={h.id} className="border-t">
                      <td className="p-2">{fmtDate((h.billing_date ?? "").slice(0, 10))}</td>
                      <td className="p-2">{currency(Number(h.amount_cents ?? 0) / 100)}</td>
                      <td className="p-2">{HC_CHARGE_LABEL[h.status as HcChargeStatus] ?? h.status}{h.finance_payment_id ? " · no Financeiro" : ""}</td>
                      <td className="p-2">{h.paid_at ? fmtDate(h.paid_at.slice(0, 10)) : "—"}</td>
                      <td className="p-2 font-mono text-xs">{h.transaction_id ?? h.charge_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
      <ClientBankHistory clientId={c.id}/>
      <Dialog open={!!charge} onOpenChange={() => setCharge(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{charge?.id ? "Editar cobrança" : "Nova cobrança"}</DialogTitle></DialogHeader>
          {charge && (
            <div className="space-y-3">
              <div><Label>Descrição</Label><Input value={charge.description} onChange={e => setCharge({ ...charge, description: e.target.value })} placeholder="Ex.: Mensalidade tráfego pago" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Valor (R$)</Label><Input type="number" min={0} step="0.01" value={charge.amount} onChange={e => setCharge({ ...charge, amount: e.target.value })} /></div>
                <div><Label>Vencimento</Label><Input type="date" value={charge.dueDate} onChange={e => setCharge({ ...charge, dueDate: e.target.value })} /></div>
                <div>
                  <Label>Recorrência</Label>
                  <Select value={charge.recurrence} onValueChange={v => setCharge({ ...charge, recurrence: v })} disabled={!!charge.id}>
                    <SelectTrigger aria-label="Recorrência"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(RECURRENCE).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {charge.recurrence === "personalizada" && (
                  <div><Label>Intervalo (dias)</Label><Input type="number" min={1} max={365} value={charge.recurrenceInterval} onChange={e => setCharge({ ...charge, recurrenceInterval: e.target.value })} /></div>
                )}
                <div><Label>Forma de pagamento</Label><Input value={charge.paymentMethod} onChange={e => setCharge({ ...charge, paymentMethod: e.target.value })} placeholder="Pix, boleto, cartão" /></div>
              </div>
              {!charge.id && charge.recurrence !== "unica" && <p className="text-xs text-muted-foreground">Os vencimentos dos próximos 12 meses serão gerados no controle interno.</p>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button disabled={busy || charge.description.trim().length < 2 || !charge.dueDate} onClick={() => void submitCharge()}>Salvar cobrança</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!payment} onOpenChange={() => setPayment(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar pagamento</DialogTitle></DialogHeader>
          {payment && (
            <div className="space-y-3">
              <div><Label>Valor recebido (R$)</Label><Input type="number" min={0} step="0.01" value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} /></div>
              <div><Label>Forma de pagamento</Label><Input value={payment.method} onChange={e => setPayment({ ...payment, method: e.target.value })} /></div>
              <div><Label>Observação</Label><Input value={payment.note} onChange={e => setPayment({ ...payment, note: e.target.value })} /></div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={payConfirmed} onCheckedChange={v => setPayConfirmed(v === true)} />
                Confirmo que este valor foi efetivamente recebido.
              </label>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button disabled={busy || !payConfirmed || !(Number(payment.amount) > 0)} onClick={() => void submitPayment()}>Confirmar recebimento</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
