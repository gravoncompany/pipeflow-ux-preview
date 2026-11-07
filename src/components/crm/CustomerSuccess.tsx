import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Brain, CalendarCheck, LayoutGrid, List, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmAuthGate } from "./CrmAuthGate";
import { AtendimentoLayout } from "./AtendimentoLayout";
import { PipeflowSymbol } from "@/components/brand/PipeflowLogo";
import { analyzeCs, getCsDetail, getCsOverview, updateCs } from "@/lib/customer-success.functions";
import { CS_HEALTH, CS_RISK, CS_STAGES, filterCsClients, healthSchema, riskForHealth, stageSchema, diagnosisSchema } from "@/lib/customer-success";
import { CLIENT_STATUS } from "@/lib/crm-clients";
import type { z } from "zod";
import { ClientSuccessManagement } from "./ClientSuccessManagement";

type Stage = z.infer<typeof stageSchema>;
type Health = z.infer<typeof healthSchema>;
type CsRow = Awaited<ReturnType<typeof getCsOverview>>["clients"][number];
const date = (v: string | null) => v ? new Date(v).toLocaleDateString("pt-BR") : "Nunca registrado";

export function HealthBadge({ health }: { health: string | null }) {
  const parsed = healthSchema.safeParse(health);
  return <Badge variant={health === "em_risco" ? "destructive" : health === "saudavel" ? "default" : "secondary"} className="gap-1 rounded-md"><Activity className="size-3" />{parsed.success ? CS_HEALTH[parsed.data] : "Sem avaliação"}</Badge>;
}

function Filter({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: Record<string, string> }) {
  return <div className="min-w-40 flex-1"><Label className="mb-1 block text-xs text-muted-foreground">{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(items).map(([key, text]) => <SelectItem value={key} key={key}>{text}</SelectItem>)}</SelectContent></Select></div>;
}

