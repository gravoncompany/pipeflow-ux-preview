import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Mail, Pause, Play, RefreshCw, Save, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { getEmailAgent, setEmailAgentEnabled, saveEmailFlowSchedule, setEmailFlowState, enrollEmailFlow, syncEmails } from "@/lib/email-flows.functions";
import { FLOW_STATE_LABEL, WEEKDAYS, shortTime, windowLabel } from "@/lib/email-flows";
import { LeadCardOpener } from "./LeadCardOpener";

const fmt = (v: string | null | undefined) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

/** Seção "E-mail Marketing" do Agente Comercial: usa os Fluxos de E-mail existentes (mesmo mecanismo de envio). */
export function EmailAgentSection({ pipelineId, pipelineName }: { pipelineId: string | null; pipelineName: string }) {
  const get = useServerFn(getEmailAgent), setAgent = useServerFn(setEmailAgentEnabled), saveSchedule = useServerFn(saveEmailFlowSchedule);
  const setState = useServerFn(setEmailFlowState), enroll = useServerFn(enrollEmailFlow), sync = useServerFn(syncEmails);
  const q = useQuery({ queryKey: ["email-agent", pipelineId], queryFn: () => get({ data: { pipelineId } }), retry: false, refetchInterval: 60000 });
  const [flowId, setFlowId] = useState("");
  const [sched, setSched] = useState<{ days: number[]; start: string; end: string; max: number } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const data = q.data;
  const flow = data?.flows.find((f) => f.id === flowId) ?? data?.flows[0];
  useEffect(() => {
    if (flow) setSched({ days: flow.send_days, start: shortTime(flow.send_start), end: shortTime(flow.send_end), max: flow.max_messages });
  }, [flow?.id, flow?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const available = useMemo(() => (data?.leads ?? []).filter((l) => !l.inFlow), [data?.leads]);

  if (q.isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (q.isError || !data) return <div className="space-y-2"><p className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Agente de e-mail indisponível."}</p><Button size="sm" variant="outline" onClick={() => void q.refetch()}>Tentar novamente</Button></div>;

  async function act(work: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { const t = await work(); if (t) setNotice({ ok: true, text: t }); await q.refetch(); }
    catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "Ação indisponível." }); }
    finally { setBusy(false); }
  }
  const m = data.metrics;
  const toggleDay = (d: number) => sched && setSched({ ...sched, days: sched.days.includes(d) ? sched.days.filter((x) => x !== d) : [...sched.days, d].sort() });
  const schedValid = sched && sched.days.length > 0 && sched.start < sched.end && sched.max >= 1 && sched.max <= 10;

  return <div className="space-y-6">
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div><Label htmlFor="email-agent-enabled" className="text-base font-semibold">Agente para e-mails</Label>
          <p className="text-xs text-muted-foreground">Vale para todos os fluxos. Desligado, nenhuma etapa é enviada; respostas continuam sendo lidas e registradas.</p></div>
        <Switch id="email-agent-enabled" checked={data.agentEnabled} disabled={busy} onCheckedChange={(v) => void act(async () => {
          if (!window.confirm(v ? "Ligar o agente de e-mail? Os fluxos ativos voltam a enviar nos dias e horários configurados." : "Desligar o agente de e-mail? Nenhuma etapa será enviada até ligar de novo.")) return null;
          await setAgent({ data: { enabled: v, confirmed: true } }); return v ? "Agente de e-mail ligado." : "Agente de e-mail desligado.";
        })} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["Fluxos ativos", m.activeFlows], ["Fluxos pausados", m.pausedFlows], ["Leads em acompanhamento", m.following], ["E-mails enviados (30 dias)", m.sent],
          ["Respostas recebidas (30 dias)", m.replies], ["Aguardando atendimento", m.awaiting], ["Próximos disparos", data.upcoming.length], ["Falhas de envio/sincronização", m.failures]] as const).map(([l, n]) =>
          <div key={l} className="rounded-md border p-2.5"><p className="text-xl font-semibold">{n}</p><p className="text-xs text-muted-foreground">{l}</p></div>)}
      </div>
      <p className="text-xs text-muted-foreground">Indicadores dos cards do funil {pipelineName}.</p>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
        <span className="min-w-0"><Mail className="mr-1 inline size-4 text-primary" />Gmail: última sincronização {fmt(data.runner.inboxSyncedAt)}
          {data.runner.syncError && <span className="block text-xs text-destructive">Falha: {data.runner.syncError} Envios suspensos até uma leitura confiável.</span>}
          {data.reviewCount > 0 && <span className="block text-xs">{data.reviewCount} e-mail(s) de remetentes sem card para revisar em <Link to="/fluxos-email" className="underline">Fluxos de E-mail</Link>.</span>}</span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { const r = await sync(); return r.imported ? `${r.imported} e-mail(s) novo(s): ${r.linked} no card, ${r.review} para revisar.` : "Nenhum e-mail novo."; })}><RefreshCw className="size-4" />Sincronizar e-mails</Button>
      </div>
    </section>

    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Fluxo de e-mail marketing</h3><Link to="/fluxos-email" className="text-xs underline">Criar ou editar etapas e Pipeflow IA</Link></div>
      {!data.flows.length ? <p className="text-sm text-muted-foreground">Nenhum fluxo criado. Crie o primeiro em <Link to="/fluxos-email" className="underline">Fluxos de E-mail</Link>.</p> : flow && sched && <>
        <select aria-label="Fluxo" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={flow.id} onChange={(e) => { setFlowId(e.target.value); setSel(new Set()); }}>
          {data.flows.map((f) => <option key={f.id} value={f.id}>{f.name} · {FLOW_STATE_LABEL[f.state]}</option>)}
        </select>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={flow.state === "active" ? "default" : "secondary"}>{FLOW_STATE_LABEL[flow.state]}</Badge>
          {flow.ai_enabled ? <Badge variant={flow.aiOn ? "default" : "outline"}><Sparkles className="mr-1 size-3" />{flow.aiOn ? "Personalização Pipeflow IA aprovada" : "Pipeflow IA sem aprovação"}</Badge> : <Badge variant="outline">Sem personalização da IA</Badge>}
          <span className="text-xs text-muted-foreground">{flow.people} contato(s) · etapas nos dias {flow.steps.map((s) => s.day).join(", ")} · {windowLabel(flow)}</span>
        </div>
        {flow.ai_enabled && !flow.aiOn && <p className="text-xs text-destructive">Aprove as etapas no editor do fluxo para ativar com a Pipeflow IA.</p>}
        <div className="flex flex-wrap gap-2">
          {flow.state === "active"
            ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await setState({ data: { id: flow.id, revision: flow.revision, state: "paused" } }); return "Fluxo pausado; nenhum envio sai enquanto estiver pausado."; })}><Pause className="size-4" />Pausar</Button>
            : <Button size="sm" disabled={busy || (flow.ai_enabled && !flow.aiOn)} onClick={() => void act(async () => {
                if (!window.confirm(`${flow.state === "paused" ? "Retomar" : "Iniciar"} "${flow.name}"? ${flow.aiOn ? "A Pipeflow IA personaliza e envia as etapas aprovadas" : "As etapas aprovadas são enviadas"} nos dias e horários configurados até o cliente responder.`)) return null;
                await setState({ data: { id: flow.id, revision: flow.revision, state: "active" } }); return "Fluxo ativado.";
              })}><Play className="size-4" />{flow.state === "paused" ? "Retomar" : "Aprovar e iniciar"}</Button>}
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Dias e horários de envio (Brasília)</p>
          <div className="flex flex-wrap gap-1.5">{WEEKDAYS.map((n, i) => <Button key={n} type="button" size="sm" variant={sched.days.includes(i) ? "default" : "outline"} aria-pressed={sched.days.includes(i)} onClick={() => toggleDay(i)}>{n}</Button>)}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor="email-start">Início</Label><Input id="email-start" type="time" className="mt-1.5" value={sched.start} onChange={(e) => setSched({ ...sched, start: e.target.value })} /></div>
            <div><Label htmlFor="email-end">Fim</Label><Input id="email-end" type="time" className="mt-1.5" value={sched.end === "24:00" ? "23:59" : sched.end} onChange={(e) => setSched({ ...sched, end: e.target.value })} /></div>
            <div><Label htmlFor="email-max">Máximo de mensagens por contato</Label><Input id="email-max" type="number" min={1} max={10} className="mt-1.5" value={sched.max} onChange={(e) => setSched({ ...sched, max: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Intervalos entre follow-ups: dias das etapas ({flow.steps.map((s, i) => `etapa ${i + 1} no dia ${s.day}`).join(", ")}). Etapas que vencem fora da janela saem no próximo horário permitido.</p>
          {!schedValid && <p className="text-xs text-destructive">Escolha ao menos um dia e um horário final depois do inicial.</p>}
          <Button size="sm" disabled={busy || !schedValid} onClick={() => void act(async () => {
            await saveSchedule({ data: { id: flow.id, revision: flow.revision, days: sched.days, start: sched.start, end: sched.end, maxMessages: sched.max } });
            return "Dias, horários e limite salvos.";
          })}><Save className="size-4" />Salvar dias e horários</Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Leads participantes deste funil</p>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set(available.map((l) => l.id)))}>Selecionar todos disponíveis ({available.length})</Button></div>
          <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
            {data.leads.map((l) => <li key={l.id} className="flex items-center gap-3 p-2 text-sm">
              <Checkbox checked={sel.has(l.id)} disabled={l.inFlow} aria-label={`Selecionar ${l.name}`} onCheckedChange={() => setSel((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} />
              <span className="min-w-0 flex-1 truncate">{l.name || "Sem nome"}{l.company ? ` · ${l.company}` : ""} <span className="text-xs text-muted-foreground">{l.email}{l.inFlow ? " · já em sequência" : ""}</span></span>
            </li>)}
            {!data.leads.length && <li className="p-2 text-sm text-muted-foreground">Nenhum card com e-mail neste funil.</li>}
          </ul>
          <Button size="sm" variant="outline" disabled={busy || !sel.size} onClick={() => void act(async () => {
            const r = await enroll({ data: { flowId: flow.id, leadIds: [...sel] } }); setSel(new Set());
            return `${r.added} lead(s) adicionados a "${flow.name}"${r.skipped.length ? `; ${r.skipped.length} ignorado(s)` : ""}.${flow.state === "active" ? "" : " O fluxo só envia depois de aprovado e iniciado."}`;
          })}><UserPlus className="size-4" />Adicionar {sel.size || ""} ao fluxo</Button>
        </div>
      </>}
      {notice && <p role="status" className={`text-sm ${notice.ok ? "text-primary" : "text-destructive"}`}>{notice.text}</p>}
    </section>

    <LeadList title="Aguardando atendimento" empty="Ninguém aguardando resposta." rows={data.awaiting.map((a) => ({ ...a, detail: `${a.flow} · ${a.reason}` }))} onOpen={setOpenLead} />
    <LeadList title="Próximos disparos programados" empty="Nenhum envio programado." rows={data.upcoming.map((u) => ({ ...u, detail: `${u.flow} · etapa ${u.step} · ${fmt(u.at)}` }))} onOpen={setOpenLead} />
    <LeadList title="Sequências pausadas" empty="Nenhuma sequência pausada." rows={data.paused.map((p) => ({ ...p, detail: `${p.flow} · ${p.reason}` }))} onOpen={setOpenLead} />
    <LeadList title="Falhas de envio" empty="Nenhuma falha nos últimos 30 dias." rows={data.failures.map((f) => ({ ...f, detail: `${f.kind}${f.detail ? ` · ${f.detail}` : ""} · ${fmt(f.at)}` }))} onOpen={setOpenLead} />
    <LeadCardOpener leadId={openLead} onClose={() => setOpenLead(null)} />
  </div>;
}

function LeadList({ title, empty, rows, onOpen }: { title: string; empty: string; rows: { leadId: string; name: string; company: string; detail: string }[]; onOpen: (id: string) => void }) {
  return <section><h3 className="mb-2 font-semibold">{title}</h3>
    {!rows.length ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="divide-y text-sm">{rows.map((r, i) => <li key={`${r.leadId}-${i}`} className="flex items-center justify-between gap-2 py-2">
      <span className="min-w-0"><span className="block truncate">{r.name}{r.company ? ` · ${r.company}` : ""}</span><span className="block break-words text-xs text-muted-foreground">{r.detail}</span></span>
      <Button size="sm" variant="ghost" aria-label={`Abrir card de ${r.name}`} title="Abrir card" onClick={() => onOpen(r.leadId)}><ArrowUpRight className="size-4" /></Button>
    </li>)}</ul>}
  </section>;
}
