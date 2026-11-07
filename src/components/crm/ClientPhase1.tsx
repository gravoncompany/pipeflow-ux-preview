import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, FolderKanban, Link2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  generateClientAiReport, getClientCampaignMetrics, getClientKnowledgeBase, linkExistingProject, listLinkableProjects,
  listPortalAdAccounts, saveClientProject, setClientAdAccount, getClientAdAccountMetrics, listClientLinkedAdAccounts,
} from "@/lib/crm-client-phase1.functions";
import { PROJECT_STATUS, type ProjectStatus } from "@/lib/crm-client-metrics";
import { currency } from "@/lib/revenue";
import { MetaClientCards, fmt as fmtMeta, type MetaPeriod } from "@/components/crm/MetaClientCards";
import type { MetaCardKey } from "@/lib/client-meta-metrics";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const PLATFORM = { meta_ads: "Meta Ads", google_ads: "Google Ads" } as const;
const money = (v: number | null) => (v === null ? "Sem dado" : currency(v));

/** Visão geral: indicadores de campanhas do cliente + vínculo das contas do Portal + relatório da Pipeflow IA. */
export function ClientCampaignPanel({ clientId, knowledge }: { clientId: string; knowledge: { kind: string; title: string; text: string; created_at: string }[] }) {
  const metricsFn = useServerFn(getClientCampaignMetrics), reportFn = useServerFn(generateClientAiReport);
  const q = useQuery({ queryKey: ["client-campaign-metrics", clientId], queryFn: () => metricsFn({ data: { clientId } }), retry: false });
  const qc = useQueryClient();
  const [accountsOpen, setAccountsOpen] = useState<false | "meta_ads" | "google_ads">(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const saved = knowledge.filter((k) => k.kind === "relatorio_ia")[0];
  const [period, setPeriod] = useState<MetaPeriod | null>({ preset: "last_30d" });
  const [report, setReport] = useState<null | { summary: string; opportunities: string[]; alerts: string[]; nextSteps: { priority: string; action: string }[]; limitations: string[]; performance?: Perf; client?: { name: string; status: string; services: string } }>(() => {
    try { return saved ? JSON.parse(saved.text) : null; } catch { return null; }
  });
  const m = q.data?.metrics;
  const cards: { label: string; value: string; note?: string }[] = m ? [
    { label: "Leads recebidos hoje", value: m.leadsToday === null ? "Sem dado" : String(m.leadsToday), note: m.leadsToday === null ? "O Portal ainda não envia leads por empresa." : undefined },
    { label: "Leads (30 dias)", value: m.leads30 === null ? "Sem dado" : String(m.leads30) },
    { label: "Investimento (30 dias)", value: money(m.investment30), note: m.investmentToday !== null ? `Hoje: ${currency(m.investmentToday)}` : undefined },
    { label: "Custo por lead", value: m.costPerLead === null ? "Sem dado" : currency(m.costPerLead), note: m.costPerLead === null ? "Precisa de leads por empresa." : undefined },
  ] : [];
  return <section className="space-y-4 rounded-xl border p-4" aria-label="Campanhas do cliente">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">Campanhas</h2><p className="text-xs text-muted-foreground">Últimos 30 dias{q.data ? ` · ${q.data.period.from.split("-").reverse().join("/")} a ${q.data.period.today.split("-").reverse().join("/")}` : ""}{m?.lastUpdate ? ` · atualizado em ${new Date(m.lastUpdate).toLocaleString("pt-BR")}` : ""}</p></div>
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setAccountsOpen("meta_ads")}><Link2 className="size-4" />Selecionar conta Meta Ads</Button><Button size="sm" variant="outline" onClick={() => setAccountsOpen("google_ads")}><Link2 className="size-4" />Selecionar conta Google Ads</Button><Button size="sm" variant="ghost" aria-label="Atualizar indicadores" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw className="size-4" /></Button></div>
    </div>
    {q.isPending && <p className="text-sm text-muted-foreground">Carregando indicadores…</p>}
    {q.isError && <p role="alert" className="text-sm text-destructive">Não foi possível ler os indicadores.</p>}
    {q.data?.portalError && <p className="text-xs text-destructive">Portal: {q.data.portalError}</p>}
    {m && m.accounts === 0 && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Nenhuma conta de anúncio vinculada a este cliente. Use os botões acima para escolher as contas do Google Ads e da Meta que pertencem a ele.</p>}
    {m && <>
      <MetaClientCards clientId={clientId} onPeriodChange={setPeriod} />
      <div className="grid gap-2 sm:grid-cols-2">{m.platforms.map((p) => <div key={p.platform} className="rounded-lg border p-3 text-sm"><p className="font-medium">{PLATFORM[p.platform]}</p>
        {p.source === "none" ? <p className="text-muted-foreground">Sem conta vinculada.</p> : <><p>30 dias: <b>{money(p.last30)}</b> · hoje: {money(p.today)}</p><p className="text-xs text-muted-foreground">Fonte: {p.source === "meta_api" ? "API da Meta (Financeiro › Tráfego pago)" : "Portal Gravon"}{p.lastDate ? ` · último dia com dado ${p.lastDate.split("-").reverse().join("/")}` : ""}{p.unknownDays ? ` · ${p.unknownDays} dia(s) sem valor` : ""}</p></>}
      </div>)}</div>
    </>}
    <ClientAdAccountsDirect clientId={clientId} version={accountsOpen ? 1 : 0} />
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><Brain className="size-4 text-primary" />Relatório da Pipeflow IA</h3>
        <Button size="sm" disabled={busy || !period} onClick={() => void (async () => { if (!period) return; setBusy(true); setError(""); try { const r = await reportFn({ data: { clientId, ...period } }); setReport({ ...r.report, performance: r.performance }); await qc.invalidateQueries({ queryKey: ["crm-client", clientId] }); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao gerar."); } finally { setBusy(false); } })()}><Sparkles className="size-4" />{busy ? "Analisando…" : report ? "Gerar novo relatório" : "Gerar relatório"}</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!report && !busy && <p className="text-sm text-muted-foreground">A IA analisa só os dados disponíveis acima e os projetos do cliente; quando faltar dado, ela avisa em vez de estimar.</p>}
      {report && <div className="space-y-2 text-sm">
        {report.client && <p className="text-xs text-muted-foreground"><b>{report.client.name}</b>{report.client.services ? ` · ${report.client.services}` : ""} · situação: {report.client.status}</p>}
        {report.performance && <PerfBlock p={report.performance} />}
        <p className="font-medium">Análise da Pipeflow IA</p>
        <p>{report.summary}</p>
        {[["Oportunidades", report.opportunities], ["Alertas", report.alerts], ["Limitações dos dados", report.limitations]].map(([t, list]) => (list as string[]).length ? <div key={t as string}><p className="font-medium">{t as string}</p><ul className="list-disc pl-5">{(list as string[]).map((x) => <li key={x}>{x}</li>)}</ul></div> : null)}
        {report.nextSteps.length > 0 && <div><p className="font-medium">Próximos passos</p><ul className="space-y-1">{report.nextSteps.map((s) => <li key={s.action} className="flex gap-2"><Badge variant={s.priority === "alta" ? "default" : "secondary"}>{s.priority}</Badge>{s.action}</li>)}</ul></div>}
        {saved && <p className="text-xs text-muted-foreground">Guardado no conhecimento do cliente · {new Date(saved.created_at).toLocaleString("pt-BR")}</p>}
      </div>}
    </div>
    <AdAccountsDialog clientId={clientId} platform={accountsOpen || "meta_ads"} open={Boolean(accountsOpen)} onClose={() => { setAccountsOpen(false); void q.refetch(); void qc.invalidateQueries({ queryKey: ["client-linked-ad-accounts", clientId] }); }} />
  </section>;
}

function AdAccountsDialog({ clientId, platform, open, onClose }: { clientId: string; platform: "meta_ads" | "google_ads"; open: boolean; onClose: () => void }) {
  const listFn = useServerFn(listPortalAdAccounts), setFn = useServerFn(setClientAdAccount);
  const q = useQuery({ queryKey: ["portal-ad-accounts", clientId], queryFn: () => listFn({ data: { clientId } }), enabled: open, retry: false });
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  return <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>Selecionar conta {PLATFORM[platform]}</DialogTitle><DialogDescription>Contas autorizadas na Central de Integrações e as que o Portal Gravon acompanha. Cada conta pertence a um único cliente; clique de novo em “Vinculada” para remover o vínculo.</DialogDescription></DialogHeader>
    {q.isPending && <p className="text-sm text-muted-foreground">Lendo contas do Portal…</p>}
    {q.data?.error && <p className="text-sm text-muted-foreground">Portal: {q.data.error}</p>}
    {q.data?.apiStatus && (platform === "meta_ads" ? q.data.apiStatus.meta : q.data.apiStatus.google) && <p className="text-sm text-muted-foreground">{platform === "meta_ads" ? q.data.apiStatus.meta : q.data.apiStatus.google} Configure em Configurações › API e Integrações.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <ul className="divide-y">{q.data?.accounts.filter((a) => a.platform === platform).map((a) => <li key={`${a.platform}:${a.account_id}`} className="flex items-center justify-between gap-2 py-2 text-sm">
      <span className="min-w-0"><b>{a.account_name || a.account_id}</b><span className="block text-xs text-muted-foreground">{PLATFORM[a.platform as keyof typeof PLATFORM] ?? a.platform} · {a.account_id} · {a.sources.join(" + ")}{a.takenByOther ? " · vinculada a outro cliente" : ""}</span></span>
      <Button size="sm" variant={a.mine ? "default" : "outline"} disabled={Boolean(busy) || a.takenByOther} onClick={() => void (async () => { setBusy(a.account_id); setError(""); try { await setFn({ data: { clientId, platform: a.platform as "meta_ads" | "google_ads", accountId: a.account_id, accountName: a.account_name, linked: !a.mine } }); await q.refetch(); } catch (e) { setError(e instanceof Error ? e.message : "Falha."); } finally { setBusy(""); } })()}>{a.mine ? "Vinculada" : "Vincular"}</Button>
    </li>)}</ul>
    {q.data && !q.data.accounts.some((a) => a.platform === platform) && <p className="text-sm text-muted-foreground">Nenhuma conta {PLATFORM[platform]} disponível nas integrações nem no Portal.</p>}
  </DialogContent></Dialog>;
}

type Project = { id: string; name: string; service: string; responsible: string; start_date: string | null; end_date: string | null; status: ProjectStatus; objectives: string; strategic_plan: string; crm_project_id: string | null; revision: number; created_at: string };
const blank = (clientId: string) => ({ id: null as string | null, clientId, revision: 0, name: "", service: "", responsible: "", startDate: null as string | null, endDate: null as string | null, status: "planejado" as ProjectStatus, objectives: "", strategicPlan: "" });

/** Aba Projetos: vários projetos por cliente, criar ou vincular da Central de Projetos; documentos por projeto. */
export function ClientProjects({ clientId, projects, documents, onChanged, onUpload }: {
  clientId: string; projects: Project[]; documents: { id: string; name: string; project_id: string | null }[];
  onChanged: () => Promise<unknown>; onUpload: (projectId: string) => void;
}) {
  const saveFn = useServerFn(saveClientProject), listFn = useServerFn(listLinkableProjects), linkFn = useServerFn(linkExistingProject);
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null), [linkOpen, setLinkOpen] = useState(false);
  const linkable = useQuery({ queryKey: ["linkable-projects", clientId], queryFn: () => listFn({ data: { clientId } }), enabled: linkOpen, retry: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const edit = (p: Project) => setForm({ id: p.id, clientId, revision: p.revision, name: p.name, service: p.service, responsible: p.responsible, startDate: p.start_date, endDate: p.end_date, status: p.status, objectives: p.objectives, strategicPlan: p.strategic_plan });
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Falha."); } finally { setBusy(false); } };
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold"><FolderKanban className="size-4 text-primary" />Projetos ({projects.length})</h2>
      <div className="flex gap-2"><Button size="sm" onClick={() => setForm(blank(clientId))}><Plus className="size-4" />Criar projeto</Button><Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}><Link2 className="size-4" />Vincular projeto existente</Button></div></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!projects.length && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum projeto ainda. Crie um projeto ou vincule um da Central de Projetos.</p>}
    <ul className="grid gap-3 md:grid-cols-2">{projects.map((p) => { const docs = documents.filter((d) => d.project_id === p.id); return <li key={p.id} className="space-y-2 rounded-xl border p-4 text-sm">
      <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{p.name}</p><p className="text-xs text-muted-foreground">{p.service || "Serviço não informado"}{p.crm_project_id ? " · vinculado à Central de Projetos" : ""}</p></div><Badge variant={p.status === "em_andamento" ? "default" : "secondary"}>{PROJECT_STATUS[p.status]}</Badge></div>
      <p className="text-xs text-muted-foreground">Responsável: {p.responsible || "—"} · {p.start_date ? p.start_date.split("-").reverse().join("/") : "sem início"} → {p.end_date ? p.end_date.split("-").reverse().join("/") : "sem fim"}</p>
      {p.objectives && <p><span className="font-medium">Objetivos:</span> {p.objectives}</p>}
      {p.strategic_plan && <details><summary className="cursor-pointer text-primary">Planejamento estratégico</summary><p className="mt-1 whitespace-pre-wrap">{p.strategic_plan}</p></details>}
      <p className="text-xs">Documentos: {docs.length ? docs.map((d) => d.name).join(", ") : "nenhum"}</p>
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => edit(p)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => onUpload(p.id)}>Anexar documento</Button></div>
    </li>; })}</ul>
    <Dialog open={Boolean(form)} onOpenChange={(v) => { if (!v && !busy) setForm(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{form?.id ? "Editar projeto" : "Criar projeto"}</DialogTitle><DialogDescription>Fica vinculado só a este cliente.</DialogDescription></DialogHeader>
      {form && <div className="space-y-3">
        <div><Label htmlFor="pj-name">Nome do projeto</Label><Input id="pj-name" value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="pj-service">Serviço contratado</Label><Input id="pj-service" value={form.service} maxLength={300} onChange={(e) => setForm({ ...form, service: e.target.value })} /></div><div><Label htmlFor="pj-resp">Responsável</Label><Input id="pj-resp" value={form.responsible} maxLength={160} onChange={(e) => setForm({ ...form, responsible: e.target.value })} /></div></div>
        <div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="pj-start">Início</Label><Input id="pj-start" type="date" value={form.startDate ?? ""} onChange={(e) => setForm({ ...form, startDate: e.target.value || null })} /></div><div><Label htmlFor="pj-end">Fim</Label><Input id="pj-end" type="date" value={form.endDate ?? ""} onChange={(e) => setForm({ ...form, endDate: e.target.value || null })} /></div>
          <div><Label htmlFor="pj-status">Status</Label><select id="pj-status" className={selectClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div></div>
        <div><Label htmlFor="pj-obj">Objetivos</Label><Textarea id="pj-obj" rows={3} maxLength={5000} value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} /></div>
        <div><Label htmlFor="pj-plan">Planejamento estratégico</Label><Textarea id="pj-plan" rows={6} maxLength={20000} value={form.strategicPlan} onChange={(e) => setForm({ ...form, strategicPlan: e.target.value })} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button disabled={busy || form.name.trim().length < 2} onClick={() => void run(async () => { await saveFn({ data: form }); setForm(null); await onChanged(); })}>{busy ? "Salvando…" : "Salvar projeto"}</Button>
      </div>}
    </DialogContent></Dialog>
    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Vincular projeto existente</DialogTitle><DialogDescription>Projetos da Central de Projetos. O projeto original não é alterado.</DialogDescription></DialogHeader>
      {linkable.isPending && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <ul className="divide-y">{linkable.data?.projects.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="min-w-0"><b>{p.name}</b><span className="block text-xs text-muted-foreground">{p.responsible || "Sem responsável"} · {p.status}</span></span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await linkFn({ data: { clientId, projectId: p.id } }); await linkable.refetch(); await onChanged(); })}>Vincular</Button></li>)}</ul>
      {linkable.data && !linkable.data.projects.length && <p className="text-sm text-muted-foreground">Nenhum projeto disponível para vincular.</p>}
    </DialogContent></Dialog>
  </section>;
}

/** Base de conhecimento organizada (preparada para a Pipeflow IA no WhatsApp, que segue desligada). */
export function ClientKnowledgeBase({ clientId }: { clientId: string }) {
  const fn = useServerFn(getClientKnowledgeBase);
  const q = useQuery({ queryKey: ["client-knowledge-base", clientId], queryFn: () => fn({ data: { clientId } }), retry: false });
  return <section className="rounded-xl border p-4">
    <h2 className="font-semibold">Base de conhecimento do cliente</h2>
    <p className="text-xs text-muted-foreground">Organizada para uso futuro pela Pipeflow IA no atendimento por WhatsApp. Respostas automáticas continuam desligadas.</p>
    {q.isPending && <p className="mt-2 text-sm text-muted-foreground">Organizando…</p>}
    <div className="mt-3 space-y-2">{q.data?.sections.map((s) => <details key={s.key} className="rounded-md border p-2 text-sm"><summary className="cursor-pointer font-medium">{s.title} ({s.items.length})</summary>
      {s.items.length ? <ul className="mt-1 list-disc pl-5 text-xs">{s.items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">Ainda sem informações.</p>}</details>)}</div>
  </section>;
}

const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);

/** Contas de Anúncios vinculadas + métricas consultadas direto nas APIs (somente leitura). */
function ClientAdAccountsDirect({ clientId, version }: { clientId: string; version: number }) {
  const listFn = useServerFn(listClientLinkedAdAccounts), metricsFn = useServerFn(getClientAdAccountMetrics), setFn = useServerFn(setClientAdAccount);
  const q = useQuery({ queryKey: ["client-linked-ad-accounts", clientId, version], queryFn: () => listFn({ data: { clientId } }), retry: false });
  const [since, setSince] = useState(() => isoDay(new Date(Date.now() - 29 * 86400000))), [until, setUntil] = useState(() => isoDay(new Date()));
  const [res, setRes] = useState<Record<string, { loading?: boolean; error?: string | null; m?: Awaited<ReturnType<typeof metricsFn>>["metrics"] }>>({});
  const load = async (a: { platform: "meta_ads" | "google_ads"; account_id: string }) => {
    const k = `${a.platform}:${a.account_id}`; setRes((r) => ({ ...r, [k]: { loading: true } }));
    try { const r = await metricsFn({ data: { clientId, platform: a.platform, accountId: a.account_id, since, until } }); setRes((x) => ({ ...x, [k]: { error: r.error, m: r.metrics } })); }
    catch (e) { setRes((x) => ({ ...x, [k]: { error: e instanceof Error ? e.message : "Falha." } })); }
  };
  const fmt = (v: number | null | undefined, cur: string) => v == null ? "Não disponível" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur || "BRL" }).format(v);
  const n = (v: number | null | undefined, d = 0) => v == null ? "Não disponível" : v.toLocaleString("pt-BR", { maximumFractionDigits: d });
  return <div className="space-y-2 border-t pt-3">
    <div className="flex flex-wrap items-end justify-between gap-2"><h3 className="font-semibold">Contas de Anúncios</h3>
      <div className="flex items-end gap-2 text-xs"><label>De<Input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="h-8" /></label><label>Até<Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="h-8" /></label></div></div>
    {q.isError && <p role="alert" className="text-sm text-destructive">Não foi possível ler as contas vinculadas.</p>}
    {q.data && !q.data.length && <p className="text-sm text-muted-foreground">Nenhuma conta vinculada.</p>}
    <ul className="space-y-2">{q.data?.map((a) => { const k = `${a.platform}:${a.account_id}`, r = res[k]; return <li key={k} className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{a.account_name || a.account_id}</b><span className="block text-xs text-muted-foreground">{PLATFORM[a.platform]} · {a.account_id}</span></span>
        <span className="flex gap-2"><Button size="sm" variant="outline" disabled={r?.loading} onClick={() => void load(a)}>{r?.loading ? "Consultando…" : "Consultar métricas"}</Button>
        <Button size="sm" variant="ghost" onClick={() => void (async () => { if (!window.confirm("Remover o vínculo desta conta com o cliente? Os dados já guardados não são apagados.")) return; await setFn({ data: { clientId, platform: a.platform, accountId: a.account_id, accountName: a.account_name, linked: false } }); await q.refetch(); })()}>Remover</Button></span></div>
      {r?.error && <p className="mt-2 text-xs text-destructive">{r.error}</p>}
      {r?.m && <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">{[
        ["Investimento", fmt(r.m.spend, r.m.currency)], ["Impressões", n(r.m.impressions)], ["Alcance", n(r.m.reach)], ["Cliques", n(r.m.clicks)], ["CPC", fmt(r.m.cpc, r.m.currency)],
        ["CTR", r.m.ctr == null ? "Não disponível" : `${n(r.m.ctr, 2)}%`], [r.m.resultLabel, n(r.m.results, 1)], ["Custo por resultado", fmt(r.m.costPerResult, r.m.currency)], ["Campanhas ativas", n(r.m.activeCampaigns)], ["Período", `${since.split("-").reverse().join("/")} a ${until.split("-").reverse().join("/")}`],
      ].map(([l, v]) => <div key={l} className="rounded-md bg-muted/40 p-2"><dt className="text-[11px] text-muted-foreground">{l}</dt><dd className="font-medium">{v}</dd></div>)}</dl>}
    </li>; })}</ul>
    <p className="text-xs text-muted-foreground">Consulta somente leitura, direto na Meta e no Google. Nada é alterado nas campanhas e os indicadores do Portal acima continuam como estão.</p>
  </div>;
}

type Perf = { source: string; fetchedAt: string; range: { since: string; until: string }; previousRange: { since: string; until: string }; accounts: { id: string; name: string }[]; errors: string[]; previousErrors: string[]; cards: { key: string; label: string; value: number | null; previous: number | null }[] };
const br = (d: string) => d.split("-").reverse().join("/");
function PerfBlock({ p }: { p: Perf }) {
  return <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
    <p className="font-medium">Desempenho das campanhas · {br(p.range.since)} a {br(p.range.until)}</p>
    <p className="text-xs text-muted-foreground">Fonte: {p.source}{p.accounts.length ? ` (${p.accounts.map(a => a.name || a.id).join(", ")})` : ""} · consultado em {new Date(p.fetchedAt).toLocaleString("pt-BR")} · comparação com {br(p.previousRange.since)} a {br(p.previousRange.until)}</p>
    {!p.accounts.length && <p className="text-xs text-muted-foreground">Nenhuma conta Meta Ads vinculada a este cliente.</p>}
    {p.errors.map(e => <p key={e} className="text-xs text-destructive">{e}</p>)}
    {p.accounts.length > 0 && !p.errors.length && <dl className="grid gap-2 sm:grid-cols-4">{p.cards.map(c => {
      const delta = c.value !== null && c.previous ? ((c.value - c.previous) / c.previous) * 100 : null;
      return <div key={c.key} className="rounded-md border bg-card p-2"><dt className="text-xs text-muted-foreground">{c.label}</dt><dd className="font-semibold">{fmtMeta(c.key as MetaCardKey, c.value)}</dd><dd className="text-xs text-muted-foreground">Anterior: {fmtMeta(c.key as MetaCardKey, c.previous)}{delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%)` : ""}</dd></div>;
    })}</dl>}
  </div>;
}
