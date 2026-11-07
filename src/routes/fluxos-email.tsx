import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Mail, Pause, Play, Plus, RefreshCw, Save, Sparkles, Trash2, UserPlus, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CampaignsLayout } from "@/components/crm/CampaignsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { FlowSuggestionEditor } from "@/components/crm/FlowSuggestionEditor";
import {
  getEmailFlows, saveEmailFlow, setEmailFlowState, enrollEmailFlow, emailFlowEnrollmentAction, runEmailFlowsNow, clearEmailFlowAiBlock, getFlowMessages, syncEmails,
} from "@/lib/email-flows.functions";
import { InboxReview } from "@/components/crm/InboxReview";
import { aiApproved, DEFAULT_FLOW_STEPS, ENROLLMENT_LABEL, FLOW_DAILY_LIMIT, FLOW_STATE_LABEL, windowLabel, type EmailFlow, type FlowInput, type FlowStep } from "@/lib/email-flows";

export const Route = createFileRoute("/fluxos-email")({
  head: () => ({ meta: [
    { title: "Fluxos de E-mail — PipeFlow CRM" },
    { name: "description", content: "Sequências de prospecção por e-mail com Pipeflow IA, pausa automática quando o cliente responde e sugestões para aprovação." },
    { property: "og:title", content: "Fluxos de E-mail — PipeFlow CRM" },
    { property: "og:description", content: "Sequências de e-mail com acompanhamento de respostas e auditoria por contato." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: FlowsPage,
});

const fmt = (v: string | null | undefined) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
const blank = (): FlowInput => ({ id: null, revision: 0, name: "", steps: DEFAULT_FLOW_STEPS.map((s) => ({ ...s })), aiEnabled: false, approveAi: false });
const stateVariant = (s: string) => (s === "active" ? "default" : "secondary") as "default" | "secondary";

function FlowsPage() {
  const get = useServerFn(getEmailFlows);
  const q = useQuery({ queryKey: ["email-flows"], queryFn: () => get(), retry: false, gcTime: 0 });
  const run = useServerFn(runEmailFlowsNow), clearAi = useServerFn(clearEmailFlowAiBlock), setState = useServerFn(setEmailFlowState), sync = useServerFn(syncEmails);
  const [editing, setEditing] = useState<FlowInput | null>(null);
  const [enrollFor, setEnrollFor] = useState<EmailFlow | null>(null);
  const [filterFlow, setFilterFlow] = useState("all");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isError) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const data = q.data;
  const leadName = (id: string | null) => { const l = data?.leads.find((x) => x.id === id); return l ? `${l.name || "Sem nome"}${l.company ? ` · ${l.company}` : ""}` : "Contato"; };
  const flowName = (id: string) => data?.flows.find((f) => f.id === id)?.name ?? "Fluxo arquivado";

  async function act(work: () => Promise<string>) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { setNotice({ ok: true, text: await work() }); await q.refetch(); }
    catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "Ação indisponível." }); }
    finally { setBusy(false); }
  }
  const last = data?.runner?.last_result as { sent?: number; replies?: number; suggestions?: number; notes?: string[]; skipped?: string } | undefined;
  const pending = (data?.suggestions ?? []).filter((s) => s.state === "pending");

  return (
    <CampaignsLayout>
      <main className="min-w-0 flex-1 space-y-6 p-5 text-foreground md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-5">
          <div>
            <h1 className="text-2xl font-semibold">Fluxos de E-mail</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sequências de prospecção que pausam sozinhas quando o cliente responde.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !data} onClick={() => void act(async () => {
              const r = await run();
              if (r.skipped) return r.skipped;
              return `Verificação concluída: ${r.replies} resposta(s) nova(s), ${r.suggestions} sugestão(ões), ${r.sent} e-mail(s) enviado(s)${r.failed ? `, ${r.failed} recusado(s)` : ""}${r.unknown ? `, ${r.unknown} com resultado desconhecido` : ""}.${r.notes.length ? ` ${r.notes.join(" ")}` : ""}`;
            })}><RefreshCw className="size-4" />Verificar e enviar agora</Button>
            <Button variant="outline" disabled={busy || !data} onClick={() => void act(async () => {
              const r = await sync();
              return r.imported ? `${r.imported} e-mail(s) novo(s): ${r.linked} registrados nos cards, ${r.review} de remetentes sem card para revisar${r.flowReplies ? `, ${r.flowReplies} sequência(s) pausada(s) por resposta` : ""}.` : "Nenhum e-mail novo na caixa.";
            })}><Mail className="size-4" />Sincronizar e-mails</Button>
            <Button onClick={() => setEditing(blank())} disabled={!data}><Plus className="size-4" />Novo fluxo</Button>
          </div>
        </header>

        {notice && <p role="status" className={`rounded-md border p-3 text-sm ${notice.ok ? "border-primary/30 bg-primary/5" : "border-destructive/40 text-destructive"}`}>{notice.text}</p>}
        {!data ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">Caixa de respostas</p>
                <p className="mt-1 text-sm"><Mail className="mr-1 inline size-4 text-primary" />{data.gmail.replyTo || "Sem endereço de respostas"}</p>
                {data.gmail.connected && data.gmail.monitored
                  ? <p className="mt-1 text-xs text-muted-foreground">Lido pelo Gmail {data.gmail.address}. Última leitura: {fmt(data.runner?.gmail_checked_at)} · caixa de entrada sincronizada: {fmt(data.runner?.inbox_synced_at)}.</p>
                  : <p className="mt-1 text-xs text-destructive">{data.gmail.error}</p>}
                {data.runner?.inbox_error && <p className="mt-1 text-xs text-destructive">Última sincronização falhou: {data.runner.inbox_error} Envios suspensos até uma leitura confiável.</p>}
                {data.runner && !data.runner.agent_enabled && <p className="mt-1 text-xs text-destructive">Agente Comercial de e-mail desligado: nenhuma etapa é enviada.</p>}
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">Última execução</p>
                <p className="mt-1 text-sm">{fmt(data.runner?.last_run_at)}</p>
                {last && <p className="mt-1 text-xs text-muted-foreground">{last.skipped ?? `${last.replies ?? 0} respostas · ${last.suggestions ?? 0} sugestões · ${last.sent ?? 0} enviados`}{last.notes?.length ? ` · ${last.notes.join(" ")}` : ""}</p>}
                <p className="mt-1 text-xs text-muted-foreground">Roda automaticamente a cada 10 minutos no site publicado.</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">Limite diário</p>
                <p className="mt-1 text-sm">{data.quota.sent24h} de {FLOW_DAILY_LIMIT} e-mails nas últimas 24h</p>
                <p className="mt-1 text-xs text-muted-foreground">Inclui campanhas. Mantém os envios abaixo do limite do plano da Brevo.</p>
              </div>
            </section>
            {data.runner?.ai_blocked_reason && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 p-3 text-sm">
                <span className="text-destructive">Pipeflow IA pausada nos fluxos: {data.runner.ai_blocked_reason} As etapas seguem com o texto aprovado.</span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await clearAi(); return "IA liberada para a próxima execução."; })}>Liberar IA novamente</Button>
              </div>
            )}

            <InboxReview rows={data.review} leads={data.leads} pipelines={data.pipelines} onDone={(t) => { setNotice({ ok: true, text: t }); void q.refetch(); }} />

            {pending.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Respostas aguardando sua aprovação ({pending.length})</h2>
                {pending.map((s) => {
                  const inbound = data.inbound.find((m) => m.id === s.inbound_id);
                  return (
                    <div key={s.id} className="space-y-1">
                      <p className="text-sm font-medium">{leadName(s.lead_id)} <span className="text-xs font-normal text-muted-foreground">· recebida {fmt(inbound?.created_at)}</span></p>
                      <FlowSuggestionEditor suggestion={s} inbound={inbound} onDone={() => void q.refetch()} />
                    </div>
                  );
                })}
              </section>
            )}

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Fluxos</h2>
              {data.flows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum fluxo criado. Clique em “Novo fluxo” para montar a primeira sequência.</p>}
              <div className="grid gap-3 lg:grid-cols-2">
                {data.flows.map((f) => {
                  const people = data.enrollments.filter((e) => e.flow_id === f.id);
                  const activeCount = people.filter((e) => e.status === "active").length;
                  return (
                    <article key={f.id} className="space-y-3 rounded-lg border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold">{f.name}</h3>
                          <p className="text-xs text-muted-foreground">{f.steps.length} etapas · dias {f.steps.map((s) => s.day).join(", ")} · {people.length} contatos ({activeCount} em sequência)</p>
                          <p className="text-xs text-muted-foreground">Envio: {windowLabel(f)} · até {f.max_messages} mensagem(ns) por contato</p>
                        </div>
                        <div className="flex gap-1.5">
                          <Badge variant={stateVariant(f.state)}>{FLOW_STATE_LABEL[f.state]}</Badge>
                          {f.ai_enabled && <Badge variant={aiApproved(f) ? "default" : "outline"}><Sparkles className="mr-1 size-3" />{aiApproved(f) ? "Pipeflow IA aprovada" : "IA sem aprovação"}</Badge>}
                        </div>
                      </div>
                      {f.automation_id ? (
                        <p className="text-xs text-muted-foreground">Gerado pela Central de Automações. <Link to="/automacoes/$id" params={{ id: f.automation_id }} className="text-primary underline">Editar, ligar ou pausar em Automações</Link>.</p>
                      ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing({ id: f.id, revision: f.revision, name: f.name, steps: f.steps.map((s) => ({ ...s })), aiEnabled: f.ai_enabled, approveAi: false })}>Editar</Button>
                        <Button size="sm" variant="outline" onClick={() => setEnrollFor(f)}><UserPlus className="size-4" />Adicionar contatos</Button>
                        {f.state === "active" ? (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await setState({ data: { id: f.id, revision: f.revision, state: "paused" } }); return "Fluxo pausado; nenhum envio sai enquanto estiver pausado."; })}><Pause className="size-4" />Pausar</Button>
                        ) : (
                          <Button size="sm" disabled={busy} onClick={() => void act(async () => {
                            if (!window.confirm(f.ai_enabled ? "Ativar? A Pipeflow IA vai personalizar e enviar automaticamente as etapas aprovadas até o cliente responder." : "Ativar? As etapas serão enviadas automaticamente nos dias configurados até o cliente responder.")) return "Ativação cancelada.";
                            await setState({ data: { id: f.id, revision: f.revision, state: "active" } }); return "Fluxo ativado.";
                          })}><Play className="size-4" />Ativar</Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(async () => {
                          if (!window.confirm("Arquivar este fluxo? As sequências em andamento serão encerradas (respostas já recebidas continuam visíveis).")) return "Nada foi alterado.";
                          await setState({ data: { id: f.id, revision: f.revision, state: "archived" } }); return "Fluxo arquivado.";
                        })}><Archive className="size-4" />Arquivar</Button>
                      </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Acompanhamento dos contatos</h2>
                <Select value={filterFlow} onValueChange={setFilterFlow}>
                  <SelectTrigger className="w-56" aria-label="Filtrar por fluxo"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Todos os fluxos</SelectItem>{data.flows.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <AuditTable rows={data.enrollments.filter((e) => filterFlow === "all" || e.flow_id === filterFlow)} flows={data.flows} leadName={leadName} flowName={flowName} onChanged={() => void q.refetch()} />
            </section>
          </>
        )}
        {editing && <FlowEditor value={editing} onClose={() => setEditing(null)} onSaved={(t) => { setEditing(null); setNotice({ ok: true, text: t }); void q.refetch(); }} />}
        {enrollFor && data && <EnrollDialog flow={enrollFor} data={data} onClose={() => setEnrollFor(null)} onDone={(t) => { setEnrollFor(null); setNotice({ ok: true, text: t }); void q.refetch(); }} />}
      </main>
    </CampaignsLayout>
  );
}

