import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Bot, RefreshCw, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AdminAccessRequired } from "./AdminAccessRequired";
import { getCommercialAgent, saveCommercialAgent, releaseCommercialAgentHold, type AgentSettingsView } from "@/lib/commercial-agent.functions";
import { RUN_STATUS, resolveStageRoles } from "@/lib/commercial-agent";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { getCommercialAgentOverview, type AgentFunnelSummary } from "@/lib/commercial-agent-overview.functions";
import { pipeflowCrmTemplate } from "@/lib/commercial-agent-templates";
import { EmailAgentSection } from "./EmailAgentSection";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const EVENTS: Record<string, string> = { configuration: "Configuração salva", received: "Mensagem recebida", analysis: "Análise da IA", generated: "Resposta gerada", send_reserved: "Envio reservado", accepted: "Aceita pelo WhatsApp", crm_recorded: "Registrada em Conversas", stage_decision: "Decisão de etapa", human: "Transferida para humano", skipped: "Não respondida", send_error: "Envio sem confirmação", quarantine: "Quarentena", blocked: "Agente pausado", ambiguous_contact: "Contato em mais de um funil" };
const DECISIONS: Record<string, string> = { moved: "Card movido", suggested: "Sugestão de etapa", no_change: "Sem mudança de etapa", invalid_evidence: "Movimento recusado: sem evidência", invalid_target: "Etapa inválida", stale: "Card mudou", blocked: "Movimento bloqueado", not_permitted: "Movimento sem permissão nesta etapa" };
const lines = (v: string) => v.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
const time = (v: string) => new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

type Draft = AgentSettingsView & { confirmAllAudience: boolean; recipientsText: string; servedText: string; excludedText: string; servicesText: string; keywordsText: string };
const draftOf = (s: AgentSettingsView): Draft => ({ ...s, confirmAllAudience: false, recipientsText: s.recipients.join("\n"), servedText: s.servedRegions.join(", "), excludedText: s.excludedRegions.join(", "), servicesText: s.services.join(", "), keywordsText: s.handoffKeywords.join(", ") });

export function CommercialAgentButton({ pipelineId, pipelineName }: { pipelineId: string | null; pipelineName: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ id: string | null; name: string }>({ id: pipelineId, name: pipelineName });
  const fetchOverview = useServerFn(getCommercialAgentOverview);
  const overview = useQuery({ queryKey: ["commercial-agent-overview"], queryFn: () => fetchOverview(), enabled: open, retry: false });
  const funnels = overview.data?.authorized ? overview.data.funnels : [];
  useEffect(() => { if (open) setSelected({ id: pipelineId, name: pipelineName }); }, [open, pipelineId, pipelineName]);
  const label = (f: AgentFunnelSummary) => `${f.name} · ${f.blocked ? "pausado" : f.enabled ? (f.audience === "test" ? "ligado (teste)" : "ligado") : "desligado"}`;
  return <>
    <Button variant="outline" size="sm" title={`Agente Comercial — Pipeflow IA · ${pipelineName}`} aria-label="Agente Comercial — Pipeflow IA" onClick={() => setOpen(true)}><Bot className="size-4" /><span className="hidden lg:inline">Pipeflow IA</span></Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader><SheetTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" />Agente Comercial — Pipeflow IA</SheetTitle><SheetDescription>Funil: {selected.name}. Cada funil tem configuração própria e não afeta os demais.</SheetDescription></SheetHeader>
        {funnels.length > 0 && <div className="px-4 pb-2"><Label htmlFor="agent-funnel">Funil configurado</Label>
          <select id="agent-funnel" className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm" value={selected.id ?? MAIN_KEY}
            onChange={(e) => { const f = funnels.find((x) => (x.pipelineId ?? MAIN_KEY) === e.target.value); if (f) setSelected({ id: f.pipelineId, name: f.name }); }}>
            {funnels.map((f) => <option key={f.pipelineId ?? MAIN_KEY} value={f.pipelineId ?? MAIN_KEY}>{label(f)}</option>)}
          </select></div>}
        {open && <AgentPanel key={selected.id ?? MAIN_KEY} pipelineId={selected.id} pipelineName={selected.name} onSaved={() => void overview.refetch()} />}
      </SheetContent>
    </Sheet>
  </>;
}
const MAIN_KEY = "__main__";

