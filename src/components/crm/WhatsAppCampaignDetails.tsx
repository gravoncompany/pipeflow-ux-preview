import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getWhatsAppCampaignDetails } from "@/lib/campaigns.functions";
import { deliveryErrorText, whatsAppCampaignLabel } from "@/lib/whatsapp-campaigns";

const STATE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  accepted: { label: "Enviada", variant: "default" }, queued: { label: "Pendente", variant: "outline" }, reserved: { label: "Enviando", variant: "outline" },
  failed: { label: "Erro", variant: "destructive" }, unknown: { label: "Sem confirmação", variant: "secondary" }, cancelled: { label: "Não enviada", variant: "secondary" },
};
const FILTERS = [["all", "Todos"], ["accepted", "Enviadas"], ["pending", "Pendentes"], ["error", "Com erro"], ["cancelled", "Não enviadas"]] as const;

/** Detalhes da campanha: destinatários, status individual e motivo exato de cada falha. Somente leitura. */
export function WhatsAppCampaignDetails({ id }: { id: string }) {
  const [open, setOpen] = useState(false), [f, setF] = useState<(typeof FILTERS)[number][0]>("all");
  const fn = useServerFn(getWhatsAppCampaignDetails);
  const q = useQuery({ queryKey: ["wa-campaign-details", id], queryFn: () => fn({ data: { id } }), enabled: open, retry: false, refetchInterval: open ? 10000 : false });
  const d = q.data, c = d?.counts;
  const rows = (d?.recipients ?? []).filter((r) => f === "all" || (f === "pending" ? r.state === "queued" || r.state === "reserved" : f === "error" ? r.state === "failed" || r.state === "unknown" : r.state === f));
  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Ver detalhes</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{d?.campaign.name ?? "Campanha"}</DialogTitle><DialogDescription>{d ? `${whatsAppCampaignLabel(d.campaign.state, d.counts)} · instância ${d.campaign.instance || "—"}` : "Carregando…"}</DialogDescription></DialogHeader>
      {q.error && <p role="alert" className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Falha."}</p>}
      {c && <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">{[["Total", c.total], ["Enviadas", c.accepted], ["Pendentes", c.queued + c.sending], ["Com erro", c.failed + c.unknown], ["Não enviadas", c.cancelled]].map(([l, v]) => <div key={l} className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>}
      <div className="flex flex-wrap gap-1">{FILTERS.map(([k, l]) => <Button key={k} size="sm" variant={f === k ? "default" : "outline"} onClick={() => setF(k)}>{l}</Button>)}</div>
      <div className="rounded-lg border"><Table><TableHeader><TableRow><TableHead>Destinatário</TableHead><TableHead>WhatsApp</TableHead><TableHead>Status</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map((r) => { const s = STATE[r.state] ?? { label: r.state, variant: "outline" as const }; return <TableRow key={r.id}>
          <TableCell className="font-medium">{r.name || "—"}</TableCell><TableCell className="text-xs">{r.contact}</TableCell>
          <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
          <TableCell className="text-xs text-muted-foreground">{r.error ? deliveryErrorText(r.error) : r.state === "accepted" ? "Aceita pela Evolution (entrega não confirmada)" : ""}</TableCell>
        </TableRow>; })}
        {d && !rows.length && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">Nenhum destinatário neste filtro.</TableCell></TableRow>}</TableBody></Table></div>
      <p className="text-xs text-muted-foreground">Mensagens com erro ou sem confirmação nunca são reenviadas automaticamente.</p>
    </DialogContent></Dialog>
  </>;
}
