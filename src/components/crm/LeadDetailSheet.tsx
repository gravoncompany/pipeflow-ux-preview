import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, Plus, X, Bell, ArrowLeft, CalendarClock, Pencil, BadgeCheck, UserCheck, UserPlus, Building2, Target, MapPin, MessageCircle, Mail, AtSign, Globe, ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { type Lead, type Stage, type StageId, type TagId, SOURCES } from "@/lib/crm-types";
import { LeadInteractionForm } from "./LeadInteractionForm";
import { useStages } from "@/hooks/use-stages";
import { useTags } from "@/hooks/use-tags";
import { WhatsAppChat } from "./WhatsAppChat";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { leadOrigin } from "@/lib/lead-attribution";
import { latestLeadUpdate, notificationDate, updateKind } from "@/lib/lead-notifications";
import { LeadDeskData } from "./LeadDeskData";
import { LeadPublicLookup } from "./LeadPublicLookup";
import { LeadCompanyInsight } from "./LeadCompanyInsight";
import { LeadCampaignHistory } from "./LeadCampaignHistory";
import { businessLinks } from "@/lib/business-links";
import { LeadAgentControl } from "./LeadAgentControl";
import { LeadEmailMarketing } from "./LeadEmailMarketing";
import { LeadQualificationSection } from "./LeadQualification";
import { LeadActivityTimeline } from "./LeadActivityTimeline";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead | null;
  isNew: boolean;
  onSave: (lead: Lead) => void | Promise<void>;
  onDelete?: (id: string) => void;
  pipelineId?: string | null;
  pipelineStages?: Stage[];
  pipelines?: { id: string; name: string; stages: Stage[] }[];
  /** Renders the same card as a side panel (Conversas) instead of a modal sheet. */
  inline?: boolean;
  /** Ações da etapa Fechado (só com acesso completo): valor fechado e ficha de cliente. */
  closing?: { clientId: string | null; onConfirmValue: () => void; onAddClient: () => void } | null;
};

function emptyLead(): Lead {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: crypto.randomUUID(),
    name: "",
    company: "",
    whatsapp: "",
    email: "",
    instagram: "",
    website: "",
    investedTraffic: "",
    revenue: "",
    employees: "",
    source: SOURCES[0],
    service: "",
    potentialValue: 0,
    owner: "",
    entryDate: today,
    nextAction: "",
    nextActionDate: today,
    status: "Novo",
    stage: "lead-novo",
    tags: [],
    notes: "",
    lastConversation: "",
    nextSteps: "",
    history: [],
  };
}

