import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bell, CheckCheck, RefreshCw, Search, StickyNote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLeads } from "@/hooks/use-leads";
import { usePipelines } from "@/hooks/use-pipelines";
import { useNotificationRead } from "@/hooks/use-notification-read";
import { leadNotifications, notificationDate, updateKind } from "@/lib/lead-notifications";
import { type Lead } from "@/lib/crm-types";
import { getStoredAccess, type CrmAccess } from "./CrmAuthGate";
import { LeadDetailSheet } from "./LeadDetailSheet";

// placement: "fixed" (topo, à esquerda da foto de perfil) ou "inline" (no cabeçalho do Pipeline, ao lado de Atualizar).
// Somente a posição muda; ícone, contador, painel e alertas são os mesmos.
export function CrmNotifications({ placement = "fixed" }: { placement?: "fixed" | "inline" }) {
  const [access, setAccess] = useState<CrmAccess | null>(null);
  useEffect(() => { setAccess(getStoredAccess()); }, []);
  return access ? <NotificationBell access={access} placement={placement} /> : null;
}

function NotificationBell({ access, placement }: { access: CrmAccess; placement: "fixed" | "inline" }) {
  const { leads, loading, refetch, upsertLead, deleteLead } = useLeads();
  const { read, markRead } = useNotificationRead();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const activeLead = leads.find((lead) => lead.id === activeLeadId) ?? null;
  const { pipelines } = usePipelines(access.level === "full" && Boolean(activeLead?.pipelineId));
  const notifications = useMemo(() => leadNotifications(leads.filter((lead) => access.allowedStages === "all" || (access.allowedStages.includes(lead.stage) && !lead.pipelineId))), [leads, access]);
  const unread = notifications.filter((n) => !read.has(n.id)).length;
  const visible = notifications.filter((n) => (filter !== "unread" || !read.has(n.id)) && (filter !== "notes" || updateKind(n.entry) === "Anotação") && `${n.lead.name} ${n.lead.company} ${n.entry.text}`.toLowerCase().includes(search.toLowerCase()));
  const openLead = (lead: Lead, id: string) => {
    markRead([id]);
    setOpen(false);
    setActiveLeadId(lead.id);
  };

  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className={placement === "inline" ? "relative size-10 shrink-0" : "fixed right-[4.25rem] top-3 z-40 size-10 bg-card text-foreground shadow-sm md:right-[4.75rem]"} aria-label="Abrir notificações" title={unread ? `Notificações · ${unread} não lidas` : "Notificações"}>
          <Bell className="size-5" />
          {unread > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground" aria-label={`${unread} notificações não lidas`}>{unread > 99 ? "99+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="flex max-h-[min(650px,calc(100dvh-80px))] w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden p-0" aria-label="Notificações">
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div><h2 className="text-base font-semibold">Notificações</h2><p className="mt-0.5 text-xs text-muted-foreground">{unread} não lidas · {notifications.length} atualizações</p></div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" className="size-8" aria-label="Atualizar notificações" title="Atualizar notificações" onClick={() => void refetch()}><RefreshCw className="size-4" /></Button>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Marcar todas como lidas" title="Marcar todas como lidas" disabled={!unread} onClick={() => markRead(notifications.map((n) => n.id))}><CheckCheck className="size-4" /></Button>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Fechar notificações" title="Fechar notificações" onClick={() => setOpen(false)}><X className="size-4" /></Button>
          </div>
        </header>
        <div className="space-y-2 border-b p-3">
          <div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Buscar notificações" placeholder="Buscar lead ou atualização…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="flex gap-1">{[["all", "Todas"], ["unread", "Não lidas"], ["notes", "Anotações"]].map(([id, label]) => <Button key={id} variant={filter === id ? "secondary" : "ghost"} size="sm" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</Button>)}</div>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {loading ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando atualizações…</p> : !visible.length ? <div className="px-4 py-10 text-center text-sm text-muted-foreground"><Bell className="mx-auto mb-3 size-6" />Nenhuma atualização neste filtro.</div> : visible.slice(0, 300).map((n) => <article key={n.id} className={`flex items-start gap-3 border-b p-4 last:border-b-0 ${read.has(n.id) ? "" : "bg-accent/40"}`}>
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{updateKind(n.entry) === "Anotação" ? <StickyNote className="size-4" /> : <Bell className="size-4" />}</div>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="break-words text-sm font-semibold">{n.lead.name}</h3>{!read.has(n.id) && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Não lida" />}</div><p className="mt-1 text-xs font-medium text-primary">{updateKind(n.entry)}</p><p className="mt-1 break-words text-sm">{n.entry.text}</p><p className="mt-2 text-xs text-muted-foreground">{notificationDate(n.entry.date)}{n.lead.company ? ` · ${n.lead.company}` : ""}</p></div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Abrir card de ${n.lead.name}`} title="Abrir card e marcar como lida" onClick={() => openLead(n.lead, n.id)}><ArrowUpRight className="size-4" /></Button>
          </article>)}
        </div>
      </PopoverContent>
    </Popover>
    <LeadDetailSheet open={Boolean(activeLead)} onOpenChange={(value) => { if (!value) setActiveLeadId(null); }} lead={activeLead} isNew={false} onSave={(lead) => void upsertLead(lead)} onDelete={deleteLead} pipelineId={activeLead?.pipelineId} pipelineStages={pipelines.find((p) => p.id === activeLead?.pipelineId)?.stages} />
  </>;
}