export function CustomerSuccess({ central = false }: { central?: boolean }) {
  const q = useQuery({ queryKey: ["customer-success"], queryFn: () => getCsOverview(), retry: false });
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeCs);
  const updating = useServerFn(updateCs);
  const [filters, setFilters] = useState({ search: "", status: "todos", health: "todos", risk: "todos", responsible: "todos", followup: "todos" });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<CsRow | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; status: string }[]>([]);
  const lock = useRef(false);
  if (q.isPending) return <AtendimentoLayout><p className="p-8 text-muted-foreground">Carregando pós-venda…</p></AtendimentoLayout>;
  if (q.isError) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const rows = q.data.clients;
  const visible = filterCsClients(rows, filters);
  const selected = rows.filter(c => selection.has(c.id));
  const setFilter = (k: keyof typeof filters, v: string) => setFilters(f => ({ ...f, [k]: v }));
  const toggle = (id: string, checked: boolean) => setSelection(s => { const next = new Set(s); if (checked) next.add(id); else next.delete(id); return next; });
  async function move(c: CsRow, stage: Stage) {
    if (lock.current || stage === c.stage) return;
    lock.current = true; setBusy(c.id); setError("");
    try { await updating({ data: { clientId: c.id, stage, revision: c.revision, eventId: crypto.randomUUID(), note: "" } }); await qc.invalidateQueries({ queryKey: ["customer-success"] }); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível mover o cliente."); }
    finally { lock.current = false; setBusy(""); }
  }
  async function analyzeSelected() {
    if (lock.current || !selected.length) return;
    lock.current = true; setBusy("analysis"); setError(""); setResults([]);
    const outcomes: typeof results = [];
    for (let index = 0; index < selected.length; index++) {
      const c = selected[index];
      setProgress(`${index + 1}/${selected.length} · ${c.trade_name}`);
      try { await analyze({ data: { clientId: c.id, eventId: crypto.randomUUID() } }); outcomes.push({ id: c.id, name: c.trade_name, status: "Diagnóstico registrado" }); }
      catch (e) { outcomes.push({ id: c.id, name: c.trade_name, status: e instanceof Error ? e.message : "Não concluído" }); }
      setResults([...outcomes]);
      if (outcomes.at(-1)?.status.includes("Créditos") || outcomes.at(-1)?.status.includes("A IA não concluiu")) break;
    }
    await qc.invalidateQueries({ queryKey: ["cs-detail"] });
    setProgress(""); setBusy(""); lock.current = false;
  }
  const allVisible = visible.length > 0 && visible.every(c => selection.has(c.id));
  return <AtendimentoLayout className="cs-workspace"><main className="min-w-0 w-full flex-1 space-y-5 overflow-x-hidden p-3 md:p-7">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="mb-1 flex items-center gap-2 text-primary"><Activity className="size-5" /><span className="text-sm font-medium">Customer Success</span></div><h1 className="text-2xl font-semibold">{central ? "Central de Saúde dos Clientes" : "Pós-venda"}</h1></div><Button variant="outline" size="icon" aria-label="Atualizar pós-venda" title="Atualizar pós-venda" onClick={() => void q.refetch()}><RefreshCw className="size-4" /></Button></header>
    <nav className="flex flex-wrap gap-2" aria-label="Visões de pós-venda"><Button variant={!central ? "default" : "outline"} asChild><Link to="/pos-venda"><LayoutGrid className="size-4" />Funil de clientes</Link></Button><Button variant={central ? "default" : "outline"} asChild><Link to="/pos-venda/saude"><List className="size-4" />Saúde dos clientes</Link></Button></nav>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[{ label: "Clientes", count: rows.length, icon: List }, ...Object.entries(CS_HEALTH).map(([key, label]) => ({ label, count: rows.filter(c => c.health === key).length, icon: key === "em_risco" ? ShieldAlert : Activity }))].map(stat => <div key={stat.label} className="border-b-2 border-primary/20 py-3"><div className="flex items-center gap-2 text-sm text-muted-foreground"><stat.icon className="size-4" />{stat.label}</div><div className="mt-1 text-3xl font-semibold">{stat.count}</div></div>)}</div>
    <div className="flex flex-wrap gap-3"><div className="min-w-48 flex-1"><Label className="mb-1 block text-xs text-muted-foreground">Cliente</Label><Input aria-label="Pesquisar cliente no pós-venda" value={filters.search} onChange={e => setFilter("search", e.target.value)} placeholder="Pesquisar cliente" /></div><Filter label="Situação cadastral" value={filters.status} onChange={v => setFilter("status", v)} items={{ todos: "Todas as situações", ...CLIENT_STATUS }} /><Filter label="Saúde" value={filters.health} onChange={v => setFilter("health", v)} items={{ todos: "Todas", ...CS_HEALTH, sem_avaliacao: "Sem avaliação" }} />{central && <><Filter label="Nível de risco" value={filters.risk} onChange={v => setFilter("risk", v)} items={{ todos: "Todos", ...CS_RISK, sem_avaliacao: "Não avaliado" }} /><Filter label="Responsável do cliente" value={filters.responsible} onChange={v => setFilter("responsible", v)} items={{ todos: "Todos", sem_responsavel: "Sem responsável", ...Object.fromEntries(rows.filter(c => c.internal_responsible).map(c => [c.internal_responsible, c.internal_responsible])) }} /><Filter label="Último acompanhamento" value={filters.followup} onChange={v => setFilter("followup", v)} items={{ todos: "Todos", nunca: "Nunca registrado", atrasado: "30 dias ou mais / nunca", recente: "Últimos 30 dias" }} /></>}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3"><label className="flex items-center gap-2 text-sm"><Checkbox aria-label="Selecionar clientes visíveis" checked={allVisible} onCheckedChange={v => setSelection(s => { const next = new Set(s); visible.forEach(c => v === true ? next.add(c.id) : next.delete(c.id)); return next; })} />{selected.length} selecionado{selected.length === 1 ? "" : "s"} · {visible.length} exibido{visible.length === 1 ? "" : "s"}</label><Button disabled={!!busy || !selected.length} onClick={() => void analyzeSelected()}><PipeflowSymbol alt="" className="size-4" />{busy === "analysis" ? "Analisando…" : "Analisar com Pipeflow IA"}</Button></div>
    {progress && <p role="status" className="text-sm text-primary">{progress}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!!results.length && <div className="space-y-2 border-l-2 border-primary pl-4">{results.map(r => <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{r.name}</span><span className="text-muted-foreground">{r.status}</span>{r.status === "Diagnóstico registrado" && <Button size="sm" variant="ghost" onClick={() => setDetail(rows.find(c => c.id === r.id) ?? null)}>Ver diagnóstico<ArrowRight className="size-3" /></Button>}</div>)}</div>}
    {central ? <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{["", "Cliente", "Etapa", "Saúde / Risco", "Responsável", "Último acompanhamento", ""].map((t, i) => <th key={i} className="p-3 font-medium">{t}</th>)}</tr></thead><tbody>{visible.map(c => <tr key={c.id} className="border-t"><td className="p-3"><Checkbox aria-label={`Selecionar ${c.trade_name}`} checked={selection.has(c.id)} onCheckedChange={v => toggle(c.id, v === true)} /></td><td className="p-3 font-medium"><Link to="/clientes/$id" params={{ id: c.id }} className="text-primary">{c.trade_name}</Link></td><td className="p-3 whitespace-nowrap">{CS_STAGES[stageSchema.parse(c.stage)]}</td><td className="p-3"><HealthBadge health={c.health} /><span className="mt-1 block text-xs text-muted-foreground">{c.health ? CS_RISK[riskForHealth(healthSchema.parse(c.health))] : "Não avaliado"}</span></td><td className="p-3">{c.internal_responsible || "—"}</td><td className="p-3 whitespace-nowrap">{date(c.last_followup_at)}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => setDetail(c)}>Avaliações</Button></td></tr>)}</tbody></table>{!visible.length && <p className="p-8 text-center text-muted-foreground">Nenhum cliente encontrado.</p>}</div> : <div className="overflow-x-auto pb-4"><div className="grid min-w-[1500px] grid-cols-6 gap-4">{Object.entries(CS_STAGES).map(([stage, label]) => <section key={stage} className="min-w-0" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const client = rows.find(c => c.id === e.dataTransfer.getData("text/plain")); if (client) void move(client, stageSchema.parse(stage)); }}><h2 className="mb-3 flex items-center justify-between border-t-2 border-primary/40 pt-3 text-sm font-semibold">{label}<span className="text-muted-foreground">{visible.filter(c => c.stage === stage).length}</span></h2><div className="space-y-3">{visible.filter(c => c.stage === stage).map(c => <article key={c.id} draggable={!busy} onDragStart={e => e.dataTransfer.setData("text/plain", c.id)} className="space-y-3 rounded-lg border bg-card p-3 shadow-sm"><div className="flex items-start gap-2"><Checkbox aria-label={`Selecionar ${c.trade_name}`} checked={selection.has(c.id)} onCheckedChange={v => toggle(c.id, v === true)} /><Link to="/clientes/$id" params={{ id: c.id }} className="min-w-0 break-words font-semibold text-primary">{c.trade_name}</Link></div><HealthBadge health={c.health} /><div className="space-y-1 text-xs text-muted-foreground"><p>{c.internal_responsible || "Sem responsável"}</p><p>Acompanhamento: {date(c.last_followup_at)}</p></div><Select value={c.stage} onValueChange={v => void move(c, stageSchema.parse(v))} disabled={!!busy}><SelectTrigger aria-label={`Etapa de ${c.trade_name}`} className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CS_STAGES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" className="w-full" onClick={() => setDetail(c)}>Avaliações<ArrowRight className="size-3" /></Button></article>)}{!visible.some(c => c.stage === stage) && <div className="border border-dashed p-4 text-center text-xs text-muted-foreground">Sem clientes</div>}</div></section>)}</div></div>}
    <Dialog open={!!detail} onOpenChange={v => { if (!v) setDetail(null); }}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{detail?.trade_name} · Pós-venda</DialogTitle></DialogHeader>{detail && <ClientSuccessPanel key={detail.id} clientId={detail.id} />}</DialogContent></Dialog>
  </main></AtendimentoLayout>;
}

export function ClientSuccessPanel({ clientId }: { clientId: string }) {
  const q = useQuery({ queryKey: ["cs-detail", clientId], queryFn: () => getCsDetail({ data: { clientId } }), retry: false });
  const qc = useQueryClient();
  const update = useServerFn(updateCs);
  const analyze = useServerFn(analyzeCs);
  const [manual, setManual] = useState<Health | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["cs-detail", clientId] }), qc.invalidateQueries({ queryKey: ["customer-success"] })]);
  if (q.isPending) return <p className="text-muted-foreground">Carregando avaliações…</p>;
  if (q.isError) return <p role="alert" className="text-destructive">Não foi possível carregar as avaliações.<Button variant="ghost" onClick={() => void q.refetch()}>Tentar novamente</Button></p>;
  const d = q.data;
  async function run(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); await refresh(); setNote(""); setManual(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir."); }
    finally { setBusy(false); lock.current = false; }
  }
  return <div className="space-y-6"><ClientSuccessManagement clientId={clientId} /><div className="flex flex-wrap items-center gap-3"><HealthBadge health={d.state.health} /><Badge variant="outline">{CS_STAGES[stageSchema.parse(d.state.stage)]}</Badge><span className="text-xs text-muted-foreground">Último acompanhamento: {date(d.state.last_followup_at)}</span></div>
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run(() => analyze({ data: { clientId, eventId: crypto.randomUUID() } }))}><PipeflowSymbol alt="" className="size-4" />{busy ? "Processando…" : "Analisar com Pipeflow IA"}</Button><Button variant="outline" disabled={busy} onClick={() => void run(() => update({ data: { clientId, revision: d.state.revision, eventId: crypto.randomUUID(), note: "Acompanhamento registrado pelo gestor", followedAt: new Date().toISOString() } }))}><CalendarCheck className="size-4" />Registrar acompanhamento</Button><Button variant="ghost" asChild><Link to="/clientes/$id" params={{ id: clientId }} search={{ aba: "financeiro" }}>Financeiro</Link></Button>{d.client.lead_id && <Button variant="ghost" asChild><Link to="/" search={{ lead: d.client.lead_id }}>Card no CRM</Link></Button>}</div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <section className="space-y-3 border-t pt-4"><h2 className="font-semibold">Avaliação manual</h2><div className="flex flex-wrap gap-3"><div className="min-w-48 flex-1"><Label>Satisfação</Label><Select value={manual || d.state.health || "sem_avaliacao"} onValueChange={v => setManual(healthSchema.parse(v))}><SelectTrigger aria-label="Satisfação manual"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sem_avaliacao" disabled>Sem avaliação</SelectItem>{Object.entries(CS_HEALTH).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div><div className="min-w-48 flex-1"><Label>Etapa do pós-venda</Label><Select value={d.state.stage} disabled={busy} onValueChange={v => void run(() => update({ data: { clientId, revision: d.state.revision, eventId: crypto.randomUUID(), stage: stageSchema.parse(v), note: "" } }))}><SelectTrigger aria-label="Etapa do pós-venda"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CS_STAGES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div></div><Label htmlFor={`cs-note-${clientId}`}>Motivo da avaliação</Label><Textarea id={`cs-note-${clientId}`} value={note} onChange={e => setNote(e.target.value)} maxLength={3000} /><Button disabled={busy || note.trim().length < 3 || (!manual && !d.state.health)} onClick={() => { const health = healthSchema.parse(manual || d.state.health); void run(() => update({ data: { clientId, revision: d.state.revision, eventId: crypto.randomUUID(), health, note } })); }}>Salvar avaliação manual</Button></section>
    <section className="space-y-4 border-t pt-4"><h2 className="flex items-center gap-2 font-semibold"><Brain className="size-4 text-primary" />Diagnósticos da Pipeflow IA</h2>{!d.evaluations.length && <p className="text-sm text-muted-foreground">Nenhum diagnóstico registrado.</p>}{d.evaluations.map(e => {
      const parsed = diagnosisSchema.safeParse(e.diagnosis);
      return <article key={e.id} className="space-y-3 rounded-lg border p-4"><header className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium">{date(e.created_at)}</span>{parsed.success ? <HealthBadge health={parsed.data.health} /> : <Badge variant="secondary">{e.status === "analyzing" ? "Em análise" : "Não concluída"}</Badge>}</header>{parsed.success && <><div><h3 className="text-sm font-medium">Motivos</h3><ul className="list-disc space-y-1 pl-4 text-sm">{parsed.data.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div><div><h3 className="text-sm font-medium">Evidências do cliente</h3>{parsed.data.evidence.map((ev, i) => <blockquote key={i} className="mt-2 break-words border-l-2 border-primary/40 pl-3 text-sm"><p>“{ev.quote}”</p><span className="text-xs text-muted-foreground">Mensagem {ev.messageId.slice(0, 8)}</span></blockquote>)}</div><div><h3 className="text-sm font-medium">Sugestões de ação</h3><ul className="list-disc space-y-1 pl-4 text-sm">{parsed.data.actions.map((a, i) => <li key={i}>{a}</li>)}</ul></div><Button size="sm" variant="outline" disabled={busy || e.source_revision !== d.state.revision || d.history.some(h => h.evaluation_id === e.id)} onClick={() => { const health = parsed.data.health; void run(() => update({ data: { clientId, revision: d.state.revision, eventId: crypto.randomUUID(), health, evaluationId: e.id, note: "Sugestão da Pipeflow IA revisada pelo gestor" } })); }}>Confirmar classificação sugerida</Button></>}<p className="text-xs text-muted-foreground">{e.limitation}</p>{e.message_count > 0 && <p className="text-xs text-muted-foreground">{e.message_count} mensagens · {date(e.period_start)} a {date(e.period_end)}</p>}</article>;
    })}</section>
    <section className="space-y-3 border-t pt-4"><h2 className="font-semibold">Histórico de avaliações e acompanhamento</h2>{!d.history.length && <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>}{d.history.map(h => { const after = h.after_state as Record<string, unknown>; const before = h.before_state as Record<string, unknown>; return <div key={h.id} className="border-l-2 border-border pl-3 text-sm"><div className="font-medium">{date(h.created_at)} · {h.actor}</div><p>{h.note || "Etapa atualizada"}</p><p className="text-xs text-muted-foreground">{before.health !== after.health ? `${typeof before.health === "string" ? CS_HEALTH[healthSchema.parse(before.health)] : "Sem avaliação"} → ${typeof after.health === "string" ? CS_HEALTH[healthSchema.parse(after.health)] : "Sem avaliação"}` : before.stage !== after.stage ? `${CS_STAGES[stageSchema.parse(before.stage)]} → ${CS_STAGES[stageSchema.parse(after.stage)]}` : "Acompanhamento registrado"}</p></div>; })}</section>
  </div>;
}