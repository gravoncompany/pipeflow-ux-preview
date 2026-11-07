import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, ArrowUpRight, StickyNote, Search, RefreshCw } from "lucide-react";
import { CrmSidebar } from "@/components/crm/CrmSidebar";
import { CrmAuthGate, getStoredAccess, type CrmAccess } from "@/components/crm/CrmAuthGate";
import { LeadDetailSheet } from "@/components/crm/LeadDetailSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLeads } from "@/hooks/use-leads";
import { usePipelines } from "@/hooks/use-pipelines";
import { useNotificationRead } from "@/hooks/use-notification-read";
import { leadNotifications, notificationDate, updateKind } from "@/lib/lead-notifications";
import type { Lead } from "@/lib/crm-types";

export const Route = createFileRoute("/notificacoes")({
  head: () => ({ meta: [{ title: "Notificações dos leads — PipeFlow CRM" }, { name: "description", content: "Últimas anotações, movimentações e atualizações dos leads no PipeFlow CRM." }, { property: "og:title", content: "Notificações dos leads — PipeFlow CRM" }, { property: "og:description", content: "Acompanhe as atualizações e anotações de cada lead." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: NotificationsPage,
});
function NotificationsPage() {
  const [access, setAccess] = useState<CrmAccess | null>(null);
  useEffect(() => { setAccess(getStoredAccess()); }, []);
  const { leads, loading, refetch, upsertLead, deleteLead } = useLeads();
  const { pipelines } = usePipelines(access?.level === "full");
  const { read, markRead } = useNotificationRead();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const allowedLeads = useMemo(() => leads.filter((lead) => access?.allowedStages === "all" || (access?.allowedStages.includes(lead.stage) && !lead.pipelineId)), [leads, access]);
  const notifications = useMemo(() => leadNotifications(allowedLeads), [allowedLeads]);
  const unread = notifications.filter((n) => !read.has(n.id)).length;
  const visible = notifications.filter((n) => (filter !== "unread" || !read.has(n.id)) && (filter !== "notes" || updateKind(n.entry) === "Anotação") && `${n.lead.name} ${n.lead.company} ${n.entry.text}`.toLowerCase().includes(search.toLowerCase()));
  if (!access) return <CrmAuthGate onUnlock={setAccess} />;
  return <div className="flex min-h-screen bg-background"><CrmSidebar onLogout={() => setAccess(null)} /><main className="min-w-0 flex-1 px-4 py-6 md:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6"><div><div className="flex items-center gap-3"><Bell className="size-6 text-primary" /><h1 className="text-2xl font-bold">Notificações</h1></div><p className="mt-2 text-sm text-muted-foreground">{unread} não lidas · {notifications.length} atualizações</p></div><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Atualizar notificações" title="Atualizar notificações" onClick={() => void refetch()}><RefreshCw className="size-4" /></Button><Button variant="outline" disabled={!unread} onClick={() => markRead(notifications.map((n) => n.id))}><CheckCheck className="size-4" />Marcar todas como lidas</Button></div></header>
    <div className="my-5 flex flex-wrap items-center gap-3"><div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Buscar notificações" placeholder="Buscar lead ou atualização…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="flex gap-1">{[["all", "Todas"], ["unread", "Não lidas"], ["notes", "Anotações"]].map(([id, label]) => <Button key={id} size="sm" variant={filter === id ? "default" : "ghost"} onClick={() => setFilter(id)}>{label}</Button>)}</div></div>
    <div className="max-w-5xl">{loading ? <p className="py-10 text-muted-foreground">Carregando atualizações…</p> : !visible.length ? <div className="py-16 text-center text-muted-foreground"><Bell className="mx-auto mb-4 size-8" /><p>Nenhuma atualização neste filtro.</p></div> : visible.slice(0, 300).map((n) => <article key={n.id} className={`flex items-start gap-3 border-b px-3 py-4 ${read.has(n.id) ? "" : "bg-accent/40"}`}>
      <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{updateKind(n.entry) === "Anotação" ? <StickyNote className="size-4" /> : <Bell className="size-4" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-sm font-semibold">{n.lead.name}</h2>{!read.has(n.id) && <span className="size-2 rounded-full bg-primary" aria-label="Não lida" />}<span className="text-xs text-muted-foreground">{updateKind(n.entry)}</span></div><p className="mt-1 break-words text-sm">{n.entry.text}</p><p className="mt-2 text-xs text-muted-foreground">{notificationDate(n.entry.date)} · {n.lead.company || "Sem empresa"}</p></div><Button variant="ghost" size="icon" title="Abrir card e marcar como lida" aria-label={`Abrir card de ${n.lead.name}`} onClick={() => { markRead([n.id]); setActiveLead(n.lead); }}><ArrowUpRight className="size-4" /></Button>
    </article>)}</div>
    <LeadDetailSheet open={Boolean(activeLead)} onOpenChange={(open) => { if (!open) setActiveLead(null); }} lead={activeLead} isNew={false} onSave={(lead) => void upsertLead(lead)} onDelete={deleteLead} pipelineId={activeLead?.pipelineId} pipelineStages={pipelines.find((p) => p.id === activeLead?.pipelineId)?.stages} />
  </main></div>;
}