function FlowEditor({ value, onClose, onSaved }: { value: FlowInput; onClose: () => void; onSaved: (t: string) => void }) {
  const save = useServerFn(saveEmailFlow);
  const [f, setF] = useState<FlowInput>(value);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const setStep = (i: number, p: Partial<FlowStep>) => setF((x) => ({ ...x, approveAi: false, steps: x.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const ordered = f.steps.every((s, i) => i === 0 || s.day > f.steps[i - 1].day);
  const valid = f.name.trim().length >= 2 && f.steps.length > 0 && f.steps.every((s) => s.subject.trim() && s.body.trim() && s.day >= 1) && ordered;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{f.id ? "Editar fluxo" : "Novo fluxo"}</DialogTitle>
          <DialogDescription>Use {"{{nome}}"} e {"{{empresa}}"} para personalizar. O rodapé de descadastro é incluído automaticamente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="flow-name">Nome do fluxo</Label><Input id="flow-name" value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Prospecção clínicas — novembro" /></div>
          {f.steps.map((s, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Etapa {i + 1} · Dia</span>
                <Input aria-label={`Dia da etapa ${i + 1}`} type="number" min={1} max={120} className="w-20" value={s.day} onChange={(e) => setStep(i, { day: Math.max(1, Number(e.target.value) || 1) })} />
                {f.steps.length > 1 && <Button size="icon" variant="ghost" aria-label={`Remover etapa ${i + 1}`} className="ml-auto" onClick={() => setF((x) => ({ ...x, approveAi: false, steps: x.steps.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button>}
              </div>
              <Input aria-label={`Assunto da etapa ${i + 1}`} value={s.subject} maxLength={200} onChange={(e) => setStep(i, { subject: e.target.value })} placeholder="Assunto" />
              <Textarea aria-label={`Mensagem da etapa ${i + 1}`} rows={5} value={s.body} maxLength={8000} onChange={(e) => setStep(i, { body: e.target.value })} placeholder="Mensagem" />
            </div>
          ))}
          {!ordered && <p className="text-xs text-destructive">Os dias das etapas precisam ser crescentes.</p>}
          {f.steps.length < 10 && <Button size="sm" variant="outline" onClick={() => setF((x) => ({ ...x, approveAi: false, steps: [...x.steps, { day: (x.steps.at(-1)?.day ?? 0) + 3, subject: "", body: "" }] }))}><Plus className="size-4" />Adicionar etapa</Button>}
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <label className="flex items-center gap-3 text-sm font-medium"><Switch checked={f.aiEnabled} onCheckedChange={(v) => setF({ ...f, aiEnabled: v, approveAi: false })} aria-label="Ativar Pipeflow IA" />Ativar Pipeflow IA</label>
            <p className="text-xs text-muted-foreground">A IA usa os dados da empresa, o segmento, o histórico do card e os e-mails anteriores para personalizar cada etapa, mantendo a oferta e o objetivo que você escreveu. Respostas de clientes nunca são enviadas sem sua aprovação.</p>
            {f.aiEnabled && (
              <label className="flex items-start gap-2 text-sm"><Checkbox checked={f.approveAi} onCheckedChange={(v) => setF({ ...f, approveAi: v === true })} aria-label="Aprovar envio automático pela IA" className="mt-0.5" />
                <span>Aprovo estas etapas. A Pipeflow IA pode personalizar e enviar os e-mails automaticamente, sem revisão individual, até o cliente responder. Se eu editar o fluxo, preciso aprovar de novo.</span></label>
            )}
          </div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valid || busy} onClick={async () => {
            setBusy(true); setErr("");
            try { await save({ data: f }); onSaved(f.aiEnabled && !f.approveAi ? "Fluxo salvo. Para ativar com a Pipeflow IA, aprove as etapas." : "Fluxo salvo."); }
            catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível salvar."); }
            finally { setBusy(false); }
          }}><Save className="size-4" />Salvar fluxo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Overview = Awaited<ReturnType<typeof getEmailFlows>>;
function EnrollDialog({ flow, data, onClose, onDone }: { flow: EmailFlow; data: Overview; onClose: () => void; onDone: (t: string) => void }) {
  const enroll = useServerFn(enrollEmailFlow);
  const b2b = useMemo(() => new Set(data.b2bLeadIds), [data.b2bLeadIds]);
  const defaultPipeline = data.pipelines.find((p) => data.leads.some((l) => l.pipeline_id === p.id && b2b.has(l.id)))?.id ?? "all";
  const [pipeline, setPipeline] = useState(defaultPipeline), [search, setSearch] = useState(""), [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const live = new Set(data.enrollments.filter((e) => ["active", "awaiting_reply", "in_conversation", "paused"].includes(e.status)).map((e) => e.lead_id));
  const stageTitle = (l: { stage: string; pipeline_id: string | null }) => data.pipelines.find((p) => p.id === l.pipeline_id)?.stages.find((s) => s.id === l.stage)?.title ?? l.stage;
  const rows = data.leads.filter((l) => l.email && (pipeline === "all" || (pipeline === "main" ? !l.pipeline_id : l.pipeline_id === pipeline)))
    .filter((l) => !search || `${l.name} ${l.company} ${l.email}`.toLowerCase().includes(search.toLowerCase())).slice(0, 300);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Adicionar contatos a “{flow.name}”</DialogTitle><DialogDescription>Só entram cards com e-mail válido, sem descadastro e que não estejam em outra sequência.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Select value={pipeline} onValueChange={setPipeline}>
            <SelectTrigger className="w-56" aria-label="Funil"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os funis</SelectItem><SelectItem value="main">Funil principal</SelectItem>{data.pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="min-w-48 flex-1" placeholder="Buscar nome, empresa ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{rows.length} cards com e-mail · {sel.size} selecionados</span>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set(rows.filter((r) => !live.has(r.id)).map((r) => r.id)))}>Selecionar todos disponíveis</Button>
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {rows.map((l) => (
            <li key={l.id} className="flex items-center gap-3 p-2 text-sm">
              <Checkbox checked={sel.has(l.id)} disabled={live.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={`Selecionar ${l.name}`} />
              <span className="min-w-0 flex-1"><span className="block truncate">{l.name || "Sem nome"}{l.company ? ` · ${l.company}` : ""}</span><span className="block truncate text-xs text-muted-foreground">{l.email} · {stageTitle(l)}{b2b.has(l.id) ? " · B2B" : ""}{live.has(l.id) ? " · já em sequência" : ""}</span></span>
            </li>
          ))}
          {rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nenhum card com e-mail neste filtro.</li>}
        </ul>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!sel.size || busy} onClick={async () => {
            setBusy(true); setErr("");
            try {
              const r = await enroll({ data: { flowId: flow.id, leadIds: [...sel] } });
              onDone(`${r.added} contato(s) adicionados${r.skipped.length ? `; ${r.skipped.length} ignorado(s) (${[...new Set(r.skipped.map((s) => s.reason))].join(", ")})` : ""}.${flow.state === "active" ? " O primeiro envio sai na próxima verificação." : " Ative o fluxo para começar os envios."}`);
            } catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível adicionar."); }
            finally { setBusy(false); }
          }}><UserPlus className="size-4" />Adicionar {sel.size || ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditTable({ rows, flows, leadName, flowName, onChanged }: { rows: Overview["enrollments"]; flows: EmailFlow[]; leadName: (id: string) => string; flowName: (id: string) => string; onChanged: () => void }) {
  const action = useServerFn(emailFlowEnrollmentAction);
  const [open, setOpen] = useState<string | null>(null), [err, setErr] = useState("");
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nenhum contato em fluxos ainda.</p>;
  const total = (flowId: string) => flows.find((f) => f.id === flowId)?.steps.length ?? 0;
  const go = async (id: string, a: "pause" | "resume" | "stop") => {
    setErr("");
    if (a === "stop" && !window.confirm("Encerrar a sequência deste contato?")) return;
    try { await action({ data: { id, action: a } }); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Ação indisponível."); }
  };
  return (
    <div className="overflow-x-auto rounded-lg border">
      {err && <p role="alert" className="p-2 text-sm text-destructive">{err}</p>}
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr><th className="p-2" /><th className="p-2">Contato</th><th className="p-2">Fluxo</th><th className="p-2">Situação</th><th className="p-2">Etapa</th><th className="p-2">Último envio</th><th className="p-2">Próximo envio</th><th className="p-2">Motivo</th><th className="p-2" /></tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((e) => (
            <AuditRow key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} lead={leadName(e.lead_id)} flow={flowName(e.flow_id)} total={total(e.flow_id)} onAction={(a) => void go(e.id, a)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditRow({ e, open, onToggle, lead, flow, total, onAction }: { e: Overview["enrollments"][number]; open: boolean; onToggle: () => void; lead: string; flow: string; total: number; onAction: (a: "pause" | "resume" | "stop") => void }) {
  const get = useServerFn(getFlowMessages);
  const msgs = useQuery({ queryKey: ["flow-messages", e.id], queryFn: () => get({ data: { enrollmentId: e.id } }), enabled: open, retry: false, gcTime: 0 });
  const stateLabel: Record<string, string> = { reserved: "em envio", accepted: "enviado", failed: "recusado", unknown: "resultado desconhecido", received: "recebido" };
  return (
    <>
      <tr className="align-top">
        <td className="p-2"><button type="button" aria-label="Ver mensagens" aria-expanded={open} onClick={onToggle}>{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button></td>
        <td className="p-2"><span className="block">{lead}</span><span className="text-xs text-muted-foreground">{e.contact}</span></td>
        <td className="p-2">{flow}</td>
        <td className="p-2"><Badge variant={e.status === "awaiting_reply" ? "default" : "secondary"}>{ENROLLMENT_LABEL[e.status]}</Badge></td>
        <td className="p-2">{Math.min(e.next_step, total)}/{total}</td>
        <td className="p-2 whitespace-nowrap">{fmt(e.last_sent_at)}</td>
        <td className="p-2 whitespace-nowrap">{e.status === "active" ? fmt(e.next_send_at) : "—"}</td>
        <td className="p-2 text-xs">{e.reason || "—"}</td>
        <td className="p-2">
          <div className="flex gap-1">
            {e.status === "active" && <Button size="sm" variant="ghost" onClick={() => onAction("pause")}>Pausar</Button>}
            {e.status === "paused" && !e.replied_at && <Button size="sm" variant="ghost" onClick={() => onAction("resume")}>Retomar</Button>}
            {["active", "paused", "awaiting_reply", "in_conversation"].includes(e.status) && <Button size="sm" variant="ghost" onClick={() => onAction("stop")}>Encerrar</Button>}
          </div>
        </td>
      </tr>
      {open && (
        <tr><td colSpan={9} className="bg-muted/20 p-3">
          {msgs.isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p> : (msgs.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda.</p> : (
            <ul className="space-y-2">
              {(msgs.data ?? []).map((m) => (
                <li key={m.id} className="rounded-md border bg-background p-2.5">
                  <p className="text-xs text-muted-foreground">{m.direction === "in" ? "Resposta do cliente" : m.kind === "reply" ? "Resposta personalizada" : `Etapa ${(m.step ?? 0) + 1}`} · {fmt(m.created_at)} · {stateLabel[m.state] ?? m.state}{m.ai_personalized ? " · personalizado pela Pipeflow IA" : ""}{m.error_code ? ` · ${m.error_code}` : ""}</p>
                  <p className="text-sm font-medium">{m.subject}</p>
                  <p className="whitespace-pre-line break-words text-sm">{m.body}</p>
                </li>
              ))}
            </ul>
          )}
        </td></tr>
      )}
    </>
  );
}
