import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, GripVertical, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bulkClientTasks, getTaskOrder, saveClientTask, saveTaskOrder } from "@/lib/crm-clients.functions";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/crm-clients";
import { isOverdue } from "@/lib/client-tasks";
import { sortTasks, type TaskSort } from "@/lib/task-order";

export type BoardTask = {
  id: string; client_id: string; client_name?: string; title: string; description: string; responsible: string; priority: string;
  due_date: string | null; status: string; origin: string; revision: number | string; created_at: string; completed_at?: string | null;
  source_quote?: string; ai_reason?: string;
};

const fmt = (d: string | null | undefined) => d ? d.slice(0, 10).split("-").reverse().join("/") : "—";
export const prioClass: Record<string, string> = { urgente: "bg-destructive text-destructive-foreground", alta: "bg-primary text-primary-foreground", media: "bg-secondary text-secondary-foreground", baixa: "bg-muted text-muted-foreground" };
const SORTS: [TaskSort, string][] = [["custom", "Ordem personalizada"], ["priority", "Prioridade"], ["due", "Prazo"], ["created", "Data de criação"], ["responsible", "Responsável"]];

/** Lista de tarefas com seleção, ações em lote, menu individual e ordem personalizada por arrastar (salva por contexto). */
export function TaskBoard({ tasks, context, showClient, onChanged }: { tasks: BoardTask[]; context: string; showClient?: boolean; onChanged: () => Promise<unknown> | void }) {
  const qc = useQueryClient();
  const orderFn = useServerFn(getTaskOrder), saveOrderFn = useServerFn(saveTaskOrder), bulkFn = useServerFn(bulkClientTasks), saveFn = useServerFn(saveClientTask);
  const order = useQuery({ queryKey: ["task-order", context], queryFn: () => orderFn({ data: { context } }), retry: false });
  const [sort, setSort] = useState<TaskSort>("custom");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [local, setLocal] = useState<string[] | null>(null);
  const [edit, setEdit] = useState<BoardTask | null>(null);
  const [view, setView] = useState<BoardTask | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => { setLocal(null); }, [order.data]);
  useEffect(() => { setSelected(s => new Set([...s].filter(id => tasks.some(t => t.id === id)))); }, [tasks]);

  const rows = useMemo(() => {
    const sorted = sortTasks(tasks, sort, order.data ?? {});
    if (sort !== "custom" || !local) return sorted;
    const pos = new Map(local.map((id, i) => [id, i]));
    return [...sorted].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }, [tasks, sort, order.data, local]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  async function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = rows.map(r => r.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    // Keep tasks hidden by filters in their relative place after the visible ones.
    const hidden = Object.entries(order.data ?? {}).sort((a, b) => a[1] - b[1]).map(([id]) => id).filter(id => !next.includes(id));
    setLocal(next);
    try { await saveOrderFn({ data: { context, ids: [...next, ...hidden] } }); await qc.invalidateQueries({ queryKey: ["task-order", context] }); }
    catch { toast.error("Não foi possível salvar a ordem."); setLocal(null); }
  }

  async function refresh() { await onChanged(); await qc.invalidateQueries({ queryKey: ["crm-all-tasks"] }); await qc.invalidateQueries({ queryKey: ["crm-client"] }); await qc.invalidateQueries({ queryKey: ["client-task-history"] }); }
  async function bulk(ids: string[], action: "complete" | "delete" | "priority", priority?: string) {
    setBusy(true);
    try {
      const r = await bulkFn({ data: { ids, action, ...(priority ? { priority: priority as "media" } : {}) } });
      toast.success(action === "delete" ? `${r.changed} tarefa(s) excluída(s).` : action === "complete" ? `${r.changed} tarefa(s) concluída(s).` : `Prioridade alterada em ${r.changed} tarefa(s).`);
      setSelected(new Set()); await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha na ação."); }
    setBusy(false);
  }
  async function persist(t: BoardTask) {
    setBusy(true);
    try {
      await saveFn({ data: { id: t.id, clientId: t.client_id, title: t.title, description: t.description, responsible: t.responsible, priority: t.priority as "media", dueDate: t.due_date || null, status: t.status as "pendente", revision: Number(t.revision) } });
      setEdit(null); await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar."); }
    setBusy(false);
  }

  const allOn = rows.length > 0 && rows.every(r => selected.has(r.id));
  const sel = [...selected];
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={allOn} onCheckedChange={v => setSelected(v ? new Set(rows.map(r => r.id)) : new Set())} aria-label="Selecionar todas" />Selecionar todas</label>
      <div className="ml-auto flex items-center gap-2"><span className="text-xs text-muted-foreground">Ordenar por</span>
        <Select value={sort} onValueChange={v => setSort(v as TaskSort)}><SelectTrigger className="h-8 w-48" aria-label="Ordenar tarefas"><SelectValue /></SelectTrigger><SelectContent>{SORTS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
      </div>
    </div>
    {sel.length > 0 && <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-primary/5 p-2 text-sm">
      <b>{sel.length} selecionada(s)</b>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void bulk(sel, "complete")}><CheckCircle2 />Concluir</Button>
      <Select onValueChange={v => void bulk(sel, "priority", v)}><SelectTrigger className="h-8 w-44" aria-label="Alterar prioridade"><SelectValue placeholder="Alterar prioridade" /></SelectTrigger><SelectContent>{Object.entries(TASK_PRIORITY).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
      <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => setConfirmDelete(sel)}><Trash2 />Excluir</Button>
      <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar seleção</Button>
    </div>}
    {sort !== "custom" && <p className="text-xs text-muted-foreground">Para arrastar e organizar, escolha “Ordem personalizada”.</p>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => void onDragEnd(e)}>
      <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">{rows.map(t => <Row key={t.id} t={t} draggable={sort === "custom"} showClient={showClient} late={isOverdue(t, today)} checked={selected.has(t.id)}
          onCheck={v => setSelected(s => { const n = new Set(s); v ? n.add(t.id) : n.delete(t.id); return n; })}
          onView={() => setView(t)} onEdit={() => setEdit({ ...t, due_date: t.due_date ?? "" })} onComplete={() => void bulk([t.id], "complete")} onDelete={() => setConfirmDelete([t.id])} busy={busy} />)}
        </ul>
      </SortableContext>
    </DndContext>
    {!rows.length && <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">Nenhuma tarefa encontrada.</p>}

    <AlertDialog open={!!confirmDelete} onOpenChange={o => { if (!o) setConfirmDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Excluir {confirmDelete?.length ?? 0} tarefa(s)?</AlertDialogTitle><AlertDialogDescription>Elas saem das listas, mas ficam registradas no histórico de auditoria do cliente.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => { const ids = confirmDelete ?? []; setConfirmDelete(null); void bulk(ids, "delete"); }}>Excluir</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog open={!!view} onOpenChange={() => setView(null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>{view?.title}</DialogTitle></DialogHeader>
        {view && <div className="space-y-2 text-sm">
          {view.client_name && <p><b>Cliente:</b> {view.client_name}</p>}
          <p><b>Prioridade:</b> {TASK_PRIORITY[view.priority as keyof typeof TASK_PRIORITY]} · <b>Prazo:</b> {fmt(view.due_date)} · <b>Status:</b> {TASK_STATUS[view.status as keyof typeof TASK_STATUS]}</p>
          <p><b>Responsável:</b> {view.responsible || "—"} · <b>Origem:</b> {view.origin === "ia" ? "Pipeflow IA" : view.origin === "lembrete" ? "Lembrete de cobrança" : "Manual"}</p>
          <p className="text-xs text-muted-foreground">Criada em {fmt(view.created_at)}{view.completed_at ? ` · concluída em ${fmt(view.completed_at)}` : ""}</p>
          {view.description && <p className="whitespace-pre-wrap">{view.description}</p>}
          {view.ai_reason && <p><b>Motivo da sugestão:</b> {view.ai_reason}</p>}
          {view.source_quote && <p className="border-l-2 border-primary pl-2 italic">Mensagem de origem: “{view.source_quote}”</p>}
          <Button size="sm" variant="outline" onClick={() => { setEdit({ ...view, due_date: view.due_date ?? "" }); setView(null); }}>Editar</Button>
        </div>}
      </DialogContent>
    </Dialog>

    <Dialog open={!!edit} onOpenChange={() => setEdit(null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar tarefa</DialogTitle></DialogHeader>
        {edit && <div className="space-y-3">
          <div><Label>Título</Label><Input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></div>
          <div><Label>Descrição</Label><Textarea rows={3} value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Responsável</Label><Input value={edit.responsible} onChange={e => setEdit({ ...edit, responsible: e.target.value })} /></div>
            <div><Label>Prazo</Label><Input type="date" value={edit.due_date ?? ""} onChange={e => setEdit({ ...edit, due_date: e.target.value })} /></div>
            <div><Label>Prioridade</Label><Select value={edit.priority} onValueChange={v => setEdit({ ...edit, priority: v })}><SelectTrigger aria-label="Prioridade"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TASK_PRIORITY).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Status</Label><Select value={edit.status} onValueChange={v => setEdit({ ...edit, status: v })}><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TASK_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <Button disabled={busy || edit.title.trim().length < 2} onClick={() => void persist(edit)}>Salvar tarefa</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}

function Row({ t, draggable, showClient, late, checked, onCheck, onView, onEdit, onComplete, onDelete, busy }: { t: BoardTask; draggable: boolean; showClient?: boolean; late: boolean; checked: boolean; onCheck: (v: boolean) => void; onView: () => void; onEdit: () => void; onComplete: () => void; onDelete: () => void; busy: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: !draggable });
  const done = t.status === "concluida";
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-start gap-2 rounded-lg border bg-card p-3 text-sm ${isDragging ? "relative z-20 shadow-lg" : ""} ${late ? "border-destructive/40 bg-destructive/5" : ""} ${done ? "opacity-70" : ""}`}>
    <button type="button" {...attributes} {...listeners} disabled={!draggable} className={`mt-0.5 touch-none text-muted-foreground ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed opacity-30"}`} aria-label={`Arrastar ${t.title}`}><GripVertical className="size-4" /></button>
    <Checkbox className="mt-0.5" checked={checked} onCheckedChange={v => onCheck(Boolean(v))} aria-label={`Selecionar ${t.title}`} />
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`text-left font-medium hover:underline ${done ? "line-through" : ""}`} onClick={onView}>{t.title}</button>
        <span className={`rounded px-1.5 py-0.5 text-xs ${prioClass[t.priority]}`}>{TASK_PRIORITY[t.priority as keyof typeof TASK_PRIORITY]}</span>
        {t.origin === "ia" && <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">Pipeflow IA</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {showClient && t.client_name && <><Link to="/clientes/$id" params={{ id: t.client_id }} search={{ aba: "registros" } as never} className="text-primary hover:underline">{t.client_name}</Link> · </>}
        {TASK_STATUS[t.status as keyof typeof TASK_STATUS]} · <span className={late ? "font-semibold text-destructive" : ""}>prazo {fmt(t.due_date)}{late ? " (atrasada)" : ""}</span>{t.responsible ? ` · ${t.responsible}` : ""}{done && t.completed_at ? ` · concluída em ${fmt(t.completed_at)}` : ""}
      </p>
    </div>
    {!done && <Button size="sm" variant="ghost" className="hidden sm:inline-flex" disabled={busy} onClick={onComplete}><CheckCircle2 />Concluir</Button>}
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Ações de ${t.title}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onView}>Detalhes</DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}><Pencil />Editar</DropdownMenuItem>
        {!done && <DropdownMenuItem onSelect={onComplete}><CheckCircle2 />Concluir</DropdownMenuItem>}
        <DropdownMenuItem className="text-destructive" onSelect={onDelete}><Trash2 />Excluir</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </li>;
}
