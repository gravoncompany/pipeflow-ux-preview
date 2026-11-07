import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { getWhatsAppCampaignStatus, processWhatsAppCampaignBatch, stopWhatsAppCampaignRun, pauseWhatsAppCampaignRun } from "@/lib/campaigns.functions";
import { estimateSeconds, formatDuration, type DeliveryCounts } from "@/lib/whatsapp-campaigns";
import { WhatsAppCampaignPacing } from "@/components/crm/WhatsAppCampaignPacing";
import { WhatsAppCampaignDetails } from "@/components/crm/WhatsAppCampaignDetails";
import { whatsAppCampaignLabel } from "@/lib/whatsapp-campaigns";

type PacingInfo = { min: number; max: number; pauseEvery: number; pauseSeconds: number; sentSincePause: number; nextSendAt: string } | null;
type Status = { state: string; counts: DeliveryCounts; paused?: boolean; reason?: string; pacing?: PacingInfo };

/** Controlled sending: while this screen is open and the campaign is running, sends small batches one after another. */
export function WhatsAppCampaignProgress({ id, initialState, onChanged }: { id: string; initialState: string; onChanged: () => void }) {
  const runBatch = useServerFn(processWhatsAppCampaignBatch), status = useServerFn(getWhatsAppCampaignStatus), stop = useServerFn(stopWhatsAppCampaignRun), pauseFn = useServerFn(pauseWhatsAppCampaignRun);
  const [tick, setTick] = useState(0);
  const [s, setS] = useState<Status | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const alive = useRef(true), running = useRef(false);
  useEffect(() => {
    alive.current = true;
    async function loop() {
      if (running.current) return; running.current = true;
      try {
        let current: Status = await status({ data: { id } });
        if (alive.current) setS(current);
        while (alive.current && (current.state === "running" || current.state === "scheduled")) {
          current = await runBatch({ data: { id } });
          if (!alive.current) break;
          setS(current);
          if (current.paused) { await new Promise(r => setTimeout(r, 15000)); continue; }
          if (current.state === "scheduled") { await new Promise(r => setTimeout(r, 15000)); continue; }
          if (current.state !== "running") { onChanged(); break; }
          const next = current.pacing ? Date.parse(current.pacing.nextSendAt) - Date.now() : 2000;
          await new Promise(r => setTimeout(r, Math.min(Math.max(next + 200, 500), 30000)));
        }
      } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Envio interrompido."); }
      finally { running.current = false; }
    }
    void loop();
    return () => { alive.current = false; };
  }, [id, initialState, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <p className="mt-1 text-xs text-muted-foreground">Carregando status…</p>;
  const c = s.counts, done = c.accepted + c.failed + c.unknown + c.cancelled, pending = c.queued + c.sending, pc = s.pacing ?? null;
  const nextIn = pc ? Math.max(0, Math.round((Date.parse(pc.nextSendAt) - Date.now()) / 1000)) : null;
  return <div className="mt-2 space-y-1 text-xs">
    {c.total > 0 && <div className="h-1.5 w-full max-w-sm overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.round((done / c.total) * 100)}%` }} /></div>}
    <div className="flex flex-wrap items-center gap-2"><span className={c.failed + c.unknown > 0 && s.state !== "running" ? "font-medium text-destructive" : "font-medium"}>{whatsAppCampaignLabel(s.state, c)}</span><WhatsAppCampaignDetails id={id} /></div>
    <p className="text-muted-foreground">Total {c.total} · {c.accepted} enviados · {pending} pendentes · {c.failed + c.unknown} com erro</p>
    {pc && s.state === "running" && <p className="text-muted-foreground">Intervalo {pc.min} a {pc.max} s · pausa de {formatDuration(pc.pauseSeconds)} a cada {pc.pauseEvery} · próximo envio {nextIn ? `em ${formatDuration(nextIn)}` : "agora"} · conclusão estimada em {formatDuration(estimateSeconds(pending, pc, pc.sentSincePause) + (nextIn ?? 0))}</p>}
    <p className="text-muted-foreground">{c.accepted} enviados · {c.queued + c.sending} na fila · {c.failed} recusados · {c.unknown} sem confirmação · {c.cancelled} não enviados</p>
    {s.state === "running" && !s.paused && <p className="text-muted-foreground">Envio gradual em andamento. Mantenha esta tela aberta; se fechar, o envio pausa e continua quando você voltar.</p>}
    {s.paused && <p className="text-destructive">Envio pausado: {s.reason} Nenhum contato foi perdido; tentaremos de novo em instantes.</p>}
    {c.unknown > 0 && <p className="text-muted-foreground">"Sem confirmação" nunca é reenviado automaticamente, para não duplicar mensagens.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {s.state === "running" && <WhatsAppCampaignPacing id={id} current={pc} onSaved={async () => setS(await status({ data: { id } }))} />}
    {s.state === "scheduled" && <p className="text-muted-foreground">Agendada. O envio começa no horário escolhido enquanto esta tela estiver aberta.</p>}
    {s.state === "paused" && <p className="text-muted-foreground">Pausada por você. Nenhuma mensagem é enviada até retomar.</p>}
    {(s.state === "running" || s.state === "paused") && <Button variant="outline" size="sm" className="mr-2" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const pause = s.state === "running"; alive.current = false; await pauseFn({ data: { id, pause } }); setS(await status({ data: { id } })); setTick(t => t + 1); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Ação indisponível."); } finally { setBusy(false); } }}>{s.state === "running" ? "Pausar" : "Retomar"}</Button>}
    {(s.state === "running" || s.state === "paused" || s.state === "scheduled") && <Button variant="outline" size="sm" disabled={busy} onClick={async () => { if (!window.confirm("Cancelar a campanha? Destinatários ainda na fila não receberão a mensagem.")) return; setBusy(true); try { await stop({ data: { id, confirmed: true } }); alive.current = false; onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível interromper."); } finally { setBusy(false); } }}>Cancelar campanha</Button>}
  </div>;
}
