import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { RefreshCw, Wifi, WifiOff, Phone, Webhook, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getEvolutionStatus } from "@/lib/evolution.functions";
import { setupEvolutionWebhook } from "@/lib/whatsapp-chat.functions";

const PUBLIC_ORIGIN = "https://crm.gravoncompany.com";

export function statusLabel(status: string) {
  const s = status.toLowerCase();
  if (s === "open" || s === "connected") return { text: "Conectado", ok: true };
  if (s === "connecting") return { text: "Conectando", ok: false };
  return { text: "Desconectado", ok: false };
}

export function useEvolutionStatus() {
  const fetchStatus = useServerFn(getEvolutionStatus);
  return useQuery({ queryKey: ["evolution-status"], queryFn: () => fetchStatus(), retry: false, refetchOnWindowFocus: false, refetchInterval: 120000 });
}

function ago(ts: number, now: number) {
  if (!ts) return "—";
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)} h`;
}

export function WhatsAppStatusBox() {
  const q = useEvolutionStatus();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  if (q.data?.needsAuth) return null;
  const connected = (q.data?.instances ?? []).some((i) => statusLabel(i.status).ok);
  return <>
    <div className="w-full rounded-xl border border-sidebar-panel-border bg-sidebar-panel p-3 text-sidebar-foreground">
      <p className={`flex items-center gap-1.5 text-xs font-semibold ${connected ? "text-sidebar-foreground" : "text-destructive"}`}>
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-destructive"}`} aria-hidden />
        {q.isPending ? "Verificando..." : connected ? "WhatsApp conectado" : "WhatsApp desconectado"}
      </p>
      <p className="mt-0.5 text-[11px] text-sidebar-foreground/70">Sincronizado {ago(q.dataUpdatedAt, now || q.dataUpdatedAt)}</p>
      <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => setOpen(true)}>Gerenciar conexão</Button>
    </div>
    <ConnectionDialog open={open} onOpenChange={setOpen} />
  </>;
}

function ConnectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const q = useEvolutionStatus();
  const setup = useServerFn(setupEvolutionWebhook);
  const [busy, setBusy] = useState(false);
  const instances = q.data?.instances ?? [];
  const connected = instances.filter((i) => statusLabel(i.status).ok);
  const error = q.data?.error || (q.error ? "Não foi possível verificar a conexão." : null);

  async function activate() {
    setBusy(true);
    const r = await setup({ data: { origin: PUBLIC_ORIGIN } }).catch(() => ({ ok: false, error: "Falha ao ativar." }));
    setBusy(false);
    if (r.ok) toast.success("Recebimento de mensagens ativado"); else toast.error(r.error ?? "Falha ao ativar.");
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Conexão do WhatsApp</DialogTitle>
        <DialogDescription>Status da Evolution API e do número conectado.</DialogDescription>
      </DialogHeader>
      {error ? <div role="alert" className="flex items-start gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" /><span className="break-words">{error}</span></div> : <>
        <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">Status da API</p><p className="mt-1 text-xl font-bold text-primary">{q.data?.ok ? "Online" : "Offline"}</p></div>
          <div><p className="text-xs text-muted-foreground">Instâncias</p><p className="mt-1 text-xl font-semibold">{instances.length}</p><p className="text-[11px] text-muted-foreground">{connected.length} conectada{connected.length === 1 ? "" : "s"}</p></div>
          <div><p className="text-xs text-muted-foreground">Número conectado</p><p className="mt-1 break-all text-xl font-semibold">{connected[0]?.number || "—"}</p><p className="text-[11px] text-muted-foreground">{connected[0]?.profileName || "Nenhum número ativo"}</p></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {instances.map((i) => { const s = statusLabel(i.status); return <div key={i.name} className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold">{i.name}</p>
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>{s.ok ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}{s.text}</span></div>
            {i.number && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{i.number}</p>}
          </div>; })}
        </div>
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void activate()}><Webhook />Ativar recebimento de mensagens</Button>
        <Button size="sm" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw className={q.isFetching ? "animate-spin" : ""} />Testar conexão</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
