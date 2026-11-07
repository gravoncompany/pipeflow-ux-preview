import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus, Search, TrendingUp, Users, CheckCircle2, Zap, Link as LinkIcon, LayoutGrid, List, LogOut, Columns3, RefreshCw, Mail, MessageCircle, X, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Link } from "@tanstack/react-router";
import { CrmSidebar } from "@/components/crm/CrmSidebar";
import { toast } from "sonner";
import { useLeads } from "@/hooks/use-leads";
import { useStages } from "@/hooks/use-stages";
import { type Lead, type StageId, SOURCES } from "@/lib/crm-types";
import { useTags } from "@/hooks/use-tags";
import { useOutboundAutoTags } from "@/hooks/use-outbound-auto-tags";
import { AUTO_TAGS } from "@/lib/outbound-auto-tags";
import { KanbanColumn } from "./KanbanColumn";
import { LeadDetailSheet } from "./LeadDetailSheet";
import { LeadListView } from "./LeadListView";
import { CrmAuthGate, getStoredAccess, clearStoredAccess, type CrmAccess } from "./CrmAuthGate";
import { leadOrigin } from "@/lib/lead-attribution";
import { usePipelines } from "@/hooks/use-pipelines";
import { MAIN_PIPELINE, filterPipelineLeads, freshPipelineStages } from "@/lib/pipelines";
import { PipelineSelector } from "./PipelineSelector";
import { FunnelAnalysis } from "./FunnelAnalysis";
import { SaleCloseDialog } from "./SaleClassificationDialog";
import { BulkMoveDialog } from "./BulkMoveDialog";
import { StartCadenceDialog } from "./StartCadenceDialog";
import { CrmNotifications } from "./CrmNotifications";
import { copyText } from "@/lib/clipboard";
import { collectEmails, gmailList, selectMany, selectedExistingIds } from "@/lib/bulk-actions";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardToday } from "@/lib/dashboard.functions";
import { pendingIdsFor, type PendingFilter } from "@/lib/pipeline-pending";
import { Clock, CalendarCheck, AlertTriangle, BadgeCheck, UserPlus } from "lucide-react";
import { pipelineTotals } from "@/lib/pipeline-totals";
import { ClosedValueDialog } from "./ClosedValueDialog";
import { AddClientsDialog } from "./AddClientsDialog";
import { listLeadClientLinks } from "@/lib/crm-clients.functions";
import { lastEmailClick } from '@/lib/outbound-clicks';

const currency = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// "5.000", "5000", "R$ 5.000,00" → mesma chave "5000"
const revenueKey = (v: string) => {
  const digits = (v || "").replace(/[^\d]/g, "");
  return digits.replace(/^0+/, "") || digits;
};

