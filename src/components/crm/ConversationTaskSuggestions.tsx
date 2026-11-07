import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, Check, ListPlus, Loader2, Pencil, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { analyzeClientConversationsForTasks, getConversationClient, registerSuggestedTasks } from "@/lib/crm-clients.functions";
import { TASK_PRIORITY } from "@/lib/crm-clients";
import type { TaskSuggestion } from "@/lib/client-tasks";

/** Tarefas sugeridas pela IA para o cliente da conversa aberta. Só salva ao clicar em "Criar tarefa"; deduplicado no servidor. */
export function ConversationTaskSuggestions({ phone }: { phone: string }) {
  const getClient = useServerFn(getConversationClient);
  const analyze = useServerFn(analyzeClientConversationsForTasks);
  const register = useServerFn(registerSuggestedTasks);
  const qc = useQueryClient();
  const client = useQuery({ queryKey: ["conversation-client", phone], queryFn: () => getClient({ data: { phone } }), staleTime: 60_000 });
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<TaskSuggestion[] | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [gone, setGone] = useState<Set<number>>(new Set());

  const c = client.data;
  async function run() {
    if (!c?.client) return;
    setBusy(true); setNote(""); setSaved(new Set()); setPicked(new Set()); setGone(new Set()); setEditing(null);
    try {
      const r: any = await analyze({ data: { id: c.client.id } });
      setItems(r.suggestions ?? []);
      if (r.status !== "ok") setNote(r.reason || "Sem conversas disponíveis.");
      else if (r.duplicates) setNote(`${r.duplicates} sugestão(ões) já existiam na Central de Tarefas.`);
    } catch (e) { setNote(e instanceof Error ? e.message : "Falha na análise."); }
    finally { setBusy(false); }
  }
  async function create(idx: number[]) {
    if (!c?.client || !items || !idx.length) return;
    setSaving(idx[0]);
    try {
      const r = await register({ data: { clientId: c.client.id, tasks: idx.map(i => items[i]) } });
      setSaved(s => { const n = new Set(s); idx.forEach(i => n.add(i)); return n; }); setPicked(new Set());
      toast.success(`${r.created} tarefa(s) criada(s) na Central de Tarefas${r.skipped ? `; ${r.skipped} já existia(m), nada foi duplicado` : ""}.`);
      await qc.invalidateQueries({ queryKey: ["crm-all-tasks"] });
      await qc.invalidateQueries({ queryKey: ["crm-client"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível criar a tarefa."); }
    finally { setSaving(null); }
  }

  return <section className="space-y-2 border-t pt-3" aria-label="Tarefas sugeridas com IA">
    <h3 className="text-sm font-semibold">Tarefas sugeridas com IA</h3>
    {client.isPending ? <p className="text-xs text-muted-foreground">Conferindo cliente…</p>
      : client.isError ? <p className="text-xs text-destructive">Não foi possível conferir o cliente.</p>
      : c?.status !== "ok" ? <p className="text-xs text-muted-foreground">{c?.status === "ambiguous" ? "Este WhatsApp está em mais de um cliente; revise os cadastros." : "Contato não é um cliente cadastrado; tarefas ficam disponíveis após o cadastro."}</p>
      : <>
        <p className="text-xs text-muted-foreground">Cliente: <Link to="/clientes/$id" params={{ id: c.client!.id }} search={{ aba: "registros" } as any} className="font-medium text-primary underline">{c.client!.name}</Link></p>
        <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" /> : <Bot />}{busy ? "Analisando…" : items ? "Sugerir novamente" : "Sugerir tarefas"}</Button>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {items && !items.length && !note && <p className="text-xs text-muted-foreground">Nenhuma tarefa nova identificada.</p>}
        {items && items.some((_, i) => !gone.has(i) && !saved.has(i)) && <div className="flex items-center justify-between gap-2 text-xs">
          <label className="flex items-center gap-1.5"><Checkbox checked={items.every((_, i) => gone.has(i) || saved.has(i) || picked.has(i))} onCheckedChange={v => setPicked(v ? new Set(items.flatMap((_, i) => gone.has(i) || saved.has(i) ? [] : [i])) : new Set())} aria-label="Selecionar todas as sugestões" />Selecionar todas</label>
          <Button size="sm" disabled={!picked.size || saving !== null} onClick={() => void create([...picked])}><ListPlus />Criar selecionadas ({picked.size})</Button>
        </div>}
        {items?.map((s, i) => gone.has(i) ? null : <div key={i} className="space-y-1 rounded-md border bg-muted/30 p-2 text-sm">
          {editing === i ? <div className="space-y-1.5">
            <Input value={s.title} onChange={e => setItems(l => l!.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} aria-label="Título" />
            <Textarea rows={2} value={s.description} onChange={e => setItems(l => l!.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} aria-label="Descrição" />
            <div className="flex gap-1.5">
              <select className="h-8 flex-1 rounded-md border bg-background px-2 text-xs" value={s.priority} onChange={e => setItems(l => l!.map((x, j) => j === i ? { ...x, priority: e.target.value as typeof x.priority } : x))} aria-label="Prioridade">{Object.entries(TASK_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <Input type="date" className="h-8 flex-1 text-xs" value={s.dueDate ?? ""} onChange={e => setItems(l => l!.map((x, j) => j === i ? { ...x, dueDate: e.target.value || null, dueEvidence: e.target.value ? x.dueEvidence ?? "definido pelo usuário" : null } : x))} aria-label="Prazo" />
            </div>
            <Button size="sm" variant="outline" className="w-full" disabled={s.title.trim().length < 2} onClick={() => setEditing(null)}>Concluir edição</Button>
          </div> : <>
            <div className="flex items-start gap-1.5">
              {!saved.has(i) && <Checkbox className="mt-0.5" checked={picked.has(i)} onCheckedChange={v => setPicked(p => { const n = new Set(p); v ? n.add(i) : n.delete(i); return n; })} aria-label={`Selecionar ${s.title}`} />}
              <div className="min-w-0 flex-1"><span className="font-medium">{s.title}</span> <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{TASK_PRIORITY[s.priority]}</span></div>
            </div>
            {s.description && <p className="text-xs">{s.description}</p>}
            <p className="text-xs text-muted-foreground">Cliente: {c.client!.name}{s.dueDate ? ` · prazo ${s.dueDate.split("-").reverse().join("/")}` : ""}</p>
            {s.reason && <p className="text-xs"><b>Motivo:</b> {s.reason}</p>}
            <p className="border-l-2 border-primary pl-2 text-xs italic">Conversa: “{s.quote}”</p>
          </>}
          {editing !== i && <div className="flex gap-1">
            <Button size="sm" className="flex-1" disabled={saving !== null || saved.has(i)} onClick={() => void create([i])}>{saved.has(i) ? <><Check />Criada</> : saving === i ? <Loader2 className="animate-spin" /> : <><ListPlus />Criar tarefa</>}</Button>
            {!saved.has(i) && <Button size="icon" variant="outline" aria-label="Editar sugestão" onClick={() => setEditing(i)}><Pencil /></Button>}
            {!saved.has(i) && <Button size="icon" variant="ghost" aria-label="Descartar sugestão" onClick={() => { setGone(g => new Set(g).add(i)); setPicked(p => { const n = new Set(p); n.delete(i); return n; }); }}><X /></Button>}
          </div>}
        </div>)}
      </>}
  </section>;
}
