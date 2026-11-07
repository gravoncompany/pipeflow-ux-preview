import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveWhatsAppCampaignPacing } from "@/lib/campaigns.functions";
import { DEFAULT_PACING, PAUSE_EVERY, PAUSE_SECONDS, SEND_INTERVALS, formatDuration, type Pacing } from "@/lib/whatsapp-campaigns";

/** Per-campaign sending speed; saving on a running campaign only affects upcoming messages. */
/** Without id: controlled selector used in the creation step (saved together with "Iniciar campanha"). */
export function WhatsAppCampaignPacing({ id, current, onSaved, value, onChange }: { id?: string; current: Pacing | null; onSaved?: () => void; value?: Pacing; onChange?: (p: Pacing) => void }) {
  const save = useServerFn(saveWhatsAppCampaignPacing);
  const [own, setOwn] = useState<Pacing>(current ?? DEFAULT_PACING); const p = value ?? own; const setP = (n: Pacing) => { setOwn(n); onChange?.(n); }
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (current && !value) setOwn(current); }, [current?.min, current?.max, current?.pauseEvery, current?.pauseSeconds]); // eslint-disable-line react-hooks/exhaustive-deps
  const interval = `${p.min}-${p.max}`;
  return <div className="mt-2 rounded-md border bg-muted/30 p-3 text-xs">
    <p className="mb-2 font-medium">Velocidade de envio {current ? <span className="font-normal text-muted-foreground">· salva: {current.min} a {current.max} s, pausa de {formatDuration(current.pauseSeconds)} a cada {current.pauseEvery}</span> : <span className="font-normal text-muted-foreground">· ainda não configurada (usa o envio padrão)</span>}</p>
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="space-y-1"><span className="text-muted-foreground">Intervalo entre mensagens</span>
        <Select value={interval} onValueChange={v => { const i = SEND_INTERVALS.find(x => x.key === v)!; setP({ ...p, min: i.min, max: i.max }); }}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{SEND_INTERVALS.map(i => <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>)}</SelectContent></Select></label>
      <label className="space-y-1"><span className="text-muted-foreground">Pausar envio a cada</span>
        <Select value={String(p.pauseEvery)} onValueChange={v => setP({ ...p, pauseEvery: Number(v) })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{PAUSE_EVERY.map(n => <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "mensagem enviada" : "mensagens enviadas"}</SelectItem>)}</SelectContent></Select></label>
      <label className="space-y-1"><span className="text-muted-foreground">Duração da pausa</span>
        <Select value={String(p.pauseSeconds)} onValueChange={v => setP({ ...p, pauseSeconds: Number(v) })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{PAUSE_SECONDS.map(n => <SelectItem key={n} value={String(n)}>{formatDuration(n)}</SelectItem>)}</SelectContent></Select></label>
    </div>
    {id && <div className="mt-2 flex items-center gap-3">
      <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); setMsg(""); try { await save({ data: { id: id!, ...p } }); setMsg("Velocidade salva. Vale para os próximos envios; ninguém recebe duas vezes."); onSaved?.(); } catch (e) { setMsg(e instanceof Error ? e.message : "Não foi possível salvar."); } finally { setBusy(false); } }}>Salvar velocidade</Button>
      {msg && <span className="text-muted-foreground">{msg}</span>}
    </div>}
    {p.min === 1 && <p className="mt-2 text-muted-foreground">Envios rápidos são indicados para clientes que já conversam com você. O número segue sujeito aos limites do WhatsApp.</p>}
  </div>;
}