export function CrmBoard({ openLeadId, onLeadOpened, analysisView = false, onAnalysisViewChange }: { openLeadId?: string; onLeadOpened?: () => void; analysisView?: boolean; onAnalysisViewChange?: (v: boolean) => void } = {}) {
  const [access, setAccess] = useState<CrmAccess | null>(null);
  useEffect(() => { setAccess(getStoredAccess()); }, []);
  const { leads: allLeads, refetch, upsertLead, updateStage, deleteLead, deleteLeads, zapierUrl, saveZapierUrl } = useLeads();
  const { pipelines, selected, select, persist, loading: pipelinesLoading } = usePipelines(access?.level === "full");
  const currentPipeline = pipelines.find((p) => p.id === selected);
  const allLeadsRef = useRef(allLeads);
  allLeadsRef.current = allLeads;
  const leads = useMemo(() => filterPipelineLeads(allLeads, selected), [allLeads, selected]);
  const [refreshing, setRefreshing] = useState(false);
  const legacy = useStages();
  const stages = currentPipeline?.stages ?? legacy.stages;
  const saveStages = async (next: typeof stages) => {
    if (!currentPipeline) return;
    await persist({ ...currentPipeline, stages: next });
  };
  const addStage = (title: string) => {
    if (!currentPipeline) return legacy.addStage(title);
    void saveStages([...stages, { id: `stage-${crypto.randomUUID()}`, title: title.trim() }]);
  };
  const removeStage = (id: string) => {
    if (stages.length <= 1) { toast.error("O funil precisa de pelo menos uma coluna."); return; }
    if (!currentPipeline) return legacy.removeStage(id);
    void saveStages(stages.filter((s) => s.id !== id));
  };
  const moveStage = (id: string, dir: -1 | 1) => {
    if (!currentPipeline) return legacy.moveStage(id, dir);
    const index = stages.findIndex((s) => s.id === id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    void saveStages(next);
  };
  const { tags: tagOptions } = useTags();
  const autoTags = useOutboundAutoTags();
  const isOutbound = currentPipeline?.name.trim().toLowerCase() === "outbound";
  useEffect(() => { if (!isOutbound && tagFilter.startsWith("auto:")) setTagFilter("all"); }, [isOutbound]); // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState("");
  const [zapOpen, setZapOpen] = useState(false);
  const [zapDraft, setZapDraft] = useState("");
  useEffect(() => { setZapDraft(zapierUrl); }, [zapierUrl]);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [revenueFilter, setRevenueFilter] = useState<string>("all");
  const [clickSort, setClickSort] = useState('default');

  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [closeLead, setCloseLead] = useState<Lead | null>(null);
  // Fechado: primeiro confirma o valor fechado (sugere o potencial), depois a classificação de venda existente.
  const [valueLead, setValueLead] = useState<{ lead: Lead; thenClassify: boolean } | null>(null);
  const [clientLeads, setClientLeads] = useState<Lead[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  // Atalhos de pendências: mesmos critérios do bloco "Hoje" do Dashboard, aplicados ao funil aberto.
  const [pending, setPending] = useState<PendingFilter | null>(null);
  const loadToday = useServerFn(getDashboardToday);
  const todayQ = useQuery({ queryKey: ["dashboard-today"], queryFn: () => loadToday(), enabled: access?.level === "full", retry: false, staleTime: 60_000 });
  const todayData = todayQ.data && !todayQ.data.needsAuth ? todayQ.data.data : null;
  const loadLinks = useServerFn(listLeadClientLinks);
  const linksQ = useQuery({ queryKey: ["lead-client-links"], queryFn: () => loadLinks(), enabled: access?.level === "full", retry: false, staleTime: 30_000 });
  const clientLinks = useMemo(() => new Map((linksQ.data?.links ?? []).map((l) => [l.leadId, l.clientId])), [linksQ.data]);
  const pendingIds = useMemo(() => pendingIdsFor(todayData, leads.map((l) => l.id)), [todayData, leads]);
  useEffect(() => { setPending(null); }, [selected]);
  const [wide, setWide] = useState(false);
  useEffect(() => { const mq = window.matchMedia("(min-width: 1024px)"); const on = () => setWide(mq.matches); on(); mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }, []);
  const [campaignSelection,setCampaignSelection]=useState<string[]>([]);
  function selectCampaign(ids:string[],checked:boolean){setCampaignSelection(old=>checked?[...new Set([...old,...ids])]:old.filter(id=>!ids.includes(id)));}
  const [bulkMoveOpen,setBulkMoveOpen]=useState(false);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  async function confirmBulkDelete() {
    if (!bulkDeleteIds?.length || bulkDeleting || access?.level !== "full") return;
    setBulkDeleting(true);
    try {
      if (!await deleteLeads(bulkDeleteIds)) return;
      setCampaignSelection(old => old.filter(id => !bulkDeleteIds.includes(id)));
      if (activeLead && bulkDeleteIds.includes(activeLead.id)) { setSheetOpen(false); setActiveLead(null); }
      toast.success(`${bulkDeleteIds.length} card(s) excluído(s)`);
      setBulkDeleteIds(null);
    } finally { setBulkDeleting(false); }
  }
  const [cadenceOpen,setCadenceOpen]=useState(false);
  // Seleção pertence ao funil exibido: trocar de funil limpa a seleção para não misturar cards.
  useEffect(()=>{setCampaignSelection([]);setBulkDeleteIds(null);},[selected]);
  async function copySelectedEmails(){const {emails}=collectEmails(leads.filter(l=>campaignSelection.includes(l.id)).map(l=>l.email));if(!emails.length){toast.info('Nenhum e-mail válido nos cards selecionados.');return;}if(await copyText(gmailList(emails)))toast.success(`${emails.length} e-mail(s) copiado(s) com sucesso. Cole no campo Cco do Gmail.`);else toast.error('Não foi possível acessar a área de transferência.');}
  function openCampaign(channel:"email"|"whatsapp"){sessionStorage.setItem("pipeflow-campaign-selection",JSON.stringify({channel,leadIds:campaignSelection}));window.location.href=channel==="whatsapp"?"/campanhas/whatsapp":"/campanhas";}
  const [newColOpen, setNewColOpen] = useState(false);
  const [newColName, setNewColName] = useState("");
  const sourceOptions = useMemo(() => Array.from(new Set([...SOURCES, ...leads.map(leadOrigin)])), [leads]);

  const visibleStages = useMemo(
    () => (access?.allowedStages === "all" ? stages : stages.filter((s) => access?.allowedStages.includes(s.id))),
    [access, stages],
  );
  const allowedStageIds = useMemo(
    () => new Set(visibleStages.map((s) => s.id)),
    [visibleStages],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));


  const periodStart = useMemo(() => {
    if (periodFilter === "all") return null;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (periodFilter === "today") return d;
    if (periodFilter === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
    const days = Number(periodFilter);
    if (!Number.isFinite(days)) return null;
    d.setDate(d.getDate() - (days - 1));
    return d;
  }, [periodFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = leads.filter((l) => {
      if (!allowedStageIds.has(l.stage)) return false;
      if (pending && !pendingIds[pending].has(l.id)) return false;
      if (sourceFilter !== "all" && leadOrigin(l) !== sourceFilter) return false;
      if (tagFilter.startsWith("auto:")) { if (!(autoTags[l.id] ?? []).includes(tagFilter)) return false; }
      else if (tagFilter !== "all" && !l.tags.includes(tagFilter as never)) return false;
      if (revenueFilter === "has" && !l.revenue.trim()) return false;
      if (revenueFilter === "none" && l.revenue.trim()) return false;
      if (
        revenueFilter !== "all" &&
        revenueFilter !== "has" &&
        revenueFilter !== "none" &&
        revenueKey(l.revenue) !== revenueFilter
      )
        return false;
      if (periodStart) {
        const raw = l.entryDate;
        if (!raw) return false;
        const dt = new Date(`${raw.slice(0, 10)}T00:00:00`);
        if (isNaN(dt.getTime()) || dt < periodStart) return false;
      }
      if (q) {
        const hay = `${l.name} ${l.company} ${l.email} ${l.whatsapp}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return isOutbound && clickSort === 'latest-click' ? result.sort((a, b) => lastEmailClick(b) - lastEmailClick(a)) : result;
  }, [leads, search, sourceFilter, tagFilter, autoTags, allowedStageIds, periodStart, revenueFilter, pending, pendingIds, isOutbound, clickSort]);

  const revenueOptions = useMemo(() => {
    const map = new Map<string, string>();
    leads.forEach((l) => {
      const raw = (l.revenue || "").trim();
      if (!raw) return;
      const key = revenueKey(raw);
      if (!key) return;
      if (!map.has(key)) map.set(key, raw);
    });
    return Array.from(map.entries()).sort((a, b) => Number(b[0]) - Number(a[0]));
  }, [leads]);


  const byStage = useMemo(() => {
    const map: Record<StageId, Lead[]> = {} as Record<StageId, Lead[]>;
    visibleStages.forEach((s) => (map[s.id] = []));
    filtered.forEach((l) => map[l.stage]?.push(l));
    return map;
  }, [filtered, visibleStages]);

  // Indicadores do topo seguem o funil e todos os filtros/atalhos aplicados na tela.
  const totals = useMemo(() => pipelineTotals(filtered), [filtered]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || !allowedStageIds.has(String(over.id))) return;
    const target = over.id as StageId;
    const lead = allLeads.find((l) => l.id === String(active.id));
    const moving = updateStage(String(active.id), target);
    if (target === "fechado" && lead && lead.stage !== "fechado" && access?.level === "full") {
      // Abre a confirmação depois que a mudança de etapa foi gravada.
      void moving.then(() => setValueLead({ lead: { ...lead, stage: "fechado" }, thenClassify: true }));
    }
  };

  const openNew = () => {
    setActiveLead(null);
    setIsNew(true);
    setSheetOpen(true);
  };

  const openLead = (lead: Lead) => {
    setActiveLead(lead);
    setIsNew(false);
    setSheetOpen(true);
  };

  // Atalhos (Dashboard → Hoje) abrem o card certo: seleciona o funil do lead e abre a ficha uma única vez.
  const [pendingOpen, setPendingOpen] = useState(openLeadId ?? "");
  useEffect(() => { if (openLeadId) setPendingOpen(openLeadId); }, [openLeadId]);
  useEffect(() => {
    if (!pendingOpen || !access || pipelinesLoading) return;
    const lead = allLeads.find((l) => l.id === pendingOpen);
    if (!lead) return;
    if (access.level === "full") select(lead.pipelineId ?? MAIN_PIPELINE);
    setActiveLead(lead); setIsNew(false); setSheetOpen(true);
    setPendingOpen(""); onLeadOpened?.();
  }, [pendingOpen, access, pipelinesLoading, allLeads]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLead = async (lead: Lead) => {
    const wasClosed = !isNew && activeLead?.stage === "fechado";
    await upsertLead(isNew ? { ...lead, pipelineId: selected === MAIN_PIPELINE ? null : selected } : lead, { isNew });
    if (lead.stage === "fechado" && !wasClosed && access?.level === "full") {
      setValueLead({ lead, thenClassify: true });
    }
  };
  const finishClosedValue = async (saved: boolean) => {
    const current = valueLead;
    setValueLead(null);
    if (saved) {
      await refetch();
      if (current && activeLead?.id === current.lead.id) {
        const fresh = allLeadsRef.current.find((l) => l.id === current.lead.id);
        if (fresh) setActiveLead(fresh);
      }
    }
    if (current?.thenClassify) setCloseLead(current.lead);
  };
  const closingFor = (lead: Lead | null) => access?.level === "full" && lead && lead.stage === "fechado" ? {
    clientId: clientLinks.get(lead.id) ?? null,
    onConfirmValue: () => setValueLead({ lead, thenClassify: false }),
    onAddClient: () => setClientLeads([lead]),
  } : null;
  const selectedClosed = leads.filter((l) => campaignSelection.includes(l.id) && l.stage === "fechado");

  if (!access) {
    return <CrmAuthGate onUnlock={setAccess} />;
  }

  const logout = () => {
    clearStoredAccess();
    setAccess(null);
  };

  return (
    <div className="flex h-screen bg-background">
    <CrmSidebar onLogout={logout} />
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Abas do CRM: Kanban (padrão) e Análise de Funis, usando o mesmo funil selecionado. */}
      <div className="flex items-center gap-1 border-b bg-card px-4 py-2 md:px-6" role="tablist" aria-label="Visualização do CRM">
        {([["kanban", "Kanban"], ["funil", "Análise de Funis"]] as const).map(([id, label]) => {
          const active = id === "funil" ? analysisView : !analysisView;
          return (
            <button key={id} role="tab" type="button" aria-selected={active}
              onClick={() => onAnalysisViewChange?.(id === "funil")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              {label}
            </button>
          );
        })}
      </div>
      {analysisView ? (
        <FunnelAnalysis pipeline={selected} onPipelineChange={select} />
      ) : (<>
      {/* Top bar */}
      <header className="pipeline-header border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-lg font-bold">CRM</h1>
            {access.level === "full" ? <PipelineSelector
              pipelines={pipelines} selected={selected} loading={pipelinesLoading}
              onSelect={(id) => { select(id); setActiveLead(null); setSheetOpen(false); setSearch(""); setSourceFilter("all"); setTagFilter("all"); setRevenueFilter("all"); setPeriodFilter("all"); }}
              onSave={async (name, id) => {
                const existing = pipelines.find((p) => p.id === id);
                const saved = await persist({ id, name, stages: existing?.stages ?? freshPipelineStages() });
                if (!saved) return false;
                select(saved.id); setSheetOpen(false);
                toast.success(id ? "Funil renomeado" : "Funil criado"); return true;
              }}
            /> : <p className="text-xs text-muted-foreground">Funil principal</p>}
          </div>

          <div className="flex flex-1 items-center gap-2 md:max-w-md md:ml-6">
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              title="Atualizar pipeline"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await Promise.all([refetch(), access.level === "full" ? todayQ.refetch() : null]);
                setRefreshing(false);
                toast.success("Pipeline atualizado");
              }}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <CrmNotifications placement="inline" />
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, empresa, e-mail ou WhatsApp..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Dialog open={zapOpen} onOpenChange={setZapOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0" title="Configurar Zapier">
                  <Zap className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Automações com Zapier</DialogTitle>
                  <DialogDescription>
                    Conecte o CRM ao Zapier em duas direções: receba leads de qualquer fonte e dispare automações sempre que um novo lead entrar.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs font-medium">Webhook de saída (Zapier)</Label>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Cole a URL de um Zap com gatilho "Webhooks by Zapier → Catch Hook". Será chamado a cada novo lead.
                    </p>
                    <Input placeholder="https://hooks.zapier.com/hooks/catch/..." value={zapDraft} onChange={(e) => setZapDraft(e.target.value)} />
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <Label className="text-xs font-medium">Endpoint de entrada (para o Zapier chamar)</Label>
                    <p className="mt-1 mb-2 text-xs text-muted-foreground">
                      Use uma ação "Webhooks by Zapier → POST" para criar leads automaticamente:
                    </p>
                    <code className="block break-all rounded bg-background px-2 py-1.5 text-xs">
                      POST {typeof window !== "undefined" ? window.location.origin : ""}/api/public/zapier/inbound
                    </code>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Body JSON aceita: <code>name, company, email, whatsapp, source, service, potential_value, notes, stage, utm_source, utm_medium, utm_campaign, utm_content, utm_term</code>.
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <Label className="text-xs font-medium">Formulário público de captura</Label>
                    <p className="mt-1 mb-2 text-xs text-muted-foreground">Compartilhe esta URL em landing pages, e-mails, etc.</p>
                    <Link to="/captura" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      <LinkIcon className="h-3 w-3" /> Abrir página de captura
                    </Link>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setZapOpen(false)}>Fechar</Button>
                  <Button onClick={async () => { await saveZapierUrl(zapDraft.trim()); toast.success("Configuração salva"); setZapOpen(false); }}>Salvar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button onClick={openNew} disabled={pipelinesLoading} className="shrink-0">
              <Plus className="mr-1.5 h-4 w-4" /> Novo Lead
            </Button>
            <Button variant="outline" size="icon" className="shrink-0" title="Nova coluna" onClick={() => { setNewColName(""); setNewColOpen(true); }}>
              <Columns3 className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="shrink-0" title="Sair" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Dialog open={newColOpen} onOpenChange={setNewColOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova coluna</DialogTitle>
              <DialogDescription>Crie uma nova etapa no seu funil.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Nome da coluna</Label>
              <Input
                autoFocus
                placeholder="Ex: Negociação"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newColName.trim()) {
                    addStage(newColName);
                    setNewColOpen(false);
                    toast.success("Coluna criada");
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewColOpen(false)}>Cancelar</Button>
              <Button
                disabled={!newColName.trim()}
                onClick={() => { addStage(newColName); setNewColOpen(false); toast.success("Coluna criada"); }}
              >Criar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {access.level === "full" && <div className="flex items-center gap-2 overflow-x-auto border-t px-4 py-2 [scrollbar-width:thin] md:flex-wrap md:px-6" role="group" aria-label="Pendências do funil">
          {([["awaiting", "Aguardando resposta", Clock], ["today", "Retornos de hoje", CalendarCheck], ["overdue", "Retornos atrasados", AlertTriangle]] as const).map(([id, label, Icon]) => {
            const active = pending === id;
            const count = pendingIds[id].size;
            return <Button key={id} size="sm" variant={active ? "default" : "outline"} aria-pressed={active} className="h-8 shrink-0 rounded-full"
              onClick={() => setPending(active ? null : id)}>
              <Icon className={`size-3.5 ${id === "overdue" && count && !active ? "text-destructive" : ""}`} />{label}
              <span className={`rounded-full px-1.5 text-xs font-semibold ${active ? "bg-primary-foreground/20" : "bg-muted"}`}>{todayQ.isPending ? "…" : count}</span>
            </Button>;
          })}
          {pending && <Button size="sm" variant="ghost" className="h-8" onClick={() => setPending(null)}><X className="size-3.5" />Limpar atalho</Button>}
          {todayQ.isError && <span className="text-xs text-destructive">Pendências indisponíveis agora.</span>}
        </div>}
        {/* Summary + Filters */}
        <div className="flex flex-col gap-3 border-t px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex flex-wrap gap-2">
            <FilterSelect label="Origem" value={sourceFilter} onChange={setSourceFilter} options={sourceOptions} />
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Etiqueta" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas etiquetas</SelectItem>
                {tagOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                {isOutbound && AUTO_TAGS.map((t) => <SelectItem key={t.id} value={t.id}>{t.label} · automática</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={periodFilter} onValueChange={setPeriodFilter}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Período" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo o período</SelectItem>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="14">Últimos 14 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="month">Este mês</SelectItem>
              </SelectContent>
            </Select>
            <Select value={revenueFilter} onValueChange={setRevenueFilter}>
              <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Faturamento" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos faturamentos</SelectItem>
                <SelectItem value="has">Com faturamento</SelectItem>
                <SelectItem value="none">Sem faturamento</SelectItem>
                {revenueOptions.map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isOutbound && <Select value={clickSort} onValueChange={setClickSort}><SelectTrigger className="h-9 w-[180px]" aria-label="Ordenação dos cliques"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">Ordem original</SelectItem><SelectItem value="latest-click">Clique mais recente</SelectItem></SelectContent></Select>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border bg-card p-0.5">
              <Button
                variant={view === "kanban" ? "default" : "ghost"}
                size="sm"
                className="h-8 px-2.5"
                onClick={() => setView("kanban")}
              >
                <LayoutGrid className="mr-1.5 h-3.5 w-3.5" /> Kanban
              </Button>
              <Button
                variant={view === "list" ? "default" : "ghost"}
                size="sm"
                className="h-8 px-2.5"
                onClick={() => setView("list")}
              >
                <List className="mr-1.5 h-3.5 w-3.5" /> Lista
              </Button>
            </div>
            <Stat icon={<Users className="h-3.5 w-3.5" />} label="Leads" value={String(totals.totalLeads)} />
            <Stat icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Fechados" value={String(totals.closed)} accent="success" />
            <Stat icon={<BadgeCheck className="h-3.5 w-3.5" />} label="Valor fechado" value={currency(totals.closedValue)} accent="success"
              title={totals.pendingClosedValue ? `${totals.pendingClosedValue} card(s) em Fechado ainda sem valor confirmado` : "Soma dos valores confirmados na etapa Fechado"} />
            <Stat icon={<TrendingUp className="h-3.5 w-3.5" />} label="Potencial" value={currency(totals.potential)} accent="highlight" title="Soma dos valores estimados das negociações em aberto" />
          </div>
        </div>
      </header>

      {/* Board */}
      {access.level==="full"&&campaignSelection.length>0&&<div className="flex flex-wrap items-center gap-2 border-b bg-card px-5 py-3" role="region" aria-label="Ações em massa"><span className="text-sm font-semibold">{campaignSelection.length} card(s) selecionado(s)</span>
        <Button size="sm" onClick={()=>setBulkMoveOpen(true)}>Mover em massa</Button>
        <Button size="sm" variant="destructive" disabled={bulkDeleting} onClick={()=>setBulkDeleteIds(selectedExistingIds(campaignSelection, leads.map(l=>l.id)))}><Trash2 className="size-4"/>Excluir selecionados</Button>
        {selected!==MAIN_PIPELINE&&<Button size="sm" variant="outline" onClick={()=>setCadenceOpen(true)}><Zap className="size-4"/>Iniciar cadência automática</Button>}
        {selectedClosed.length>0&&<Button size="sm" variant="outline" onClick={()=>setClientLeads(selectedClosed)}><UserPlus className="size-4"/>Adicionar como cliente ({selectedClosed.length} em Fechado)</Button>}
        <Button size="sm" variant="outline" onClick={()=>void copySelectedEmails()}><Mail className="size-4"/>Copiar todos os e-mails</Button>
        <Button size="sm" variant="outline" onClick={()=>setCampaignSelection(old=>selectMany(old,filtered.map(l=>l.id)))}>Selecionar todos os filtrados ({filtered.length})</Button>
        <Button size="sm" variant="outline" onClick={()=>setCampaignSelection(old=>selectMany(old,leads.map(l=>l.id)))}>Selecionar todos do funil ({leads.length})</Button>
        <Button size="sm" variant="ghost" onClick={()=>openCampaign("email")}><Mail className="size-4"/>Campanha de E-mail</Button><Button size="sm" variant="ghost" onClick={()=>openCampaign("whatsapp")}><MessageCircle className="size-4"/>Campanha de WhatsApp</Button>
        <Button size="sm" variant="ghost" onClick={()=>setCampaignSelection([])}><X className="size-4"/>Desmarcar todos</Button></div>}
      {access.level==="full"&&campaignSelection.length===0&&filtered.length>0&&<div className="flex flex-wrap items-center gap-2 border-b px-5 py-2 text-xs text-muted-foreground"><span>Seleção em massa:</span><Button size="sm" variant="ghost" className="h-7" onClick={()=>setCampaignSelection(filtered.map(l=>l.id))}>Selecionar todos os filtrados ({filtered.length})</Button></div>}
      <AlertDialog open={bulkDeleteIds !== null} onOpenChange={open=>{if(!open&&!bulkDeleting)setBulkDeleteIds(null);}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {bulkDeleteIds?.length ?? 0} card(s) selecionado(s)?</AlertDialogTitle>
            <AlertDialogDescription>Somente os cards selecionados serão removidos permanentemente. As colunas do funil não serão excluídas. Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" disabled={bulkDeleting} onClick={()=>setBulkDeleteIds(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={bulkDeleting||!bulkDeleteIds?.length} onClick={()=>void confirmBulkDelete()}><Trash2 className="size-4"/>{bulkDeleting?"Excluindo…":"Confirmar exclusão"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <StartCadenceDialog open={cadenceOpen} onOpenChange={setCadenceOpen} leads={leads.filter(l=>campaignSelection.includes(l.id))} pipelineId={selected===MAIN_PIPELINE?null:selected} onDone={()=>void refetch()}/>
      <BulkMoveDialog open={bulkMoveOpen} onOpenChange={setBulkMoveOpen} leads={leads.filter(l=>campaignSelection.includes(l.id))} pipelines={pipelines} mainStages={legacy.stages} currentPipeline={selected}
        createPipeline={persist} onDone={async(moved)=>{await refetch();setCampaignSelection(old=>old.filter(id=>!moved.includes(id)));}}/>
      <div className="flex min-h-0 flex-1">
      <main className="min-w-0 flex-1 overflow-hidden">
        {view === "kanban" ? (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="kanban-scroll flex h-full gap-3 overflow-x-auto p-4 md:p-6">
              {visibleStages.map((s, i) => (
                <KanbanColumn
                  key={s.id}
                  stageId={s.id}
                  title={s.title}
                  leads={byStage[s.id] || []}
                  onCardClick={openLead}
                  selectedIds={campaignSelection}
                  onSelect={access.level==="full"?(id,checked)=>selectCampaign([id],checked):undefined}
                  onSelectColumn={access.level==="full"?selectCampaign:undefined}
                  onClosedValue={access.level==="full"?(lead)=>setValueLead({ lead, thenClassify: false }):undefined}
                  canMoveLeft={i > 0}
                  canMoveRight={i < visibleStages.length - 1}
                  onMoveLeft={() => moveStage(s.id, -1)}
                  onMoveRight={() => moveStage(s.id, 1)}
                  onDelete={() => {
                    const count = leads.filter((lead) => lead.stage === s.id).length;
                    if (count > 0) {
                      toast.error("Mova os leads desta coluna antes de excluí-la");
                      return;
                    }
                    if (confirm(`Excluir a coluna "${s.title}"?`)) removeStage(s.id);
                  }}
                />
              ))}
              <button
                onClick={() => { setNewColName(""); setNewColOpen(true); }}
                className="flex h-12 w-72 shrink-0 items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 text-sm font-medium text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
              >
                <Plus className="h-4 w-4" /> Nova coluna
              </button>

            </div>
          </DndContext>
        ) : (
          <LeadListView key={selected} leads={filtered} stages={visibleStages} onCardClick={openLead} onBulkDelete={async(ids)=>{if(!await deleteLeads(ids))throw new Error("Não foi possível excluir os cards.");setCampaignSelection(old=>old.filter(id=>!ids.includes(id)));}} selectedIds={access.level==="full"?campaignSelection:undefined} onSelectionChange={access.level==="full"?setCampaignSelection:undefined} />
        )}
      </main>
      </div>
      </>)}

      {!wide && <LeadDetailSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        lead={activeLead}
        isNew={isNew}
        onSave={saveLead}
        onDelete={deleteLead}
        pipelineId={selected === MAIN_PIPELINE ? null : selected}
        pipelineStages={visibleStages}
        pipelines={pipelines}
        closing={closingFor(activeLead)}
      />}
      <SaleCloseDialog lead={closeLead} onDone={() => setCloseLead(null)} />
      <ClosedValueDialog lead={valueLead?.lead ?? null} onDone={finishClosedValue} />
      <AddClientsDialog leads={clientLeads} links={clientLinks} onClose={(changed) => { setClientLeads(null); if (changed) void linksQ.refetch(); }} />
    </div>
    {/* Full-height side panel: sibling of the page column so it spans from the top of the screen to the bottom and scrolls inside. */}
    {wide && sheetOpen && <aside className="flex h-screen min-h-0 w-[min(600px,48%)] shrink-0 flex-col border-l shadow-lg" aria-label="Card do lead">
      <LeadDetailSheet inline open={sheetOpen} onOpenChange={setSheetOpen} lead={activeLead} isNew={isNew} onSave={saveLead} onDelete={deleteLead}
        pipelineId={selected === MAIN_PIPELINE ? null : selected} pipelineStages={visibleStages} pipelines={pipelines} closing={closingFor(activeLead)} />
    </aside>}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos {label.toLowerCase()}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Stat({
  icon,
  label,
  value,
  accent,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "highlight" | "success";
  title?: string;
}) {
  const accentClass =
    accent === "highlight"
      ? "bg-highlight/10 text-highlight-foreground ring-highlight/30"
      : accent === "success"
        ? "bg-success/10 text-success ring-success/30"
        : "bg-muted text-foreground ring-border";
  return (
    <div title={title} className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ${accentClass}`}>
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