export function LeadDetailSheet({ open, onOpenChange, lead, isNew, onSave, onDelete, pipelineId, pipelineStages, pipelines, inline = false, closing = null }: Props) {
  const [draft, setDraft] = useState<Lead>(emptyLead());
  const latest = !isNew && lead ? latestLeadUpdate(lead) : null;
  const { stages: legacyStages } = useStages();
  const draftPipeline = pipelines?.find((p) => p.id === draft.pipelineId);
  const stages = pipelines ? (draftPipeline?.stages ?? legacyStages) : (pipelineStages ?? legacyStages);
  const initialStages = pipelineStages ?? legacyStages;
  const { tags: allTags, addTag, removeTag, palette } = useTags();
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [newTagColor, setNewTagColor] = useState(palette[0]);
  const sourceOptions = Array.from(new Set([...SOURCES, draft.source, draft.utmSource].filter((s): s is string => Boolean(s))));

  useEffect(() => {
    if (open) {
      setDraft(lead ? { ...lead, ...businessLinks(lead.website, lead.instagram) } : { ...emptyLead(), pipelineId: pipelineId ?? null, stage: initialStages[0]?.id ?? "lead-novo" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead, pipelineId]);

  const changePipeline = (id: string) => {
    const next = id === "__main__" ? null : id;
    const nextStages = next ? pipelines?.find((p) => p.id === next)?.stages ?? [] : legacyStages;
    setDraft((d) => ({ ...d, pipelineId: next, stage: nextStages.some((s) => s.id === d.stage) ? d.stage : (nextStages[0]?.id ?? d.stage) }));
  };

  const update = <K extends keyof Lead>(k: K, v: Lead[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const toggleTag = (id: TagId) => {
    setDraft((d) => ({
      ...d,
      tags: d.tags.includes(id) ? d.tags.filter((t) => t !== id) : [...d.tags, id],
    }));
  };

  const handleSave = () => {
    if (!draft.name.trim()) return;
    onSave(draft);
    onOpenChange(false);
  };

  // Resumo → "Próximo passo": saves only the next action on top of the stored card, keeping the panel open.
  const [savingNext, setSavingNext] = useState(false);
  const saveNextStep = async () => {
    if (!lead || isNew || savingNext) return;
    setSavingNext(true);
    try {
      await Promise.resolve(onSave({ ...lead, history: draft.history, nextAction: draft.nextAction.trim(), nextActionDate: draft.nextActionDate }));
      toast.success("Próximo passo salvo");
    } catch { /* the save hook already shows the error */ }
    finally { setSavingNext(false); }
  };
  const nextChanged = !!lead && (draft.nextAction.trim() !== (lead.nextAction ?? "").trim() || draft.nextActionDate !== lead.nextActionDate);

  const [tab, setTab] = useState(isNew ? "data" : "summary");
  const [editing, setEditing] = useState(isNew);
  const [activity, setActivity] = useState<"timeline" | "notes" | "whatsapp" | "email">("timeline");
  // Every card opens on Resumo (new leads go straight to the form).
  useEffect(() => { if (open) { setTab(isNew ? "data" : "summary"); setEditing(isNew); setActivity("timeline"); } }, [open, lead?.id, isNew]);

  const stageTitle = stages.find((s) => s.id === draft.stage)?.title ?? draft.stage;
  const funnelName = draft.pipelineId ? (pipelines?.find((p) => p.id === draft.pipelineId)?.name ?? "Funil") : "Funil principal";
  const tagLabels = allTags.filter((t) => draft.tags.includes(t.id));

  const title = isNew ? "Novo Lead" : draft.name || "Editar Lead";
  const editForm = (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome"><Input value={draft.name} onChange={(e) => update("name", e.target.value)} /></Field>
        <Field label="Empresa"><Input value={draft.company} onChange={(e) => update("company", e.target.value)} /></Field>
        <Field label="WhatsApp"><Input value={draft.whatsapp} onChange={(e) => update("whatsapp", e.target.value)} /></Field>
        <Field label="E-mail"><Input type="email" value={draft.email} onChange={(e) => update("email", e.target.value)} /></Field>
        <Field label="Instagram"><Input placeholder="@usuario" value={draft.instagram} onChange={(e) => update("instagram", e.target.value)} /></Field>
        <Field label="Site"><Input placeholder="https://..." value={draft.website} onChange={(e) => update("website", e.target.value)} /></Field>
        <Field label="Já investiu em tráfego?">
          <Select value={draft.investedTraffic || "—"} onValueChange={(v) => update("investedTraffic", v === "—" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="—">—</SelectItem><SelectItem value="Sim">Sim</SelectItem><SelectItem value="Não">Não</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Faturamento"><Input placeholder="Ex: R$ 50.000/mês" value={draft.revenue} onChange={(e) => update("revenue", e.target.value)} /></Field>
        <Field label="Nº de funcionários"><Input placeholder="Ex: 10-50" value={draft.employees} onChange={(e) => update("employees", e.target.value)} /></Field>
        <Field label="Origem">
          <Select value={draft.source} onValueChange={(v) => update("source", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{sourceOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Serviço de interesse"><Input value={draft.service} onChange={(e) => update("service", e.target.value)} /></Field>
        <Field label="Valor potencial (R$)"><Input type="number" value={draft.potentialValue} onChange={(e) => update("potentialValue", Number(e.target.value) || 0)} /></Field>
        <Field label="Data de entrada"><Input type="date" value={draft.entryDate} onChange={(e) => update("entryDate", e.target.value)} /></Field>
        <Field label="Status"><Input value={draft.status} onChange={(e) => update("status", e.target.value)} /></Field>
        <Field label="Próxima ação"><Input value={draft.nextAction} onChange={(e) => update("nextAction", e.target.value)} /></Field>
        <Field label="Data próxima ação"><Input type="date" value={draft.nextActionDate} onChange={(e) => update("nextActionDate", e.target.value)} /></Field>
        {pipelines && pipelines.length > 0 && (
          <Field label="Funil" full>
            <Select value={draft.pipelineId ?? "__main__"} onValueChange={changePipeline}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__main__">Funil principal</SelectItem>
                {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="Etapa" full>
          <Select value={draft.stage} onValueChange={(v) => update("stage", v as StageId)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <section className="space-y-2 border-t pt-4" aria-label="Etiquetas">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Etiquetas</h3>
          <Button size="sm" variant="outline" onClick={() => { setNewTagLabel(""); setNewTagColor(palette[0]); setNewTagOpen(true); }}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Nova etiqueta
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {allTags.map((t) => {
            const active = draft.tags.includes(t.id);
            return (
              <div key={t.id} className="group relative">
                <button
                  onClick={() => toggleTag(t.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium text-white transition-all ${active ? "ring-2 ring-offset-2 ring-offset-background" : "opacity-60 hover:opacity-100"}`}
                  style={{ backgroundColor: t.color, ...(active ? { boxShadow: `0 0 0 2px ${t.color}` } : {}) }}
                >{t.label}</button>
                <button
                  onClick={() => { removeTag(t.id); if (draft.tags.includes(t.id)) update("tags", draft.tags.filter((x) => x !== t.id)); }}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-destructive group-hover:flex"
                  title="Excluir etiqueta"
                ><X className="h-3 w-3" /></button>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );

  const readOnlyData = (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {([["Nome", draft.name], ["Empresa", draft.company], ["WhatsApp", draft.whatsapp], ["E-mail", draft.email], ["Instagram", draft.instagram], ["Site", draft.website],
          ["Já investiu em tráfego?", draft.investedTraffic], ["Faturamento", draft.revenue], ["Nº de funcionários", draft.employees], ["Origem", leadOrigin(draft)],
          ["Serviço de interesse", draft.service], ["Valor potencial", draft.potentialValue ? draft.potentialValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : ""],
          ["Data de entrada", fmtDate(draft.entryDate)], ["Status", draft.status], ["Funil", funnelName], ["Etapa", stageTitle]] as const).map(([label, value]) => (
          <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words font-medium">{value || "—"}</dd></div>
        ))}
      </dl>
      <section className="border-t pt-4" aria-label="Etiquetas do lead">
        <h3 className="mb-2 text-sm font-semibold">Etiquetas</h3>
        {tagLabels.length ? <div className="flex flex-wrap gap-2">{tagLabels.map((t) => <span key={t.id} className="rounded-full px-3 py-1 text-xs font-medium text-white" style={{ backgroundColor: t.color }}>{t.label}</span>)}</div> : <p className="text-sm text-muted-foreground">Nenhuma etiqueta.</p>}
      </section>
    </>
  );

  const body = (
      <>
        {/* Cabeçalho do card: identidade, etapa, valor e ações rápidas num só lugar (sem repetir dados nas abas). */}
        <div className={`relative overflow-hidden border-b ${inline ? "lg:pr-20" : ""}`}>
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.09] via-card to-card" aria-hidden />
          <div className="absolute -right-16 -top-20 size-56 rounded-full bg-primary/10 blur-3xl" aria-hidden />
          <div className="relative space-y-4 p-5">
            <div className="flex items-start gap-3.5">
              <span className="btn-brand flex size-12 shrink-0 items-center justify-center rounded-2xl text-base font-semibold text-primary-foreground shadow-[0_8px_20px_-8px_var(--brand-glow)]" aria-hidden>{initials(draft.name || "Novo")}</span>
              <div className="min-w-0 flex-1">
                {inline
                  ? <h2 className="truncate text-xl font-semibold tracking-tight">{title}</h2>
                  : <SheetHeader className="min-w-0 space-y-0 p-0 text-left"><SheetTitle className="truncate pr-8 text-xl tracking-tight">{title}</SheetTitle></SheetHeader>}
                {!isNew && <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">{draft.company ? <><Building2 className="size-3.5 shrink-0" />{draft.company}</> : "Sem empresa"}{draft.owner && <span className="hidden sm:inline">· {draft.owner}</span>}</p>}
              </div>
              {inline
                ? <Button variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label="Fechar card" title="Fechar card" onClick={() => onOpenChange(false)}><X /></Button>
                : <Button variant="outline" size="sm" className="mr-8 sm:hidden" onClick={() => onOpenChange(false)}><ArrowLeft />Voltar</Button>}
            </div>
            {!isNew && <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-background/80 px-2.5 py-1 text-xs font-semibold tabular-nums shadow-sm"><span className="font-normal text-muted-foreground">{lead?.stage === "fechado" && lead.closedValue != null ? "Fechado" : "Potencial"}</span><span className="text-gradient-brand">{brl(lead?.stage === "fechado" && lead.closedValue != null ? lead.closedValue : draft.potentialValue)}</span></span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm"><Target className="size-3" />{stageTitle}</span>
                <span className="rounded-full border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">{funnelName}</span>
                <span className="inline-flex items-center gap-1 rounded-full border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground"><MapPin className="size-3" />{leadOrigin(draft)}</span>
                {tagLabels.map((t) => <span key={t.id} className="rounded-full px-2.5 py-1 text-xs font-medium text-white shadow-sm" style={{ backgroundColor: t.color }}>{t.label}</span>)}
              </div>
              <StageTrack stages={stages} current={draft.stage} onPick={(id) => { update("stage", id as StageId); if (id !== lead?.stage) toast.info("Etapa alterada no card — clique em Salvar alterações para aplicar."); }} />
              <div className="flex flex-wrap gap-2">
                {waHref(draft.whatsapp) && <QuickAction href={waHref(draft.whatsapp)!} icon={<MessageCircle />} label="WhatsApp" />}
                {draft.email && <QuickAction href={`mailto:${draft.email}`} icon={<Mail />} label="E-mail" />}
                {draft.instagram && <QuickAction href={igHref(draft.instagram)} icon={<AtSign />} label="Instagram" />}
                {draft.website && <QuickAction href={/^https?:/i.test(draft.website) ? draft.website : `https://${draft.website}`} icon={<Globe />} label="Site" />}
                <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => { setTab("activity"); setActivity("timeline"); }}><Plus />Registrar interação</Button>
              </div>
            </>}
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="p-5">
          {!isNew && <TabsList className="relative grid h-auto w-full grid-cols-3 p-1">
            {([["summary", "Visão geral"], ["activity", "Atividade"], ["data", "Dados e consultas"]] as const).map(([v, l]) => (
              <TabsTrigger key={v} value={v} className="relative py-1.5 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                {tab === v && <motion.span layoutId={`lead-tab-${draft.id}`} className="absolute inset-0 rounded-lg bg-background shadow-[0_1px_3px_rgb(0_0_0/0.08),0_0_0_1px_color-mix(in_oklab,var(--primary)_14%,transparent)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} aria-hidden />}
                <span className="relative">{l}</span>
              </TabsTrigger>
            ))}
          </TabsList>}

          {!isNew && lead && <TabsContent value="summary" className="mt-4 space-y-4">
            {lead.stage === "fechado" && closing && <section className="space-y-2 rounded-xl border border-success/30 bg-success/5 p-4" aria-label="Negócio fechado">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-xs text-muted-foreground">Valor fechado</p>
                  <p className="text-base font-semibold">{lead.closedValue !== null && lead.closedValue !== undefined ? lead.closedValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : <span className="text-sm font-medium text-muted-foreground">A confirmar · potencial {lead.potentialValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>}</p></div>
                <Button size="sm" variant="outline" onClick={closing.onConfirmValue}><BadgeCheck />{lead.closedValue !== null && lead.closedValue !== undefined ? "Editar valor" : "Confirmar valor fechado"}</Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <p className="text-xs text-muted-foreground">{closing.clientId ? "Este lead já tem ficha de cliente." : "Cadastre a empresa em Clientes com os dados deste card."}</p>
                {closing.clientId
                  ? <Button size="sm" asChild><Link to="/clientes/$id" params={{ id: closing.clientId }}><UserCheck />Abrir ficha do cliente</Link></Button>
                  : <Button size="sm" onClick={closing.onAddClient}><UserPlus />Adicionar como cliente</Button>}
              </div>
              <p className="text-[11px] text-muted-foreground">O recebimento continua sendo registrado no Financeiro.</p>
            </section>}
            <section className="space-y-3 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] to-transparent p-4 shadow-[0_6px_20px_-12px_var(--brand-glow)]" aria-label="Próximo passo">
              <div className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4 text-primary" />Próximo passo
                {lead.nextActionDate && <span className={`ml-auto text-xs font-normal ${dueClass(lead.nextActionDate)}`}>{dueLabel(lead.nextActionDate)}</span>}</div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input aria-label="Próxima ação" placeholder="Ex: Ligar para apresentar a proposta" value={draft.nextAction} onChange={(e) => update("nextAction", e.target.value)} />
                <Input aria-label="Data da próxima ação" type="date" className="sm:w-44" value={draft.nextActionDate} onChange={(e) => update("nextActionDate", e.target.value)} />
              </div>
              <div className="flex justify-end"><Button size="sm" disabled={!nextChanged || savingNext} onClick={() => void saveNextStep()}>{savingNext ? "Salvando…" : "Salvar próximo passo"}</Button></div>
            </section>
            {latest && <section className="rounded-md border p-3" aria-label="Última atualização do lead"><div className="flex items-center gap-2 text-xs font-semibold text-primary"><Bell className="size-4 shrink-0" />{updateKind(latest)} · última atualização</div><p className="mt-2 break-words text-sm">{latest.text}</p><p className="mt-2 text-xs text-muted-foreground">{notificationDate(latest.date)}</p></section>}
            <dl className="surface grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-3" aria-label="Informações do lead">
              {([["Serviço de interesse", lead.service], ["Faturamento", lead.revenue], ["Funcionários", lead.employees], ["Já investiu em tráfego?", lead.investedTraffic], ["Data de entrada", fmtDate(lead.entryDate)], ["Status", lead.status]] as [string, string | undefined][]).map(([label, value]) => (
                <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 truncate font-medium" title={value || undefined}>{value?.trim() || "—"}</dd></div>
              ))}
            </dl>
            <LeadAgentControl phone={lead.whatsapp} />
            <LeadQualificationSection leadId={lead.id} />
          </TabsContent>}

          {!isNew && lead && <TabsContent value="activity" className="mt-4 space-y-4">
            <div className="flex gap-1 overflow-x-auto rounded-full border bg-muted/50 p-1 [scrollbar-width:thin]" role="tablist" aria-label="Tipo de atividade">
              {([["timeline", "Linha do tempo"], ["notes", "Anotações"], ["whatsapp", "WhatsApp"], ["email", "E-mail"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={activity === id} onClick={() => setActivity(id)}
                  className={`relative h-8 shrink-0 rounded-full px-3.5 text-xs font-medium transition-colors ${activity === id ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {activity === id && <motion.span layoutId={`lead-activity-${draft.id}`} className="btn-brand absolute inset-0 rounded-full shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 40 }} aria-hidden />}
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
            {activity === "timeline" && <>
              <details className="group surface rounded-xl border bg-card p-3 open:ring-1 open:ring-primary/20">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Plus className="size-4 text-primary" />Registrar interação</summary>
                <div className="mt-3"><LeadInteractionForm key={draft.id} leadId={draft.id} isNew={isNew} onSaved={history => setDraft(d => ({ ...d, history }))} /></div>
              </details>
              <LeadActivityTimeline lead={lead} history={draft.history} notes={draft.notes} onRemoveHistory={(id) => update("history", draft.history.filter((x) => x.id !== id))} />
              <LeadCampaignHistory key={lead.id} leadId={lead.id} />
            </>}
            {activity === "notes" && <div className="space-y-4">
              <Field label="Anotações internas"><Textarea rows={5} value={draft.notes} onChange={(e) => update("notes", e.target.value)} /></Field>
              <Field label="Última conversa"><Textarea rows={3} value={draft.lastConversation} onChange={(e) => update("lastConversation", e.target.value)} /></Field>
              <Field label="Próximos passos"><Textarea rows={3} value={draft.nextSteps} onChange={(e) => update("nextSteps", e.target.value)} /></Field>
              <p className="text-xs text-muted-foreground">Use “Salvar alterações” para gravar as anotações.</p>
            </div>}
            {activity === "whatsapp" && <WhatsAppChat phone={draft.whatsapp} />}
            {activity === "email" && <LeadEmailMarketing key={lead.id} leadId={lead.id} />}
          </TabsContent>}

          <TabsContent value="data" className="mt-4 space-y-4">
            {!isNew && <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{editing ? "Editando os dados do lead." : "Cadastro, etiquetas e consultas."}</p>
              {!editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil />Editar</Button>}
            </div>}
            <Group title="Cadastro e etiquetas" defaultOpen>{editing ? editForm : readOnlyData}</Group>
            {[draft.utmSource, draft.utmMedium, draft.utmCampaign, draft.utmContent, draft.utmTerm].some(Boolean) && (
              <Group title="Origem da campanha">
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  {[["Origem (utm_source)", draft.utmSource], ["Mídia (utm_medium)", draft.utmMedium], ["Campanha (utm_campaign)", draft.utmCampaign], ["Anúncio (utm_content)", draft.utmContent], ["Termo (utm_term)", draft.utmTerm]].map(([label, value]) => (
                    <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value || "—"}</dd></div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">Origem rastreada: {leadOrigin(draft)}</p>
              </Group>
            )}
            {!isNew && lead && <Group title="Consultas e enriquecimento (dados públicos, empresa, DeskData)">
              <LeadPublicLookup key={`public-${lead.id}`} leadId={lead.id} onApplied={(fields, entry) => setDraft((d) => ({ ...d, ...fields, history: entry && !d.history.some((h) => h.id === entry.id) ? [entry as Lead["history"][number], ...d.history] : d.history }))} />
              <LeadCompanyInsight key={`insight-${lead.id}`} leadId={lead.id} />
              <LeadDeskData key={lead.id} leadId={lead.id} />
            </Group>}
          </TabsContent>
        </Tabs>

        <Dialog open={newTagOpen} onOpenChange={setNewTagOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova etiqueta</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Field label="Nome">
                <Input autoFocus value={newTagLabel} onChange={(e) => setNewTagLabel(e.target.value)} placeholder="Ex: VIP"
                  onKeyDown={(e) => { if (e.key === "Enter" && newTagLabel.trim()) { addTag(newTagLabel, newTagColor); setNewTagOpen(false); } }} />
              </Field>
              <Field label="Cor">
                <div className="flex flex-wrap gap-2">
                  {palette.map((c) => <button key={c} onClick={() => setNewTagColor(c)} className={`h-7 w-7 rounded-full border-2 transition ${newTagColor === c ? "border-foreground" : "border-transparent"}`} style={{ backgroundColor: c }} />)}
                </div>
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewTagOpen(false)}>Cancelar</Button>
              <Button onClick={() => { if (!newTagLabel.trim()) return; addTag(newTagLabel, newTagColor); setNewTagOpen(false); }}>Criar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className={`glass sticky bottom-0 mt-auto flex items-center justify-between gap-2 border-t p-4 ${inline ? "pr-24" : ""}`}>
          {!isNew && onDelete ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { onDelete(draft.id); onOpenChange(false); }}>
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{inline ? "Fechar card" : "Cancelar"}</Button>
            <Button onClick={handleSave}>Salvar alterações</Button>
          </div>
        </div>
      </>
  );
  if (inline) return open ? <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">{body}</div> : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-dvh max-h-dvh w-full flex-col overflow-y-auto overscroll-contain p-0 sm:max-w-[min(760px,100vw)]">
        {body}
      </SheetContent>
    </Sheet>
  );
}

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?"; }
function brl(n: number | null | undefined) { return (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }); }
function waHref(v: string) { const n = (v ?? "").replace(/\D/g, ""); return n.length >= 10 ? `https://wa.me/${n.length <= 11 ? `55${n}` : n}` : null; }
function igHref(v: string) { const t = v.trim(); if (/^https?:/i.test(t)) return t; const h = t.replace(/^@/, "").replace(/^(www\.)?instagram\.com\//i, "").split(/[/?#]/)[0]; return `https://instagram.com/${h}`; }

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a href={href} target={href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer"
      className="group inline-flex h-8 items-center gap-1.5 rounded-full border bg-background/80 px-3 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-px hover:border-primary/40 hover:text-primary hover:shadow-md [&_svg]:size-3.5 [&_svg]:transition-transform group-hover:[&_svg]:scale-110">
      {icon}{label}
    </a>
  );
}

/** Barra de etapas do funil: mostra o progresso e permite escolher a etapa (aplicada ao salvar). */
function StageTrack({ stages, current, onPick }: { stages: Stage[]; current: string; onPick: (id: string) => void }) {
  const flow = stages.filter((s) => s.id !== "perda");
  const idx = Math.max(0, flow.findIndex((s) => s.id === current));
  const lost = current === "perda";
  return (
    <div aria-label="Etapas do funil">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Etapa {lost ? "—" : idx + 1} de {flow.length}</span>
        {lost && <span className="font-medium text-destructive">Marcado como perda</span>}
      </div>
      <div className="flex gap-1">
        {flow.map((st, i) => (
          <button key={st.id} type="button" title={st.title} aria-label={`Mover para ${st.title}`} aria-current={st.id === current ? "step" : undefined} onClick={() => onPick(st.id)}
            className={`group relative h-2 flex-1 rounded-full transition-all duration-300 hover:h-3 hover:-translate-y-px ${lost ? "bg-destructive/25" : i <= idx ? "btn-brand" : "bg-muted hover:bg-primary/30"} ${st.id === current ? "ring-2 ring-primary/30 ring-offset-1 ring-offset-card" : ""}`}>
            <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-1.5 py-0.5 text-[10px] text-background group-hover:block">{st.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Grupo recolhível usado na aba Dados e consultas. */
function Group({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group/grp surface rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {title}<ChevronDown className="size-4 text-muted-foreground transition-transform duration-300 group-open/grp:rotate-180" />
      </summary>
      <div className="space-y-4 border-t px-4 py-4">{children}</div>
    </details>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

const spToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
function fmtDate(d: string | null | undefined) { return d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : ""; }
function dueLabel(d: string) { const day = d.slice(0, 10), today = spToday(); return day === today ? "Hoje" : day < today ? `Atrasado · ${fmtDate(day)}` : fmtDate(day); }
function dueClass(d: string) { const day = d.slice(0, 10), today = spToday(); return day < today ? "text-destructive" : day === today ? "text-primary font-medium" : "text-muted-foreground"; }
