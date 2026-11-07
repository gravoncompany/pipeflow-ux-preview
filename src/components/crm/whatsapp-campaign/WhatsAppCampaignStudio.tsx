import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, MessageCircle, Check, ChevronLeft, ChevronRight, Save, ShieldCheck, X, RefreshCw, Users, Settings2, PenLine, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { CampaignsLayout } from "@/components/crm/CampaignsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { WhatsAppCampaignProgress } from "@/components/crm/WhatsAppCampaignProgress";
import { getCampaignOverview, saveCampaignDraft, cancelCampaign, validateCampaignChannel, confirmCampaign, draftWhatsAppCampaignMessage } from "@/lib/campaigns.functions";
import { CAMPAIGN_SELECTION_KEY } from "@/lib/campaign-recipients";
import { DEFAULT_PACING, SEND_INTERVALS, PAUSE_EVERY, PAUSE_SECONDS, WHATSAPP_CAMPAIGN_ACK, estimateSeconds, formatDuration, isValidPacing, type Pacing } from "@/lib/whatsapp-campaigns";
import { formatInZone, utcToZonedLocal, zonedLocalToUtc } from "@/lib/email-campaigns";
import { campaignLabels, type Campaign, type CampaignInput } from "@/lib/campaigns";
import { RecipientsStep, type Selection, type Lead } from "./RecipientsStep";
import { MessageStep } from "./MessageStep";

const TZ = "America/Sao_Paulo";
const STEPS = [{ label: "Destinatários", icon: Users }, { label: "Configurações", icon: Settings2 }, { label: "Mensagem", icon: PenLine }, { label: "Revisão e envio", icon: Send }] as const;
const TABS = [["all", "Todas"], ["running", "Em andamento"], ["scheduled", "Agendadas"], ["paused", "Pausadas"], ["completed", "Concluídas"], ["draft", "Rascunhos"], ["cancelled", "Canceladas"]] as const;
type Draft = { id: string | null; revision: number; name: string; instance: string; body: string; scheduledAt: string | null; sel: Selection };
const blank = (leadIds: string[] = []): Draft => ({ id: null, revision: 1, name: "", instance: "", body: "", scheduledAt: null, sel: { kind: "individual", leadIds, clientIds: [], manual: [], groups: [] } });
const toInput = (d: Draft): CampaignInput => ({ id: d.id, revision: d.revision, name: d.name.trim(), channel: "whatsapp", subject: "", body: d.body, senderReference: "", instanceReference: d.instance, leadIds: d.sel.kind === "groups" ? [] : d.sel.leadIds, clientIds: d.sel.kind === "groups" ? [] : d.sel.clientIds, audienceKind: d.sel.kind, groups: d.sel.kind === "groups" ? d.sel.groups : [], manual: d.sel.kind === "groups" ? [] : d.sel.manual, scheduledAt: d.scheduledAt });

