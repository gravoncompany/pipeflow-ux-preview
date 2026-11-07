import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClientOnly } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Archive, FlaskConical, Pause, Play, Plus, Save, Search, Trash2, UserPlus, Zap } from "lucide-react";
import { CampaignsLayout } from "@/components/crm/CampaignsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { EmailBodyEditor } from "@/components/crm/EmailBodyEditor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { automationRunAction, getAutomation, getAutomationCandidates, saveAutomation, setAutomationState, startAutomationRun } from "@/lib/automations.functions";
import {
  AUTOMATION_STATE_LABEL, AUTOMATION_VARIABLES, compileAutomation, NODE_LABEL, RUN_EVENT_LABEL, TRIGGER_MODE_LABEL,
  type AutomationGraph, type AutomationNodeKind, type GraphNode,
} from "@/lib/automations";
import { ENROLLMENT_LABEL } from "@/lib/email-flows";
import { DEFAULT_TAGS } from "@/lib/crm-types";

const AutomationCanvas = lazy(() => import("@/components/crm/AutomationCanvas").then((m) => ({ default: m.AutomationCanvas })));

export const Route = createFileRoute("/automacoes/$id")({
  head: () => ({ meta: [
    { title: "Editar automação — PipeFlow CRM" },
    { name: "description", content: "Construtor visual da automação de e-mail: blocos, condições, testes e histórico por card." },
    { property: "og:title", content: "Editar automação — PipeFlow CRM" },
    { property: "og:description", content: "Desenhe, teste e acompanhe uma automação de e-mail do Pipeflow." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AutomationPage,
});

const fmt = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
const PALETTE: AutomationNodeKind[] = ["ai", "email", "wait", "if_reply", "if_form", "update_card", "notify", "end"];
const blankData = (k: AutomationNodeKind): GraphNode["data"] => {
  switch (k) {
    case "ai": return { guidance: "" };
    case "email": return { subject: "", body: "Olá, {{nome}}!\n\n", cta: "Quero meu diagnóstico gratuito" };
    case "wait": return { amount: 2, unit: "days" };
    case "update_card": return { stage: "", tag: "", status: "" };
    case "notify": return { channel: "push", message: "{{empresa}} respondeu o e-mail da automação." };
    case "trigger": return { pipelineId: null, mode: "entry" };
    default: return {} as Record<string, never>;
  }
};
const DAY_NAMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function AutomationPage() {
  const { id } = Route.useParams();
  const get = useServerFn(getAutomation), save = useServerFn(saveAutomation), setState = useServerFn(setAutomationState), runAct = useServerFn(automationRunAction);
  const q = useQuery({ queryKey: ["automation", id], queryFn: () => get({ data: { id } }), retry: false, gcTime: 0 });
  const [graph, setGraph] = useState<AutomationGraph | null>(null);
  const [name, setName] = useState(""), [landing, setLanding] = useState(""), [tests, setTests] = useState("");
  const [dirty, setDirty] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<null | "test" | "active">(null);
  const [approveAi, setApproveAi] = useState(false), [ack, setAck] = useState(false);
  const [includeOpen, setIncludeOpen] = useState(false);

  const a = q.data?.automation;
  useEffect(() => {
    if (!a || dirty) return;
    setGraph(a.graph); setName(a.name); setLanding(a.landing_url); setTests(a.test_contacts.join("\n"));
  }, [a?.id, a?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const compiled = useMemo(() => (graph ? compileAutomation(graph) : null), [graph]);
  const pipelines = q.data?.pipelines ?? [];
  const triggerPipeline = graph?.nodes.find((n) => n.kind === "trigger");
  const pipelineId = triggerPipeline?.kind === "trigger" ? triggerPipeline.data.pipelineId : null;
  const stages = (pipelines.find((p) => p.id === pipelineId)?.stages ?? []).filter((s) => s.id !== "fechado");
  const ctx = useMemo(() => {
    const emailIndex = new Map<string, number>();
    let i = 0;
    for (const n of graph?.nodes ?? []) if (n.kind === "email") emailIndex.set(n.id, ++i);
    return {
      emailIndex,
      stageTitle: (sid: string) => pipelines.flatMap((p) => p.stages).find((s) => s.id === sid)?.title ?? sid,
      pipelineName: (pid: string | null) => pipelines.find((p) => p.id === pid)?.name ?? "escolha o funil",
    };
  }, [graph, pipelines]);

  if (q.isError) {
    const msg = q.error instanceof Error ? q.error.message : "";
    if (/não encontrada/i.test(msg)) return <Shell><p className="text-sm">Automação não encontrada. <Link to="/automacoes" className="text-primary underline">Voltar</Link></p></Shell>;
    return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  }
  if (!q.data || !a || !graph) return <Shell><p className="text-sm text-muted-foreground">Carregando…</p></Shell>;
  const editable = a.state === "draft" || a.state === "paused";
  const node = graph.nodes.find((n) => n.id === selected) ?? null;
  const testList = tests.split(/[\s,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);

  const change = (g: AutomationGraph) => { setGraph(g); setDirty(true); };
  const patchNode = (nid: string, data: Partial<GraphNode["data"]>) =>
    change({ ...graph, nodes: graph.nodes.map((n) => (n.id === nid ? ({ ...n, data: { ...n.data, ...data } } as GraphNode) : n)) });
  function addBlock(kind: AutomationNodeKind) {
    if (!editable || !graph) return;
    const anchor = graph.nodes.find((n) => n.id === selected) ?? graph.nodes.reduce((m, n) => (n.y > m.y ? n : m), graph.nodes[0]);
    const nid = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
    const n = { id: nid, kind, x: anchor.x, y: anchor.y + 130, data: blankData(kind) } as GraphNode;
    // Liga automaticamente ao bloco selecionado quando a saída dele está livre.
    const canLink = anchor.kind !== "end" && anchor.kind !== "if_reply" && anchor.kind !== "if_form" && !graph.edges.some((e) => e.source === anchor.id);
    change({ nodes: [...graph.nodes, n], edges: canLink ? [...graph.edges, { id: `${anchor.id}-o-${nid}`, source: anchor.id, target: nid, branch: null }] : graph.edges });
    setSelected(nid);
  }
  function removeNode(nid: string) {
    change({ nodes: graph!.nodes.filter((n) => n.id !== nid), edges: graph!.edges.filter((e) => e.source !== nid && e.target !== nid) });
    setSelected(null);
  }

  async function doSave(): Promise<boolean> {
    if (!dirty) return true;
    try {
      const r = await save({ data: { id: a!.id, revision: a!.revision, name, graph: graph!, landingUrl: landing, testContacts: testList, approveAi: false } });
      setDirty(false);
      await q.refetch();
      setNotice(r.errors.length ? { ok: false, text: `Salvo como rascunho. Para ligar, ajuste: ${r.errors[0]}` } : { ok: true, text: "Automação salva." });
      return true;
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "Não foi possível salvar." }); return false; }
  }
  async function run(work: () => Promise<unknown>, ok: string) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await work(); setNotice({ ok: true, text: ok }); await q.refetch(); }
    catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "Ação indisponível." }); }
    finally { setBusy(false); }
  }
  async function turnOn(state: "test" | "active") {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      if (!(await doSave())) return;
      const fresh = (await q.refetch()).data?.automation ?? a!;
      await setState({ data: { id: fresh.id, revision: fresh.revision, state, approveAi } });
      setConfirm(null); setApproveAi(false); setAck(false);
      setNotice({ ok: true, text: state === "test" ? "Modo teste ligado: só os e-mails de teste participam." : "Automação ativa: cards que entrarem no funil a partir de agora recebem a cadência." });
      await q.refetch();
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "Não foi possível ligar." }); }
    finally { setBusy(false); }
  }

  const f = q.data.flow;
  const usesAi = compiled?.ok ? compiled.compiled.usesAi : false;

  return (
    <Shell>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div className="min-w-0 flex-1">
          <Link to="/automacoes" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" />Automações</Link>
          <div className="flex flex-wrap items-center gap-2">
            <Zap className="size-5 text-primary" />
            <Input aria-label="Nome da automação" value={name} disabled={!editable} onChange={(e) => { setName(e.target.value); setDirty(true); }} className="h-9 max-w-md text-lg font-semibold" />
            <Badge variant={a.state === "active" ? "default" : "secondary"}>{AUTOMATION_STATE_LABEL[a.state]}</Badge>
            {dirty && <Badge variant="outline">Alterações não salvas</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && <Button variant="outline" disabled={busy || !dirty} onClick={() => void run(doSave, "Automação salva.")}><Save className="size-4" />Salvar</Button>}
          {(a.state === "draft" || a.state === "paused" || a.state === "active") && <Button variant="outline" disabled={busy} onClick={() => setConfirm("test")}><FlaskConical className="size-4" />{a.state === "active" ? "Voltar ao teste" : "Testar"}</Button>}
          {a.state !== "active" && <Button disabled={busy} onClick={() => setConfirm("active")}><Play className="size-4" />Ativar</Button>}
          {(a.state === "test" || a.state === "active") && <Button variant="outline" disabled={busy} onClick={() => void run(() => setState({ data: { id: a.id, revision: a.revision, state: "paused", approveAi: false } }), "Automação pausada: nenhum novo e-mail sai por ela.")}><Pause className="size-4" />Pausar</Button>}
          {editable && <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Arquivar encerra os envios desta automação para todos os cards. Continuar?")) void run(() => setState({ data: { id: a.id, revision: a.revision, state: "archived", approveAi: false } }), "Automação arquivada."); }}><Archive className="size-4" />Arquivar</Button>}
        </div>
      </header>
      {notice && <p role="status" className={`mt-3 text-sm ${notice.ok ? "text-primary" : "text-destructive"}`}>{notice.text}</p>}
      {!editable && <p className="mt-3 rounded-md border bg-muted/40 p-2 text-xs">Automação ligada: o desenho fica somente leitura. Pause para editar.</p>}

      <Tabs defaultValue="desenho" className="mt-4">
        <TabsList>
          <TabsTrigger value="desenho">Desenho</TabsTrigger>
          <TabsTrigger value="config">Configurações</TabsTrigger>
          <TabsTrigger value="cards">Cards ({q.data.runs.length})</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="desenho" className="mt-4">
          <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)_340px]">
            <aside aria-label="Blocos disponíveis" className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Adicionar bloco</p>
              {PALETTE.map((k) => (
                <Button key={k} variant="outline" size="sm" className="h-auto w-full justify-start whitespace-normal py-1.5 text-left" disabled={!editable} onClick={() => addBlock(k)}><Plus className="size-3.5" />{NODE_LABEL[k]}</Button>
              ))}
              <p className="pt-2 text-[11px] text-muted-foreground">Arraste a bolinha de saída até o próximo bloco para ligar. Nas condições, a saída lateral é “Sim” e a de baixo é “Não”.</p>
            </aside>
            <ClientOnly fallback={<div className="h-[640px] rounded-lg border bg-muted/30" />}>
              <Suspense fallback={<div className="h-[640px] rounded-lg border bg-muted/30" />}>
                <AutomationCanvas graph={graph} onChange={change} selectedId={selected} onSelect={setSelected} ctx={ctx} readOnly={!editable} />
              </Suspense>
            </ClientOnly>
            <aside aria-label="Bloco selecionado" className="space-y-3">
              <Validation compiled={compiled} />
              {node ? <NodePanel node={node} editable={editable} pipelines={pipelines} stages={stages} onPatch={(d) => patchNode(node.id, d)} onRemove={() => removeNode(node.id)} />
                : <p className="rounded-lg border p-3 text-sm text-muted-foreground">Clique em um bloco para editar.</p>}
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="config" className="mt-4 max-w-2xl space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="landing">Landing page do diagnóstico estratégico</Label>
            <Input id="landing" placeholder="https://gravoncompany.com/diagnostico" value={landing} disabled={!editable} onChange={(e) => { setLanding(e.target.value); setDirty(true); }} />
            <p className="text-xs text-muted-foreground">Cada e-mail leva um link rastreado próprio do card que abre esta página com UTMs (utm_content identifica o card). Quando o formulário cria um card com o mesmo e-mail ou com esse identificador, a sequência para.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tests">E-mails de teste (até 10)</Label>
            <Textarea id="tests" rows={3} value={tests} disabled={!editable} onChange={(e) => { setTests(e.target.value); setDirty(true); }} placeholder="teste@exemplo.com" />
            <p className="text-xs text-muted-foreground">Em modo teste, só cards com estes e-mails entram na automação. Nenhum cliente recebe nada.</p>
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <p className="font-medium">Regras de envio (herdadas dos Fluxos de E-mail)</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Envio pela Brevo com o remetente da Gravon; respostas vão para o endereço comercial e são lidas no Gmail.</li>
              <li>Sem leitura do Gmail, nada é enviado. Respostas por e-mail ou WhatsApp pausam a cadência.</li>
              <li>Descadastrados, bloqueados e o limite diário compartilhado de 250 envios são respeitados. Nunca reenvia um e-mail com resultado incerto.</li>
              <li>Assinatura e banner da Gravon entram automaticamente no fim de cada e-mail.</li>
              {f && <li>Dias e horários de envio: {f.sendDays.map((d) => DAY_NAMES[d]).join(", ")}, {f.sendStart.slice(0, 5)}–{f.sendEnd.slice(0, 5)}.</li>}
            </ul>
          </div>
          {editable && <Button disabled={busy || !dirty} onClick={() => void run(doSave, "Configurações salvas.")}><Save className="size-4" />Salvar configurações</Button>}
        </TabsContent>

        <TabsContent value="cards" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{a.state === "test" ? "Modo teste: inclua um card com e-mail de teste para acompanhar a cadência." : "Cards que passaram por esta automação."}</p>
            <Button size="sm" variant="outline" disabled={a.state !== "test" && a.state !== "active"} onClick={() => setIncludeOpen(true)}><UserPlus className="size-4" />Incluir card</Button>
          </div>
          <RunsTable runs={q.data.runs} total={f?.steps ?? 0} onAction={(runId, action, ok) => void run(() => runAct({ data: { runId, action } }), ok)} busy={busy} />
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          {q.data.events.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum evento ainda.</p> : (
            <ul className="divide-y rounded-lg border text-sm">
              {q.data.events.map((e) => {
                const r = q.data!.runs.find((x) => x.id === e.run_id);
                return <li key={e.id} className="flex flex-wrap gap-x-3 p-2.5"><span className="w-32 shrink-0 text-xs text-muted-foreground">{fmt(e.created_at)}</span><span className="font-medium">{RUN_EVENT_LABEL[e.kind]}</span><span className="text-muted-foreground">{r ? r.leadName : ""}{e.detail ? ` · ${e.detail}` : ""}</span></li>;
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={confirm !== null} onOpenChange={(o) => { if (!o) { setConfirm(null); setApproveAi(false); setAck(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "test" ? "Ligar modo teste" : "Ativar automação"}</DialogTitle>
            <DialogDescription>
              {confirm === "test"
                ? `Só cards com os e-mails de teste (${testList.length || "nenhum informado"}) entram. Os e-mails são reais, mas vão apenas para esses endereços.`
                : `A partir de agora, cada card que entrar no funil "${ctx.pipelineName(pipelineId)}" com e-mail válido recebe a cadência de verdade. Cards que já estavam no funil não entram sozinhos.`}
            </DialogDescription>
          </DialogHeader>
          {compiled && !compiled.ok && <p className="text-sm text-destructive">Corrija o desenho antes: {compiled.errors[0]}</p>}
          {usesAi && <label className="flex items-start gap-2 text-sm"><Checkbox checked={approveAi} onCheckedChange={(v) => setApproveAi(v === true)} />Aprovo que a Pipeflow IA personalize e envie os e-mails marcados com o bloco “Pipeflow IA”, sem inventar preços, prazos ou condições. Respostas de clientes nunca são respondidas sozinhas.</label>}
          {confirm === "active" && <label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />Entendo que serão enviados e-mails reais para os cards que entrarem no funil.</label>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button disabled={busy || (compiled ? !compiled.ok : true) || (usesAi && !approveAi) || (confirm === "active" && !ack)} onClick={() => confirm && void turnOn(confirm)}>
              {confirm === "test" ? "Ligar teste" : "Ativar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IncludeDialog open={includeOpen} onOpenChange={setIncludeOpen} automationId={a.id} test={a.state === "test"} onDone={(t) => { setNotice({ ok: true, text: t }); void q.refetch(); }} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <CampaignsLayout>
      <main className="min-w-0 flex-1 overflow-y-auto p-4 text-foreground md:p-6">{children}</main>
    </CampaignsLayout>
  );
}

function Validation({ compiled }: { compiled: ReturnType<typeof compileAutomation> | null }) {
  if (!compiled) return null;
  if (compiled.ok) {
    const c = compiled.compiled;
    const last = c.steps[c.steps.length - 1];
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
        <p className="font-medium text-primary">Desenho válido</p>
        <p className="mt-1">{c.steps.length} e-mail(s) até o dia {last?.day}: {c.steps.map((s) => `dia ${s.day}${s.hours ? ` +${s.hours}h` : ""}`).join(" · ")}.</p>
        <p className="mt-1 text-muted-foreground">Resposta e formulário interrompem os envios em qualquer ponto da cadência.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs" role="alert">
      <p className="flex items-center gap-1 font-medium text-destructive"><AlertTriangle className="size-3.5" />Ajustes antes de ligar</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">{compiled.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>
    </div>
  );
}

function NodePanel({ node, editable, pipelines, stages, onPatch, onRemove }: {
  node: GraphNode; editable: boolean; pipelines: { id: string; name: string }[]; stages: { id: string; title: string }[];
  onPatch: (d: Record<string, unknown>) => void; onRemove: () => void;
}) {
  const dis = !editable;
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{NODE_LABEL[node.kind]}</p>
        {node.kind !== "trigger" && editable && <Button size="sm" variant="ghost" onClick={onRemove} aria-label="Remover bloco"><Trash2 className="size-4" /></Button>}
      </div>
      {node.kind === "trigger" && (
        <div className="space-y-1.5">
          <Label>Funil</Label>
          <Select value={node.data.pipelineId ?? ""} disabled={dis} onValueChange={(v) => onPatch({ pipelineId: v })}>
            <SelectTrigger><SelectValue placeholder="Escolha o funil" /></SelectTrigger>
            <SelectContent>{pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Label>Como os cards entram</Label>
          <Select value={node.data.mode ?? "entry"} disabled={dis} onValueChange={(v) => onPatch({ mode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="entry">{TRIGGER_MODE_LABEL.entry}</SelectItem>
              <SelectItem value="manual">{TRIGGER_MODE_LABEL.manual}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{(node.data.mode ?? "entry") === "manual"
            ? "Nenhum card entra sozinho. No Pipeline, selecione os cards deste funil e clique em “Iniciar cadência automática”; só eles recebem a sequência."
            : "Dispara uma vez por card, quando ele é criado ou movido para este funil depois que a automação foi ligada."}</p>
        </div>
      )}
      {node.kind === "ai" && <p className="text-xs text-muted-foreground">O próximo e-mail é reescrito pela Pipeflow IA para esta empresa, usando site, Instagram, dados públicos do CNPJ e o histórico de interações. Mantém o objetivo e o convite do texto base e nunca inventa preços, prazos ou condições. Sem a IA disponível, sai o texto base.</p>}
      {node.kind === "email" && (
        <div className="space-y-2">
          <div className="space-y-1"><Label>Assunto</Label><Input value={node.data.subject} disabled={dis} maxLength={200} onChange={(e) => onPatch({ subject: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>Mensagem</Label>
            {dis ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs">{node.data.body}</pre>
              : <EmailBodyEditor value={node.data.body} subject={node.data.subject} onChange={(v) => onPatch({ body: v })} />}
          </div>
          <div className="space-y-1"><Label>Texto do botão do diagnóstico</Label><Input value={node.data.cta} disabled={dis} maxLength={60} onChange={(e) => onPatch({ cta: e.target.value })} placeholder="Deixe vazio para não incluir o botão" /></div>
          <p className="text-[11px] text-muted-foreground">Variáveis: {AUTOMATION_VARIABLES.join(" ")}. O botão leva ao link rastreado do card. Assinatura e banner da Gravon entram no envio.</p>
        </div>
      )}
      {node.kind === "wait" && (
        <div className="flex gap-2">
          <Input type="number" min={1} max={720} value={node.data.amount} disabled={dis} className="w-24" onChange={(e) => onPatch({ amount: Math.max(1, Math.min(720, Math.round(Number(e.target.value) || 1))) })} aria-label="Quantidade" />
          <Select value={node.data.unit} disabled={dis} onValueChange={(v) => onPatch({ unit: v })}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="hours">horas</SelectItem><SelectItem value="days">dias</SelectItem></SelectContent>
          </Select>
        </div>
      )}
      {node.kind === "if_reply" && <p className="text-xs text-muted-foreground">Vale durante toda a cadência: se o contato responder por e-mail (lido no Gmail) ou pelo WhatsApp, os envios param e os blocos do caminho “Sim” atualizam o card. A Pipeflow IA sugere uma resposta, que só sai com sua aprovação.</p>}
      {node.kind === "if_form" && <p className="text-xs text-muted-foreground">Vale durante toda a cadência: quando o formulário de diagnóstico cria um card com o mesmo e-mail ou com o identificador do link, os envios param e o caminho “Sim” atualiza o card original.</p>}
      {node.kind === "update_card" && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label>Mover para a etapa</Label>
            <Select value={node.data.stage || "none"} disabled={dis} onValueChange={(v) => onPatch({ stage: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Não mover</SelectItem>{stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Só avança (nunca volta etapas) e nunca move para Fechado.</p>
          </div>
          <div className="space-y-1">
            <Label>Adicionar etiqueta</Label>
            <Select value={node.data.tag || "none"} disabled={dis} onValueChange={(v) => onPatch({ tag: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Nenhuma</SelectItem>{DEFAULT_TAGS.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Status do card</Label><Input value={node.data.status} disabled={dis} maxLength={80} onChange={(e) => onPatch({ status: e.target.value })} placeholder="Deixe vazio para manter" /></div>
          <p className="text-[11px] text-muted-foreground">No caminho principal, use este bloco só no fim: ele vale quando a cadência termina sem resposta.</p>
        </div>
      )}
      {node.kind === "notify" && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label>Canal do aviso</Label>
            <Select value={node.data.channel} disabled={dis} onValueChange={(v) => onPatch({ channel: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="push">Notificação no aplicativo (push)</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Mensagem do aviso</Label>
            <Input value={node.data.message} disabled={dis} maxLength={300} onChange={(e) => onPatch({ message: e.target.value })} placeholder="{{empresa}} respondeu o e-mail da automação." />
            <p className="text-[11px] text-muted-foreground">Use no caminho “Sim” de “Respondeu?” ou “Preencheu o formulário?”. Variáveis: {"{{nome}}"} e {"{{empresa}}"}. O aviso sai mesmo se o canal estiver desligado na Central de Notificações — este bloco é uma escolha explícita da automação.</p>
          </div>
        </div>
      )}
      {node.kind === "end" && <p className="text-xs text-muted-foreground">Encerra este caminho da automação.</p>}
    </div>
  );
}

type Run = { id: string; leadId: string; leadName: string; company: string; contact: string; source: string; clicks: number; replyAt: string | null; formAt: string | null; cancelledAt: string | null; status: keyof typeof ENROLLMENT_LABEL; nextStep: number; nextSendAt: string | null; lastSentAt: string | null; reason: string; sent: number; stage: string; blocker: string | null };
function RunsTable({ runs, total, onAction, busy }: { runs: Run[]; total: number; onAction: (id: string, a: "pause" | "resume" | "cancel" | "send_now", ok: string) => void; busy: boolean }) {
  if (!runs.length) return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum card passou por esta automação ainda.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-2">Contato</th><th className="p-2">Situação</th><th className="p-2">Etapa</th><th className="p-2">E-mails</th><th className="p-2">Último envio</th><th className="p-2">Próximo envio</th><th className="p-2">Interações</th><th className="p-2 text-right">Ações</th></tr></thead>
        <tbody className="divide-y">
          {runs.map((r) => {
            const live = ["active", "paused", "awaiting_reply", "in_conversation"].includes(r.status) && !r.cancelledAt;
            return (
              <tr key={r.id}>
                <td className="p-2"><Link to="/" search={{ lead: r.leadId } as never} className="font-medium hover:underline">{r.leadName}</Link>{r.company && r.company !== r.leadName && <span className="block text-xs">{r.company}</span>}<span className="block text-xs text-muted-foreground">{r.contact}{r.source === "test" ? " · teste" : ""}</span></td>
                <td className="p-2"><Badge variant={r.status === "active" ? "default" : "secondary"}>{r.formAt ? "Preencheu o formulário" : r.cancelledAt ? "Cancelada" : ENROLLMENT_LABEL[r.status]}</Badge>{r.reason && <span className="mt-1 block max-w-56 text-xs text-muted-foreground">{r.reason}</span>}{r.blocker && <span className="mt-1 block max-w-56 text-xs text-destructive">{r.blocker}</span>}</td>
                <td className="p-2 text-xs">{r.stage || "—"}</td>
                <td className="p-2">{r.sent} de {total}</td>
                <td className="p-2 text-xs">{fmt(r.lastSentAt)}</td>
                <td className="p-2 text-xs">{r.status === "active" ? fmt(r.nextSendAt) : "—"}</td>
                <td className="p-2 text-xs">{r.clicks ? `${r.clicks} clique(s)` : "Sem cliques"}{r.replyAt ? " · respondeu" : ""}</td>
                <td className="p-2">
                  <div className="flex justify-end gap-1">
                    {r.status === "active" && <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction(r.id, "pause", "Pausada neste card.")}>Pausar</Button>}
                    {r.status === "paused" && live && !r.replyAt && !r.formAt && <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction(r.id, "resume", "Retomada neste card.")}>Retomar</Button>}
                    {r.source === "test" && r.status === "active" && <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction(r.id, "send_now", "Próximo e-mail sai na próxima execução (até 10 minutos).")}>Enviar próximo agora</Button>}
                    {live && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Cancelar a automação neste card? Nenhum novo e-mail será enviado a ele por ela.")) onAction(r.id, "cancel", "Automação cancelada neste card."); }}>Cancelar</Button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IncludeDialog({ open, onOpenChange, automationId, test, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; automationId: string; test: boolean; onDone: (t: string) => void }) {
  const search = useServerFn(getAutomationCandidates), start = useServerFn(startAutomationRun);
  const [query, setQuery] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const c = useQuery({ queryKey: ["automation-candidates", automationId, query], queryFn: () => search({ data: { automationId, query } }), enabled: open, retry: false });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Incluir card</DialogTitle>
          <DialogDescription>{test ? "Em teste, aparecem só cards com os e-mails de teste." : "Cards do funil do gatilho. Cada card participa uma única vez."}</DialogDescription>
        </DialogHeader>
        <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Nome, empresa ou e-mail" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
          {(c.data ?? []).map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 p-2">
              <span className="min-w-0"><span className="block truncate font-medium">{l.name || l.company}</span><span className="block truncate text-xs text-muted-foreground">{l.email}</span></span>
              <Button size="sm" disabled={busy} onClick={async () => {
                setBusy(true); setMsg("");
                try {
                  const r = await start({ data: { automationId, leadId: l.id, source: test ? "test" : "manual" } });
                  if (r.ok) { onOpenChange(false); onDone("Card incluído. O 1º e-mail sai na próxima execução, dentro dos dias e horários de envio."); }
                  else setMsg(r.reason ?? "Não foi possível incluir.");
                } catch (e) { setMsg(e instanceof Error ? e.message : "Não foi possível incluir."); }
                finally { setBusy(false); }
              }}>Incluir</Button>
            </li>
          ))}
          {c.data && !c.data.length && <li className="p-3 text-xs text-muted-foreground">Nenhum card encontrado.</li>}
        </ul>
        {msg && <p className="text-sm text-destructive">{msg}</p>}
      </DialogContent>
    </Dialog>
  );
}