function AgentPanel({ pipelineId, pipelineName, onSaved }: { pipelineId: string | null; pipelineName: string; onSaved?: () => void }) {
  const fetch = useServerFn(getCommercialAgent);
  const save = useServerFn(saveCommercialAgent);
  const release = useServerFn(releaseCommercialAgentHold);
  const query = useQuery({ queryKey: ["commercial-agent", pipelineId], queryFn: () => fetch({ data: { pipelineId } }), retry: false, refetchInterval: 30000 });
  const data = query.data?.authorized ? query.data : null;
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [releasing, setReleasing] = useState<{ contactKey: string; phone: string } | null>(null);
  useEffect(() => { if (data && (!d || d.revision !== data.settings.revision)) setD(draftOf(data.settings)); }, [data?.settings.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isPending) return <p className="p-4 text-sm text-muted-foreground">Carregando…</p>;
  if (query.data?.authorized === false) return <AdminAccessRequired compact reason={query.data.reason} message={query.data.error} returnTo="/" onUnlocked={() => void query.refetch()} />;
  if (query.isError) return <div className="space-y-3 p-4"><p className="text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Não foi possível carregar o agente."}</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div>;
  if (!data || !d) return null;
  const set = (patch: Partial<Draft>) => { setD({ ...d, ...patch }); setNotice(null); };
  // Fills the form only; nothing is saved or enabled until "Salvar configuração".
  const applyPipeflowTemplate = () => {
    if (d.instructions.trim() && !window.confirm(`Substituir as instruções, serviços e requisitos atuais de ${pipelineName} pelo modelo Pipeflow CRM?`)) return;
    const t = pipeflowCrmTemplate(data.stages);
    set({ instructions: t.instructions, servicesText: t.services.join(", "), requirements: t.requirements, keywordsText: t.handoffKeywords.join(", "),
      allowedStages: d.allowedStages.length ? d.allowedStages : t.allowedStages,
      stageMap: Object.fromEntries(Object.entries({ ...t.stageMap, ...d.stageMap }).filter(([, v]) => v)) as Draft["stageMap"] });
    setNotice({ ok: true, text: "Modelo aplicado ao formulário. Revise e clique em Salvar configuração; o agente continua desligado." });
  };
  const status = data.settings.blockedReason ? { label: "Pausado", variant: "destructive" as const } : data.settings.enabled ? { label: data.settings.audience === "test" ? "Ativo · somente números de teste" : "Ativo · todos os contatos", variant: "default" as const } : { label: "Desligado", variant: "secondary" as const };

  async function submit() {
    if (!d || busy) return;
    setBusy(true); setNotice(null);
    try {
      await save({ data: { pipelineId, revision: d.revision, enabled: d.enabled, audience: d.audience, confirmAllAudience: d.confirmAllAudience, instance: d.instance,
        recipients: lines(d.recipientsText), allowedStages: d.allowedStages, instructions: d.instructions, servedRegions: lines(d.servedText), excludedRegions: lines(d.excludedText),
        services: lines(d.servicesText), requirements: d.requirements, stageMap: Object.fromEntries(Object.entries(d.stageMap).filter(([, v]) => v)), autoMove: d.autoMove, ...(d.moveStages ? { moveStages: d.moveStages } : {}),
        handoffKeywords: lines(d.keywordsText), pauseOnHumanReply: d.pauseOnHumanReply, humanPauseHours: d.humanPauseHours, businessDays: d.businessDays, dayStart: d.dayStart, dayEnd: d.dayEnd,
        maxRepliesPerContactDay: d.maxRepliesPerContactDay, maxRepliesPerDay: d.maxRepliesPerDay, maxReplyChars: d.maxReplyChars, maxMessageAgeMinutes: d.maxMessageAgeMinutes } });
      setNotice({ ok: true, text: d.enabled ? "Configuração salva. O agente responde apenas conforme estas regras." : "Configuração salva. O agente deste funil está desligado." });
      await query.refetch();
      onSaved?.();
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "Não foi possível salvar." }); }
    finally { setBusy(false); }
  }
  async function confirmRelease() {
    if (!releasing) return; setBusy(true);
    try { await release({ data: { contactKey: releasing.contactKey, confirmed: true } }); await query.refetch(); }
    catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "Não foi possível liberar." }); }
    finally { setBusy(false); setReleasing(null); }
  }
  const num = (k: keyof Draft, min: number, max: number) => <Input type="number" min={min} max={max} className="mt-2" value={String(d[k])} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<Draft>)} />;

  const original = draftOf(data.settings);
  const dirty = JSON.stringify(d) !== JSON.stringify(original);
  const roles = resolveStageRoles(data.stages, d.stageMap, pipelineId === null);
  const derivedMove = [roles.atendimento, roles.qualificado].filter((x): x is string => Boolean(x));
  const moveList = d.moveStages ?? derivedMove;
  const toggle = (list: string[], id: string, on: boolean) => on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
  const group = (value: string, title: string, hint: string, children: ReactNode) => <AccordionItem value={value} className="rounded-lg border px-3">
    <AccordionTrigger className="py-3 hover:no-underline"><span className="text-left"><span className="block font-semibold">{title}</span><span className="block text-xs font-normal text-muted-foreground">{hint}</span></span></AccordionTrigger>
    <AccordionContent className="space-y-4 pb-4">{children}</AccordionContent>
  </AccordionItem>;

  return <div className="space-y-4 px-4 pb-8">
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3" aria-label="Funil e status do agente">
      <div className="min-w-0"><p className="text-xs text-muted-foreground">Funil</p><p className="truncate font-semibold">{pipelineName}</p></div>
      <Badge variant={status.variant}>{status.label}</Badge>{data.settings.enabled && <Badge variant="outline">{data.openNow ? "Dentro do horário" : "Fora do horário"}</Badge>}
      <Button variant="ghost" size="icon" className="ml-auto" aria-label="Atualizar" title="Atualizar" onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /></Button></div>
    {data.settings.blockedReason && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{data.settings.blockedReason} Salve a configuração para reativar após resolver.</p>}
    <Tabs defaultValue="config">
      <TabsList><TabsTrigger value="config">Configuração</TabsTrigger><TabsTrigger value="status">Status</TabsTrigger><TabsTrigger value="email">E-mail Marketing</TabsTrigger></TabsList>
      <TabsContent value="config" className="space-y-3 pt-3">
        <Accordion type="multiple" defaultValue={["atendimento"]} className="space-y-3">
        {group("atendimento", "Atendimento", "Quem a IA atende e em quais etapas pode responder", <>
          <div className="flex items-center justify-between gap-4"><Label htmlFor="agent-enabled" className="text-base font-semibold">Atendimento automático</Label><Switch id="agent-enabled" checked={d.enabled} onCheckedChange={(v) => set({ enabled: v })} /></div>
          <div><Label htmlFor="agent-instance">WhatsApp que responde</Label>
            <select id="agent-instance" className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm" value={d.instance} onChange={(e) => set({ instance: e.target.value })}>
              <option value="">Selecione…</option>{data.channels.map((c) => <option key={c.instance} value={c.instance}>{c.instance} · {c.masked}</option>)}
            </select>
            {!data.channels.length && <p className="mt-1 text-xs text-muted-foreground">Nenhum WhatsApp vinculado à sua conta administrativa.</p>}</div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Quem a IA pode atender</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="audience" checked={d.audience === "test"} onChange={() => set({ audience: "test" })} />Somente números de teste autorizados</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="audience" checked={d.audience === "all"} onChange={() => set({ audience: "all" })} />Todos os contatos com card neste funil</label>
            {d.audience === "all" && <label className="flex items-start gap-2 rounded-md border border-amber-500/50 p-3 text-sm"><Checkbox checked={d.confirmAllAudience} onCheckedChange={(v) => set({ confirmAllAudience: v === true })} /><span>Confirmo que a IA pode responder clientes reais deste funil, conforme as regras abaixo.</span></label>}
          </fieldset>
          {d.audience === "test" && <div><Label htmlFor="agent-recipients">Números de teste (um por linha, com DDI e DDD)</Label><Textarea id="agent-recipients" className="mt-2" rows={3} value={d.recipientsText} onChange={(e) => set({ recipientsText: e.target.value })} placeholder="5551999990000" /></div>}
          <fieldset><legend className="mb-2 text-sm font-medium">Etapas em que a IA pode responder</legend>
            <div className="grid gap-2 sm:grid-cols-2">{data.stages.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><Checkbox aria-label={`Responder em ${s.title}`} checked={d.allowedStages.includes(s.id)} onCheckedChange={(v) => set({ allowedStages: toggle(d.allowedStages, s.id, v === true) })} />{s.title}</label>)}</div>
            <p className="mt-1 text-xs text-muted-foreground">Responder numa etapa não permite mover o card. Isso fica em Regras do Pipeline.</p></fieldset>
        </>)}
        {group("instrucoes", "Instruções e qualificação", "Como a IA conversa e o que conta para qualificar o lead", <>
          <div><div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="agent-instructions" className="font-semibold">Instruções de atendimento deste funil</Label>
              <Button type="button" size="sm" variant="outline" onClick={applyPipeflowTemplate}>Usar modelo Pipeflow CRM</Button></div>
            <Textarea id="agent-instructions" className="mt-2" rows={5} maxLength={4000} value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Tom de voz, objetivo da conversa, perguntas de qualificação, próximo passo desejado…" />
            <p className="mt-1 text-xs text-muted-foreground">Preços, serviços e condições vêm somente do <Link to="/conhecimento" className="underline">Conhecimento Comercial</Link> ({data.knowledgeCount} registro(s)). Sem base cadastrada, a IA transfere para um humano.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Regiões atendidas</Label><Input className="mt-2" value={d.servedText} onChange={(e) => set({ servedText: e.target.value })} placeholder="Vazio = todas" /></div>
            <div><Label>Regiões não atendidas</Label><Input className="mt-2" value={d.excludedText} onChange={(e) => set({ excludedText: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Serviços oferecidos</Label><Input className="mt-2" value={d.servicesText} onChange={(e) => set({ servicesText: e.target.value })} placeholder="Separados por vírgula" /></div>
            <div className="sm:col-span-2"><Label>Requisitos para qualificar</Label><Textarea className="mt-2" rows={2} maxLength={2000} value={d.requirements} onChange={(e) => set({ requirements: e.target.value })} /></div>
          </div>
        </>)}
        {group("pipeline", "Regras do Pipeline", "Para quais etapas a IA pode mover um card", <>
          <div className="flex items-center justify-between gap-4"><Label htmlFor="agent-move">Mover o card automaticamente (somente com evidência; nunca para Fechado, Perdido ou Agendado)</Label><Switch id="agent-move" checked={d.autoMove} onCheckedChange={(v) => set({ autoMove: v })} /></div>
          <fieldset><legend className="mb-2 text-sm font-medium">Etapas para onde a IA pode mover o card</legend>
            <div className="grid gap-2 sm:grid-cols-2">{data.stages.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><Checkbox aria-label={`Mover para ${s.title}`} checked={moveList.includes(s.id)} onCheckedChange={(v) => set({ moveStages: toggle(moveList, s.id, v === true) })} />{s.title}</label>)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{d.moveStages === null ? "Ainda segue as etapas do fluxo abaixo. Ao marcar ou desmarcar, esta lista passa a valer para este funil." : "Mover para uma etapa não permite responder nela. Etapas finais continuam só como sugestão."}</p></fieldset>
          <div className="grid gap-3 sm:grid-cols-3">{(["novo", "atendimento", "qualificado"] as const).map((role) => <div key={role}><Label>{role === "novo" ? "Etapa de entrada" : role === "atendimento" ? "Etapa em atendimento" : "Etapa qualificado"}</Label>
            <select className="mt-2 h-10 w-full rounded-md border bg-background px-2 text-sm" value={d.stageMap[role] ?? ""} onChange={(e) => set({ stageMap: { ...d.stageMap, [role]: e.target.value || undefined } })}><option value="">{pipelineId ? "Automática" : "Não mover"}</option>{data.stages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>)}</div>
        </>)}
        {group("humano", "Atendimento humano e limites", "Transferência para uma pessoa, horários e segurança", <>
          <p className="text-xs text-muted-foreground">Sempre transfere em pedidos de desconto, reclamações, cancelamentos, questões jurídicas, mídia (áudio/imagem), falta de informação na base ou pedido para falar com uma pessoa.</p>
          <div className="flex items-center justify-between gap-4"><Label htmlFor="agent-pause">Pausar a IA quando alguém da equipe responder o contato</Label><Switch id="agent-pause" checked={d.pauseOnHumanReply} onCheckedChange={(v) => set({ pauseOnHumanReply: v })} /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label>Pausa após resposta humana (horas)</Label>{num("humanPauseHours", 1, 720)}</div>
            <div><Label>Palavras que transferem</Label><Input className="mt-2" value={d.keywordsText} onChange={(e) => set({ keywordsText: e.target.value })} placeholder="contrato, boleto" /></div></div>
          <div className="space-y-3"><h4 className="text-sm font-medium">Horário de atendimento (Brasília)</h4>
            <div className="flex flex-wrap gap-2">{DAYS.map((name, i) => <Button key={name} type="button" size="sm" variant={d.businessDays.includes(i) ? "default" : "outline"} onClick={() => set({ businessDays: d.businessDays.includes(i) ? d.businessDays.filter((x) => x !== i) : [...d.businessDays, i].sort() })}>{name}</Button>)}</div>
            <div className="grid max-w-sm grid-cols-2 gap-3"><div><Label>Início</Label><Input type="time" className="mt-2" value={d.dayStart} onChange={(e) => set({ dayStart: e.target.value })} /></div><div><Label>Fim</Label><Input type="time" className="mt-2" value={d.dayEnd} onChange={(e) => set({ dayEnd: e.target.value })} /></div></div></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Respostas por contato/dia</Label>{num("maxRepliesPerContactDay", 1, 50)}</div>
            <div><Label>Respostas do funil/dia</Label>{num("maxRepliesPerDay", 1, 1000)}</div>
            <div><Label>Tamanho máximo da resposta</Label>{num("maxReplyChars", 100, 800)}</div>
            <div><Label>Responder mensagens de até (minutos)</Label>{num("maxMessageAgeMinutes", 1, 60)}</div>
          </div>
          <p className="text-xs text-muted-foreground">Cada mensagem é respondida no máximo uma vez. Envio sem confirmação nunca é repetido e coloca o contato em atendimento humano.</p>
        </>)}
        </Accordion>
        {notice && <p role="status" className={`text-sm ${notice.ok ? "text-primary" : "text-destructive"}`}>{notice.text}</p>}
        {(dirty || data.settings.blockedReason) && <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-3">
          <span className="text-sm text-muted-foreground">{dirty ? "Alterações não salvas neste funil" : "Salve para reativar o agente"}</span>
          <div className="flex gap-2"><Button variant="ghost" disabled={busy} onClick={() => { setD(original); setNotice(null); }}>Descartar</Button><Button disabled={busy} onClick={() => void submit()}><Save />{busy ? "Salvando…" : "Salvar configuração"}</Button></div></div>}
      </TabsContent>
      <TabsContent value="status" className="space-y-6 pt-3">
        <div className="grid grid-cols-3 gap-3 border-y py-4 text-center">{([["Respondidas hoje", data.today.answered], ["Para humano", data.today.human], ["Não respondidas", data.today.skipped]] as const).map(([l, n]) => <div key={l}><p className="text-2xl font-semibold">{n}</p><p className="text-xs text-muted-foreground">{l}</p></div>)}</div>
        <section><h3 className="mb-2 flex items-center gap-2 font-semibold"><UserRound className="size-4" />Contatos em atendimento humano</h3>
          {!data.holds.length ? <p className="text-sm text-muted-foreground">Nenhum.</p> : <ul className="divide-y text-sm">{data.holds.map((h) => <li key={h.contactKey} className="flex flex-wrap items-center justify-between gap-2 py-2"><div className="min-w-0"><p>{h.phone}</p><p className="text-xs text-muted-foreground">{h.reason}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => setReleasing(h)}>Devolver à IA</Button></li>)}</ul>}</section>
        <section><h3 className="mb-2 font-semibold">Últimos atendimentos</h3>
          {!data.runs.length ? <p className="text-sm text-muted-foreground">Nenhuma mensagem processada por este funil.</p> : <ul className="divide-y text-sm">{data.runs.map((r) => <li key={r.id} className="py-2">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{RUN_STATUS[r.status] ?? r.status} · {r.phone}</span><span className="text-xs text-muted-foreground">{time(r.createdAt)}</span></div>
            {r.reply && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">“{r.reply}”</p>}
            {r.reason && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}
            {(r.decision || r.qualification) && <p className="mt-1 text-xs">{r.decision ? DECISIONS[r.decision] ?? r.decision : ""}{r.qualification ? ` · Qualificação: ${r.qualification}` : ""}</p>}
          </li>)}</ul>}</section>
        <section><h3 className="mb-2 font-semibold">Auditoria</h3>
          {!data.audit.length ? <p className="text-sm text-muted-foreground">Sem eventos.</p> : <ul className="space-y-1 text-xs">{data.audit.map((e, i) => <li key={i} className="flex justify-between gap-2"><span>{EVENTS[e.event] ?? e.event}{e.reason ? ` · ${e.reason}` : ""}</span><span className="shrink-0 text-muted-foreground">{time(e.createdAt)}</span></li>)}</ul>}</section>
      </TabsContent>
      <TabsContent value="email" className="pt-3"><EmailAgentSection pipelineId={pipelineId} pipelineName={pipelineName} /></TabsContent>
    </Tabs>
    <AlertDialog open={Boolean(releasing)} onOpenChange={(o) => { if (!o) setReleasing(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Devolver {releasing?.phone} à Pipeflow IA?</AlertDialogTitle><AlertDialogDescription>Confira a conversa antes: envios sem confirmação não são repetidos. A IA volta a responder somente as próximas mensagens do contato.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmRelease(); }}>Devolver</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}