export function WhatsAppCampaignStudio() {
  const get = useServerFn(getCampaignOverview), save = useServerFn(saveCampaignDraft), cancel = useServerFn(cancelCampaign), validate = useServerFn(validateCampaignChannel), confirmRun = useServerFn(confirmCampaign), aiDraft = useServerFn(draftWhatsAppCampaignMessage);
  const overview = useQuery({ queryKey: ["campaigns"], queryFn: () => get(), retry: false, gcTime: 0 });
  const [draft, setDraft] = useState<Draft | null>(null), [step, setStep] = useState(0), [tab, setTab] = useState("all");
  const [pacing, setPacing] = useState<Pacing>(DEFAULT_PACING), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [validation, setValidation] = useState<Awaited<ReturnType<typeof validateCampaignChannel>> | null>(null), [localDate, setLocalDate] = useState("");
  const lock = useRef(false);
  const data = overview.data;
  const update = (p: Partial<Draft>) => { setAck(false); setValidation(null); setDraft(d => d ? { ...d, ...p } : d); };
  async function run(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Ação indisponível."); } finally { setBusy(false); } }

  function create() {
    let ids: string[] = [];
    try { const v = JSON.parse(sessionStorage.getItem(CAMPAIGN_SELECTION_KEY) ?? "null"); if (v?.channel === "whatsapp") { ids = v.leadIds ?? []; sessionStorage.removeItem(CAMPAIGN_SELECTION_KEY); } } catch { /* sem seleção */ }
    const ready = data?.whatsappChannels.instances.filter(i => i.campaignAuthorized) ?? [];
    setDraft({ ...blank(ids), instance: ready.length === 1 ? ready[0].reference : "" }); setStep(0); setPacing(DEFAULT_PACING); setAck(false); setValidation(null); setLocalDate("");
  }
  function edit(c: Campaign) {
    setDraft({ id: c.id, revision: c.revision, name: c.name, instance: c.instance_reference, body: c.body, scheduledAt: c.scheduled_at, sel: { kind: c.audience_kind ?? "individual", leadIds: c.lead_ids, clientIds: c.client_ids ?? [], manual: c.manual_targets ?? [], groups: c.group_targets ?? [] } });
    const p = (data?.pacing as Record<string, Pacing> | undefined)?.[c.id]; setPacing(p ?? DEFAULT_PACING);
    setLocalDate(c.scheduled_at ? utcToZonedLocal(c.scheduled_at, TZ) : ""); setStep(0); setAck(false); setValidation(null);
  }
  const counts = draft ? (draft.sel.kind === "groups" ? draft.sel.groups.length : draft.sel.leadIds.length + draft.sel.clientIds.length + draft.sel.manual.length) : 0;
  const blockers = useMemo(() => {
    if (!draft) return [[], [], [], []] as string[][];
    const s0 = [!draft.name.trim() || draft.name.trim().length < 2 ? "Dê um nome à campanha." : "", !draft.instance ? "Escolha a instância do WhatsApp." : "", !counts ? "Selecione ao menos um destinatário." : ""].filter(Boolean);
    const s1 = [!isValidPacing(pacing) ? "Intervalo ou pausa fora dos limites." : "", localDate && !draft.scheduledAt ? "Horário inválido." : "", draft.scheduledAt && Date.parse(draft.scheduledAt) < Date.now() + 60000 ? "O agendamento precisa estar no futuro." : ""].filter(Boolean);
    const s2 = [!draft.body.trim() ? "Escreva a mensagem." : ""].filter(Boolean);
    return [s0, s1, s2, []];
  }, [draft, counts, pacing, localDate]);

  async function saveDraft() {
    if (!draft) return;
    const saved = await save({ data: toInput(draft) });
    setDraft(d => d ? { ...d, id: saved.id, revision: saved.revision } : d);
    await overview.refetch();
    setNotice("Rascunho salvo. Nenhuma mensagem enviada.");
  }
  async function start() {
    if (!draft || lock.current || !validation?.ready || !ack) return;
    const when = draft.scheduledAt ? ` agendada para ${formatInZone(draft.scheduledAt, TZ)}` : "";
    if (!window.confirm(`Iniciar a campanha${when} para ${validation.eligible} ${draft.sel.kind === "groups" ? "grupo(s)" : "destinatário(s)"}? Mensagens enviadas não podem ser desfeitas.`)) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const { saved, result } = await confirmRun({ data: { draft: toInput(draft), confirmed: true, acknowledged: ack, pacing } });
      if (result.ok) { setNotice(result.message); setDraft(null); setTab("all"); await overview.refetch(); return; }
      if (saved) setDraft(d => d ? { ...d, id: saved.id, revision: saved.revision } : d);
      setError(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Ação indisponível."); } finally { lock.current = false; setBusy(false); }
  }

  if (overview.isError) return <CrmAuthGate onUnlock={() => void overview.refetch()} />;
  const list = (data?.campaigns ?? []).filter(c => c.channel === "whatsapp");
  const instances = data?.whatsappChannels.instances ?? [];
  const sample = (() => {
    if (!draft) return { name: "", company: "" };
    if (draft.sel.kind === "groups") return { name: draft.sel.groups[0]?.name ?? "Nome do grupo", company: "" };
    const l = data?.leads.find(x => x.id === draft.sel.leadIds[0]); const m = draft.sel.manual[0];
    return l ? { name: l.name, company: l.company } : m ? { name: m.name, company: m.company } : { name: "Maria", company: "Empresa Exemplo" };
  })();

  return <CampaignsLayout><main className="min-w-0 flex-1 p-4 md:p-6">
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b pb-4">
      <div className="min-w-0"><h1 className="flex items-center gap-2 text-2xl font-semibold"><MessageCircle className="size-6 shrink-0 text-primary" /><span className="truncate">Campanhas de WhatsApp</span></h1><p className="mt-1 text-sm text-muted-foreground">Contatos ou grupos, mensagem revisada, envio gradual e acompanhamento.</p></div>
      {!draft ? <Button onClick={create} disabled={!data}><Plus className="size-4" />Nova campanha</Button> : <Button variant="ghost" size="icon" aria-label="Fechar" onClick={() => { if (window.confirm("Fechar sem salvar as alterações?")) setDraft(null); }}><X className="size-4" /></Button>}
    </header>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-primary">{notice}</p>}
    {!draft ? <>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">{([["Em andamento", "running"], ["Agendadas", "scheduled"], ["Pausadas", "paused"], ["Concluídas", "completed"]] as const).map(([l, s]) => <div key={s} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-2xl font-semibold">{list.filter(c => c.state === s).length}</p></div>)}</div>
      <div className="mt-4 flex flex-wrap gap-1 border-b">{TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{l}</button>)}</div>
      <div className="divide-y">{list.filter(c => tab === "all" || c.state === tab).map(c => <div key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-4"><div className="min-w-0"><h2 className="font-semibold">{c.name}</h2><p className="mt-1 text-xs text-muted-foreground">{c.audience_kind === "groups" ? `Grupos · ${(c.group_targets ?? []).length}` : `Individual · ${c.lead_ids.length + (c.client_ids?.length ?? 0) + (c.manual_targets?.length ?? 0)} destinatários`} · {campaignLabels[c.state]} · {c.instance_reference || "sem instância"}{c.scheduled_at ? ` · ${formatInZone(c.scheduled_at, TZ)}` : ""}</p>{c.state !== "draft" && <WhatsAppCampaignProgress id={c.id} initialState={c.state} onChanged={() => void overview.refetch()} />}</div>{c.state === "draft" && <span className="flex gap-2"><Button variant="outline" size="sm" onClick={() => edit(c)}>Abrir</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { if (!window.confirm("Cancelar este rascunho?")) return; await cancel({ data: { id: c.id, revision: c.revision, confirmed: true } }); await overview.refetch(); })}>Cancelar</Button></span>}</div>)}
        {data && list.length === 0 && <p className="py-8 text-sm text-muted-foreground">Nenhuma campanha de WhatsApp registrada.</p>}{overview.isPending && <p className="py-8 text-sm">Carregando campanhas…</p>}</div>
    </> : <section className="mt-4 space-y-5">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Etapas">{STEPS.map((s, i) => { const done = i < step && blockers[i].length === 0; const I = s.icon; return <li key={s.label}><button type="button" onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined} className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${i === step ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted"}`}><span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${i === step || done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{done ? <Check className="size-4" /> : i + 1}</span><span className="min-w-0 truncate"><I className="mr-1 inline size-4" />{s.label}</span></button></li>; })}</ol>
      <div className="h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / 4) * 100}%` }} /></div>

      {step === 0 && <>
        <div className="grid gap-3 md:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="wa-name">Nome da campanha</Label><Input id="wa-name" value={draft.name} maxLength={150} onChange={e => update({ name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Instância do WhatsApp</Label><div className="flex gap-2"><Select value={draft.instance || "none"} onValueChange={v => update({ instance: v === "none" ? "" : v })}><SelectTrigger className="min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Selecionar instância</SelectItem>{instances.map(i => <SelectItem key={i.reference} value={i.reference} disabled={!i.bindingVerified}>{i.reference} · {i.connection === "open" ? "Conectada" : "Desconectada"}</SelectItem>)}</SelectContent></Select><Button variant="ghost" size="icon" aria-label="Atualizar instâncias" onClick={() => void overview.refetch()}><RefreshCw className="size-4" /></Button></div>{data?.whatsappChannels.error && <p className="text-xs text-destructive">{data.whatsappChannels.error}</p>}{instances.find(i => i.reference === draft.instance)?.reasons.map(r => <p key={r} className="text-xs text-destructive">{r}</p>)}</div></div>
        <RecipientsStep value={draft.sel} onChange={sel => update({ sel })} leads={(data?.leads ?? []) as Lead[]} clients={data?.clients ?? null} instance={draft.instance} />
      </>}

      {step === 1 && <div className="grid gap-4 md:grid-cols-3">
        <PacingCard title="Intervalo entre mensagens">
          <Select value={SEND_INTERVALS.find(i => i.min === pacing.min && i.max === pacing.max)?.key ?? "custom"} onValueChange={k => { const i = SEND_INTERVALS.find(x => x.key === k); if (i) setPacing({ ...pacing, min: i.min, max: i.max }); else setPacing({ ...pacing, min: 20, max: 30 }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SEND_INTERVALS.map(i => <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>)}<SelectItem value="custom">Intervalo personalizado</SelectItem></SelectContent></Select>
          {!SEND_INTERVALS.some(i => i.min === pacing.min && i.max === pacing.max) && <div className="grid grid-cols-2 gap-2"><NumField label="Mínimo (s)" value={pacing.min} min={1} max={300} onChange={v => setPacing({ ...pacing, min: v })} /><NumField label="Máximo (s)" value={pacing.max} min={1} max={600} onChange={v => setPacing({ ...pacing, max: v })} /></div>}
        </PacingCard>
        <PacingCard title="Pausas">
          <Label className="text-xs">Pausar a cada</Label>
          <Select value={(PAUSE_EVERY as readonly number[]).includes(pacing.pauseEvery) ? String(pacing.pauseEvery) : "custom"} onValueChange={v => setPacing({ ...pacing, pauseEvery: v === "custom" ? 30 : Number(v) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAUSE_EVERY.map(n => <SelectItem key={n} value={String(n)}>{n} mensagens</SelectItem>)}<SelectItem value="custom">Personalizado</SelectItem></SelectContent></Select>
          {!(PAUSE_EVERY as readonly number[]).includes(pacing.pauseEvery) && <NumField label="Mensagens antes da pausa" value={pacing.pauseEvery} min={1} max={500} onChange={v => setPacing({ ...pacing, pauseEvery: v })} />}
          <Label className="text-xs">Duração da pausa</Label>
          <Select value={(PAUSE_SECONDS as readonly number[]).includes(pacing.pauseSeconds) ? String(pacing.pauseSeconds) : "custom"} onValueChange={v => setPacing({ ...pacing, pauseSeconds: v === "custom" ? 180 : Number(v) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAUSE_SECONDS.map(n => <SelectItem key={n} value={String(n)}>{formatDuration(n)}</SelectItem>)}<SelectItem value="custom">Personalizada</SelectItem></SelectContent></Select>
          {!(PAUSE_SECONDS as readonly number[]).includes(pacing.pauseSeconds) && <NumField label="Pausa (s, 30 a 1800)" value={pacing.pauseSeconds} min={30} max={1800} onChange={v => setPacing({ ...pacing, pauseSeconds: v })} />}
        </PacingCard>
        <PacingCard title="Agendamento">
          <Input type="datetime-local" value={localDate} onChange={e => { const v = e.target.value; setLocalDate(v); update({ scheduledAt: v ? zonedLocalToUtc(v, TZ) : null }); }} />
          {localDate ? <Button variant="ghost" size="sm" onClick={() => { setLocalDate(""); update({ scheduledAt: null }); }}>Enviar ao iniciar (sem data)</Button> : <p className="text-xs text-muted-foreground">Sem data: o envio começa ao clicar em Iniciar.</p>}
          <p className="text-xs text-muted-foreground">Horário de Brasília. O envio acontece enquanto a tela de campanhas estiver aberta em algum navegador.</p>
        </PacingCard>
        <p className="text-xs text-muted-foreground md:col-span-3">Intervalos e pausas controlam o ritmo da fila; não garantem evitar bloqueios nem contornam os limites do WhatsApp. Duração estimada para {counts} envio(s): {formatDuration(estimateSeconds(counts, pacing))}. Você pode pausar, retomar ou cancelar a campanha a qualquer momento.</p>
      </div>}

      {step === 2 && <MessageStep body={draft.body} onChange={body => update({ body })} kind={draft.sel.kind} sample={sample} busy={busy} templates={(data?.templates ?? []).filter(t => t.channel === "whatsapp")} onAi={brief => run(async () => { if (draft.body.trim() && !window.confirm("Substituir a mensagem atual pela sugestão da Pipeflow IA?")) return; const r = await aiDraft({ data: { brief, current: draft.body } }); update({ body: r.text }); setNotice("Mensagem preparada pela Pipeflow IA. Revise antes de iniciar."); })} />}

      {step === 3 && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
          <h3 className="font-semibold">Resumo</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <dt className="text-muted-foreground">Nome</dt><dd className="break-words">{draft.name || "—"}</dd>
            <dt className="text-muted-foreground">Tipo</dt><dd>{draft.sel.kind === "groups" ? "Grupos do WhatsApp" : "Contatos individuais"}</dd>
            <dt className="text-muted-foreground">Instância</dt><dd>{draft.instance || "—"}</dd>
            <dt className="text-muted-foreground">{draft.sel.kind === "groups" ? "Grupos" : "Destinatários"}</dt><dd>{counts} selecionado(s){validation ? ` · ${validation.eligible} elegível(is)` : ""}</dd>
            <dt className="text-muted-foreground">Intervalo</dt><dd>{pacing.min} a {pacing.max} s</dd>
            <dt className="text-muted-foreground">Pausas</dt><dd>{formatDuration(pacing.pauseSeconds)} a cada {pacing.pauseEvery} mensagens</dd>
            <dt className="text-muted-foreground">Agendamento</dt><dd>{draft.scheduledAt ? formatInZone(draft.scheduledAt, TZ) : "Ao iniciar"}</dd>
            <dt className="text-muted-foreground">Anexos</dt><dd>Nenhum</dd>
          </dl>
          <div><p className="text-muted-foreground">Mensagem</p><p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted p-2">{draft.body || "—"}</p></div>
          {blockers.flat().length > 0 && <ul className="list-disc space-y-1 pl-5 text-destructive">{blockers.flat().map(b => <li key={b}>{b}</li>)}</ul>}
        </div>
        <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
          <Button variant="outline" disabled={busy || blockers.flat().length > 0} onClick={() => void run(async () => setValidation(await validate({ data: toInput(draft) })))}><ShieldCheck className="size-4" />Conferir destinatários e canal</Button>
          {validation && <>
            {validation.ready ? <p className="font-semibold text-primary">Pronto · {validation.eligible} elegível(is)</p> : <ul className="list-disc space-y-1 pl-5 text-destructive">{validation.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
            {validation.warnings.map(w => <p key={w} className="text-xs text-muted-foreground">{w}</p>)}
            {"targets" in validation && Array.isArray(validation.targets) && (() => { const out = validation.targets.filter(t => !t.eligible); return out.length > 0 && <details><summary className="cursor-pointer">{out.length} ficam de fora (inválidos, duplicados, descadastrados ou grupos inacessíveis)</summary><ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">{out.map(t => <li key={t.key} className="break-words">{t.name || t.contact || "—"} · {t.contact || "sem número"} · <span className="text-destructive">{t.reason}</span></li>)}</ul></details>; })()}
          </>}
          <div className="rounded-md border-l-2 border-primary bg-primary/5 p-3 text-xs text-muted-foreground">Comece com quem já conhece sua empresa e aumente aos poucos. Não há número oficial de mensagens por dia: o WhatsApp avalia denúncias, bloqueios e a qualidade das conversas. Em grupos, só publique onde sua conta tem permissão; cada grupo conta como um envio.</div>
          <label className="flex items-start gap-3"><Checkbox checked={ack} onCheckedChange={v => setAck(v === true)} aria-label="Ciência das orientações de envio" /><span>{WHATSAPP_CAMPAIGN_ACK}</span></label>
          <Button className="w-full" disabled={busy || !validation?.ready || !ack} onClick={() => void start()}><Send className="size-4" />{draft.scheduledAt ? "Agendar campanha" : "Iniciar campanha"}</Button>
          {!validation && <p className="text-xs text-muted-foreground">Confira destinatários e canal antes de iniciar.</p>}
        </div>
      </div>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronLeft className="size-4" />Voltar</Button>
        <span className="flex flex-wrap items-center gap-2">{blockers[step]?.[0] && <span className="text-xs text-muted-foreground">{blockers[step][0]}</span>}<Button variant="outline" disabled={busy || draft.name.trim().length < 2} onClick={() => void run(saveDraft)}><Save className="size-4" />Salvar rascunho</Button>{step < 3 && <Button disabled={blockers[step].length > 0} onClick={() => setStep(step + 1)}>Prosseguir<ChevronRight className="size-4" /></Button>}</span>
      </div>
    </section>}
  </main></CampaignsLayout>;
}

function PacingCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-2 rounded-lg border bg-card p-4"><h3 className="text-sm font-semibold text-primary">{title}</h3>{children}</div>;
}
function NumField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label><Input type="number" min={min} max={max} value={value} onChange={e => onChange(Math.round(Number(e.target.value) || 0))} /></div>;
}
