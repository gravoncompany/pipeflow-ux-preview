import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Pause, Play, Power, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getLeadAgentControl, setLeadAgentControl } from "@/lib/lead-agent-control.functions";
import { releaseCommercialAgentHold } from "@/lib/commercial-agent.functions";
import { PAUSE_OPTIONS, type LeadAgentTone } from "@/lib/lead-agent-control";
import { phoneKey } from "@/lib/phone";

const TONE: Record<LeadAgentTone, string> = {
  on: "bg-wa/15 text-wa-strong",
  paused: "bg-warning/15 text-warning-foreground",
  off: "bg-muted text-muted-foreground",
  human: "bg-primary/10 text-primary",
  neutral: "bg-muted text-muted-foreground",
};

/** Same query key in the card and in Conversas, so a change in one is reflected in the other immediately. */
export const leadAgentKey = (phone: string) => ["lead-agent", phoneKey(phone)] as const;

export function LeadAgentControl({ phone, compact = false }: { phone: string; compact?: boolean }) {
  const get = useServerFn(getLeadAgentControl);
  const set = useServerFn(setLeadAgentControl);
  const release = useServerFn(releaseCommercialAgentHold);
  const qc = useQueryClient();
  const [hours, setHours] = useState("4");
  const [busy, setBusy] = useState(false);
  const valid = phoneKey(phone).length >= 8;
  const q = useQuery({ queryKey: leadAgentKey(phone), queryFn: () => get({ data: { phone } }), enabled: valid, refetchInterval: 15000, refetchOnWindowFocus: true });

  if (!valid) return <p className="text-xs text-muted-foreground">Informe o WhatsApp do lead para controlar a Pipeflow IA.</p>;
  const data = q.data;
  const c = data && data.authorized ? data.control : null;

  async function change(mode: "active" | "paused" | "disabled") {
    if (!c || busy) return;
    setBusy(true);
    try {
      await set({ data: { phone, mode, hours: mode === "paused" ? Number(hours) : null, revision: c.revision } });
      toast.success(mode === "active" ? "Pipeflow IA ativada para este lead." : mode === "paused" ? "Pipeflow IA pausada para este lead." : "Pipeflow IA desativada para este lead.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível alterar a Pipeflow IA."); }
    finally { setBusy(false); await qc.invalidateQueries({ queryKey: leadAgentKey(phone) }); }
  }
  async function giveBack() {
    if (!c || busy || !window.confirm("Devolver este contato para a Pipeflow IA? Confira a conversa antes: envios com resultado incerto não serão repetidos.")) return;
    setBusy(true);
    try { await release({ data: { contactKey: c.contactKey, confirmed: true } }); toast.success("Contato devolvido para a Pipeflow IA."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível devolver o contato."); }
    finally { setBusy(false); await qc.invalidateQueries({ queryKey: leadAgentKey(phone) }); }
  }

  return <section aria-label="Pipeflow IA deste lead" className={`rounded-xl border bg-card ${compact ? "p-3" : "p-4"}`}>
    <div className="flex items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4 text-primary" />Pipeflow IA</p>
      {c && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[c.tone]}`}>{c.label}</span>}
    </div>
    {q.isPending ? <p className="mt-2 text-xs text-muted-foreground">Carregando…</p>
      : q.isError ? <p role="alert" className="mt-2 text-xs text-destructive">Não foi possível carregar a Pipeflow IA.</p>
      : data && !data.authorized ? <p className="mt-2 text-xs text-muted-foreground">{data.error ?? "Entre com sua conta administrativa para controlar a Pipeflow IA."}</p>
      : c && <>
        <p className="mt-1 text-xs text-muted-foreground">
          {c.funnelName ? `${c.funnelName} · ` : ""}Controle do lead: {c.mode === "active" ? "ativo" : c.mode === "paused" ? `pausado até ${new Date(c.pausedUntil!).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "desativado"}
        </p>
        {c.holdReason && <p className="mt-2 flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-xs"><UserRound className="mt-0.5 size-3.5 shrink-0 text-primary" /><span><b>Atendimento humano:</b> {c.holdReason}</span></p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={c.mode === "active" ? "default" : "outline"} disabled={busy || c.mode === "active"} onClick={() => void change("active")}><Play />Ativar</Button>
          <div className="flex items-center gap-1">
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger className="h-8 w-[86px] text-xs" aria-label="Tempo da pausa"><SelectValue /></SelectTrigger>
              <SelectContent>{PAUSE_OPTIONS.map((h) => <SelectItem key={h} value={String(h)}>{h < 24 ? `${h} h` : `${h / 24} dia${h > 24 ? "s" : ""}`}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void change("paused")}><Pause />Pausar</Button>
          </div>
          <Button size="sm" variant="outline" disabled={busy || c.mode === "disabled"} onClick={() => void change("disabled")}><Power />Desativar</Button>
          {c.holdReason && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void giveBack()}>Devolver para a IA</Button>}
        </div>
        {!compact && <p className="mt-2 text-[11px] text-muted-foreground">Respeita a configuração do funil, os números autorizados e o horário de atendimento. Quando alguém da equipe responde, a IA pausa sozinha nesta conversa.</p>}
      </>}
  </section>;
}
