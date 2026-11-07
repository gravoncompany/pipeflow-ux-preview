import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { analyzeClientConversationsForTasks, registerSuggestedTasks } from "@/lib/crm-clients.functions";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/crm-clients";
import type { TaskSuggestion } from "@/lib/client-tasks";

type Client = { id: string; trade_name: string };
type Row = { client: Client; state: "aguardando" | "analisando" | "ok" | "sem_conversas" | "erro"; reason?: string; suggestions: TaskSuggestion[]; duplicates?: number; resolved?: number };

const prioClass: Record<string, string> = { urgente: "bg-destructive text-destructive-foreground", alta: "bg-primary text-primary-foreground", media: "bg-secondary text-secondary-foreground", baixa: "bg-muted text-muted-foreground" };

export function BulkTaskAnalysis({ clients, onDone }: { clients: Client[]; onDone: () => void }) {
  const analyze = useServerFn(analyzeClientConversationsForTasks);
  const register = useServerFn(registerSuggestedTasks);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");

  async function start() {
    const initial: Row[] = clients.map(c => ({ client: c, state: "aguardando", suggestions: [] }));
    setRows(initial); setPicked(new Set()); setResult(""); setOpen(true); setRunning(true);
    const sel = new Set<string>();
    for (let i = 0; i < initial.length; i++) {
      setRows(r => r.map((x, j) => j === i ? { ...x, state: "analisando" } : x));
      try {
        const res: any = await analyze({ data: { id: initial[i].client.id } });
        res.suggestions.forEach((_: unknown, k: number) => sel.add(`${i}:${k}`));
        setRows(r => r.map((x, j) => j === i ? { ...x, state: res.status, reason: res.reason, suggestions: res.suggestions, duplicates: res.duplicates, resolved: res.resolved } : x));
      } catch (e) {
        setRows(r => r.map((x, j) => j === i ? { ...x, state: "erro", reason: e instanceof Error ? e.message : "Falha na análise." } : x));
      }
      setPicked(new Set(sel));
    }
    setRunning(false);
  }

  async function save() {
    setRunning(true);
    let created = 0, skipped = 0, failed = 0;
    for (let i = 0; i < rows.length; i++) {
      const tasks = rows[i].suggestions.filter((_, k) => picked.has(`${i}:${k}`));
      if (!tasks.length) continue;
      try { const r = await register({ data: { clientId: rows[i].client.id, tasks } }); created += r.created; skipped += r.skipped; }
      catch { failed++; }
    }
    await qc.invalidateQueries({ queryKey: ["crm-all-tasks"] });
    await qc.invalidateQueries({ queryKey: ["crm-client"] });
    setResult(`${created} tarefa(s) cadastrada(s)${skipped ? `, ${skipped} já existiam` : ""}${failed ? `, ${failed} cliente(s) com falha` : ""}.`);
    setRows(r => r.map((x, i) => ({ ...x, suggestions: x.suggestions.filter((_, k) => !picked.has(`${i}:${k}`)) })));
    setPicked(new Set()); setRunning(false); onDone();
  }

  const done = rows.filter(r => r.state !== "aguardando" && r.state !== "analisando").length;
  const toggle = (k: string) => setPicked(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return <>
    <Button disabled={!clients.length || running} onClick={() => void start()}><Bot className="size-4" />Analisar conversas com Gravon IA{clients.length ? ` (${clients.length})` : ""}</Button>
    <Dialog open={open} onOpenChange={v => { if (!running) setOpen(v); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tarefas identificadas pela Gravon IA</DialogTitle>
          <DialogDescription>A IA só lê as conversas e sugere. Nada é enviado pelo WhatsApp e nada é salvo até você cadastrar.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1"><Progress value={rows.length ? (done / rows.length) * 100 : 0} /><p className="text-xs text-muted-foreground">{done} de {rows.length} clientes analisados</p></div>
        <div className="space-y-4">
          {rows.map((r, i) => (
            <section key={r.client.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{r.client.trade_name}</span>
                <span className="text-xs text-muted-foreground">
                  {r.state === "aguardando" ? "Aguardando" : r.state === "analisando" ? "Analisando…" : r.state === "sem_conversas" ? `Sem conversas disponíveis: ${r.reason}` : r.state === "erro" ? `Falha: ${r.reason}` : `${r.suggestions.length} sugestão(ões)${r.duplicates ? ` · ${r.duplicates} já cadastrada(s)` : ""}${r.resolved ? ` · ${r.resolved} já resolvida(s)` : ""}`}
                </span>
              </div>
              {r.suggestions.map((s, k) => (
                <label key={k} className="mt-2 flex gap-3 rounded-md border bg-muted/30 p-2 text-sm">
                  <Checkbox checked={picked.has(`${i}:${k}`)} onCheckedChange={() => toggle(`${i}:${k}`)} aria-label={`Selecionar ${s.title}`} />
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{s.title}</span><span className={`rounded px-1.5 py-0.5 text-xs ${prioClass[s.priority]}`}>{TASK_PRIORITY[s.priority]}</span><span className="text-xs text-muted-foreground">{TASK_STATUS[s.status]} · {s.dueDate ? `prazo ${s.dueDate.split("-").reverse().join("/")}` : "sem prazo mencionado"}</span></div>
                    {s.description && <p className="text-muted-foreground">{s.description}</p>}
                    <p className="border-l-2 border-primary pl-2 text-xs italic">“{s.quote}”</p>
                  </div>
                </label>
              ))}
            </section>
          ))}
        </div>
        {result && <p role="status" className="text-sm text-primary">{result}</p>}
        <Button disabled={running || !picked.size} onClick={() => void save()}>Cadastrar tarefas selecionadas ({picked.size})</Button>
      </DialogContent>
    </Dialog>
  </>;
}
