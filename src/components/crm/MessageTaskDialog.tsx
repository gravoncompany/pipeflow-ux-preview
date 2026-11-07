import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createTaskFromWhatsAppMessage, getMessageTaskContext } from "@/lib/crm-clients.functions";
import { suggestTaskFromMessage } from "@/lib/message-task";

type Ctx = Awaited<ReturnType<typeof getMessageTaskContext>>;

/** Creates one client task from a WhatsApp message; never sends anything. */
export function MessageTaskDialog({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const load = useServerFn(getMessageTaskContext), create = useServerFn(createTaskFromWhatsAppMessage);
  const qc = useQueryClient();
  const [ctx, setCtx] = useState<Ctx | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(""), [due, setDue] = useState(""), [resp, setResp] = useState("");
  useEffect(() => {
    if (!messageId) return;
    setCtx(null); setErr(""); setResp("");
    load({ data: { messageId } }).then(c => { setCtx(c); const s = suggestTaskFromMessage(c.body, c.sentAt); setTitle(s.title); setDue(s.dueDate ?? ""); })
      .catch(e => setErr(e instanceof Error ? e.message : "Não foi possível abrir."));
  }, [messageId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!messageId) return;
    setBusy(true);
    try {
      const r = await create({ data: { messageId, title, dueDate: due || null, responsible: resp } });
      toast[r.created ? "success" : "info"](r.created ? "Tarefa criada na Central de Tarefas." : "Essa tarefa já existia para esta mensagem; nada foi duplicado.");
      void qc.invalidateQueries();
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível criar."); } finally { setBusy(false); }
  }
  return <Dialog open={!!messageId} onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Criar tarefa</DialogTitle></DialogHeader>
      {!ctx && !err && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      {ctx && ctx.status !== "ok" && <p className="text-sm text-muted-foreground">{ctx.status === "no_client" ? "Este contato não está cadastrado como cliente. Cadastre-o em Clientes para criar tarefas." : "Este WhatsApp aparece em mais de um cliente. Revise os cadastros antes de criar a tarefa."}</p>}
      {ctx?.status === "ok" && ctx.client && <div className="space-y-3">
        <p className="text-sm">Cliente: <Link to="/clientes/$id" params={{ id: ctx.client.id }} search={{ aba: "registros" }} className="font-medium text-primary underline">{ctx.client.name}</Link></p>
        <blockquote className="max-h-24 overflow-y-auto border-l-2 border-primary pl-2 text-xs text-muted-foreground">{ctx.body || "—"}</blockquote>
        {ctx.existing.length > 0 && <p className="text-xs text-muted-foreground">Já existe tarefa desta mensagem: {ctx.existing.map(t => t.title).join(", ")}.</p>}
        <div className="space-y-1"><Label htmlFor="mt-title">Título</Label><Input id="mt-title" value={title} maxLength={300} onChange={e => setTitle(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label htmlFor="mt-due">Prazo</Label><Input id="mt-due" type="date" value={due} onChange={e => setDue(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="mt-resp">Responsável</Label><Input id="mt-resp" value={resp} maxLength={160} onChange={e => setResp(e.target.value)} /></div>
        </div>
        {!due && <p className="text-xs text-muted-foreground">Sem prazo mencionado na mensagem.</p>}
      </div>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        {ctx?.status === "ok" && <Button disabled={busy || title.trim().length < 2} onClick={() => void save()}>Salvar tarefa</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
