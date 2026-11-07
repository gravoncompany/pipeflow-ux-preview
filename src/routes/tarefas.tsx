import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { AtendimentoLayout } from "@/components/crm/AtendimentoLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listAllClientTasks } from "@/lib/crm-clients.functions";
import { TaskBoard, type BoardTask } from "@/components/crm/TaskBoard";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/crm-clients";
import { isOverdue } from "@/lib/client-tasks";

export const Route = createFileRoute("/tarefas")({
  head: () => ({
    meta: [
      { title: "Tarefas — PipeFlow CRM" },
      { name: "description", content: "Central única de tarefas de todos os clientes da Gravon, com prioridades, prazos e status." },
      { property: "og:title", content: "Tarefas — PipeFlow CRM" },
      { property: "og:description", content: "Central de tarefas dos clientes da Gravon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TarefasPage,
});

const fmt = (d: string | null) => d ? d.split("-").reverse().join("/") : "—";
const prioClass: Record<string, string> = { urgente: "bg-destructive text-destructive-foreground", alta: "bg-primary text-primary-foreground", media: "bg-secondary text-secondary-foreground", baixa: "bg-muted text-muted-foreground" };

function TarefasPage() {
  const q = useQuery({ queryKey: ["crm-all-tasks"], queryFn: () => listAllClientTasks(), retry: false });
  const qc = useQueryClient();
  const [f, setF] = useState({ client: "todos", priority: "todas", status: "abertas", responsible: "todos", prazo: "todos" });
  if (q.isPending) return <AtendimentoLayout><p className="p-6 text-muted-foreground">Carregando tarefas…</p></AtendimentoLayout>;
  if (q.isError) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const tasks = q.data.tasks;
  const today = new Date().toISOString().slice(0, 10);
  const clients = [...new Map(tasks.map(t => [t.client_id, t.client_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const people = [...new Set(tasks.map(t => t.responsible).filter(Boolean))].sort();
  const rows = tasks.filter(t =>
    (f.client === "todos" || t.client_id === f.client) &&
    (f.priority === "todas" || t.priority === f.priority) &&
    (f.status === "todos" || (f.status === "abertas" ? t.status !== "concluida" : t.status === f.status)) &&
    (f.responsible === "todos" || (f.responsible === "sem" ? !t.responsible : t.responsible === f.responsible)) &&
    (f.prazo === "todos" || (f.prazo === "atrasadas" ? isOverdue(t, today) : f.prazo === "hoje" ? t.due_date === today : f.prazo === "semana" ? !!t.due_date && t.due_date >= today && t.due_date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) : !t.due_date)),
  );

  const sel = (key: keyof typeof f, label: string, opts: [string, string][]) => (
    <Select value={f[key]} onValueChange={v => setF({ ...f, [key]: v })}>
      <SelectTrigger className="w-44" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{opts.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
    </Select>
  );
  const open = tasks.filter(t => t.status !== "concluida");
  return (
    <AtendimentoLayout><div className="mx-auto w-full max-w-6xl flex-1 space-y-6 overflow-y-auto p-6">
      <header><h1 className="text-2xl font-semibold">Tarefas</h1><p className="text-sm text-muted-foreground">Todas as tarefas dos clientes, as mesmas da aba Tarefas de cada ficha.</p></header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Em aberto", open.length], ["Urgentes", open.filter(t => t.priority === "urgente").length], ["Atrasadas", open.filter(t => isOverdue(t, today)).length], ["Concluídas", tasks.length - open.length]].map(([l, n]) => <div key={l as string} className="rounded-xl border p-4"><div className="text-2xl font-semibold">{n}</div><div className="text-sm text-muted-foreground">{l}</div></div>)}
      </div>
      <div className="flex flex-wrap gap-3">
        {sel("client", "Filtrar por cliente", [["todos", "Todos os clientes"], ...clients])}
        {sel("priority", "Filtrar por prioridade", [["todas", "Todas as prioridades"], ...Object.entries(TASK_PRIORITY)])}
        {sel("prazo", "Filtrar por prazo", [["todos", "Todos os prazos"], ["atrasadas", "Atrasadas"], ["hoje", "Vencem hoje"], ["semana", "Próximos 7 dias"], ["sem", "Sem prazo"]])}
        {sel("responsible", "Filtrar por responsável", [["todos", "Todos os responsáveis"], ["sem", "Sem responsável"], ...people.map(p => [p, p] as [string, string])])}
        {sel("status", "Filtrar por status", [["abertas", "Em aberto"], ["todos", "Todos os status"], ...Object.entries(TASK_STATUS)])}
      </div>
      <TaskBoard tasks={rows as BoardTask[]} context="central" showClient onChanged={() => q.refetch()} />
    </div></AtendimentoLayout>
  );
}
