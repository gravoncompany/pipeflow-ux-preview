import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClientTaskHistory } from "@/lib/crm-clients.functions";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/crm-clients";

const ACTION: Record<string, string> = { criada: "Criada", alterada: "Alterada", concluida: "Concluída", reaberta: "Reaberta", excluida: "Excluída" };
const FIELD: Record<string, string> = { title: "título", description: "descrição", responsible: "responsável", priority: "prioridade", due_date: "prazo", status: "status" };
const val = (k: string, v: unknown) => v === null || v === "" || v === undefined ? "—" : k === "priority" ? TASK_PRIORITY[v as keyof typeof TASK_PRIORITY] ?? String(v) : k === "status" ? TASK_STATUS[v as keyof typeof TASK_STATUS] ?? String(v) : k === "due_date" ? String(v).split("-").reverse().join("/") : String(v).slice(0, 80);

/** Histórico de auditoria das tarefas do cliente (inclui excluídas). */
export function TaskHistory({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const fn = useServerFn(getClientTaskHistory);
  const q = useQuery({ queryKey: ["client-task-history", clientId], queryFn: () => fn({ data: { clientId } }), enabled: open, retry: false });
  return <div className="mt-4 border-t pt-3">
    <Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)}><History />{open ? "Ocultar histórico de tarefas" : "Ver histórico de tarefas"}</Button>
    {open && <div className="mt-2 space-y-1.5">
      {q.isPending && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {q.isError && <p className="text-sm text-destructive">Não foi possível ler o histórico.</p>}
      {q.data?.length === 0 && <p className="text-sm text-muted-foreground">Sem registros ainda.</p>}
      {q.data?.map(e => {
        const ch = (e.changes ?? {}) as Record<string, { de?: unknown; para?: unknown }>;
        return <div key={e.id} className="rounded-md border p-2 text-xs">
          <p><b className={e.action === "excluida" ? "text-destructive" : ""}>{ACTION[e.action] ?? e.action}</b> · {e.title} · {new Date(e.created_at).toLocaleString("pt-BR")}{e.actor ? ` · por ${e.actor}` : ""}{e.origin === "ia" && e.action === "criada" ? " · origem: Pipeflow IA" : ""}{e.responsible ? ` · responsável: ${e.responsible}` : ""}</p>
          {e.action !== "criada" && Object.keys(ch).filter(k => FIELD[k]).length > 0 && <p className="text-muted-foreground">{Object.entries(ch).filter(([k]) => FIELD[k]).map(([k, v]) => `${FIELD[k]}: ${val(k, v.de)} → ${val(k, v.para)}`).join(" · ")}</p>}
        </div>;
      })}
    </div>}
  </div>;
}
