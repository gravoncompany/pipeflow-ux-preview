import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { saveReceiptSchedule } from "@/lib/receipt-control.functions";
import { scheduleDates, type ReceiptCharge, type ReceiptConfig } from "@/lib/receipt-control";
import { currency } from "@/lib/revenue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Schedule = { id: string; client_id: string; project_id: string | null; config: ReceiptConfig; revision: number };

/** Organizar com Pipeflow IA: análise determinística das configurações existentes.
 * Nunca inventa valores ou vencimentos — apenas compara o contrato com as cobranças já cadastradas
 * e prepara, com prévia, os vencimentos que faltam. Nada é marcado como recebido. */
export function ReceiptOrganizeDialog({ schedules, charges, names, onClose }: { schedules: Schedule[]; charges: ReceiptCharge[]; names: Map<string, string>; onClose: () => void }) {
 const fn = useServerFn(saveReceiptSchedule), qc = useQueryClient();
 const [confirmed, setConfirmed] = useState(false), [done, setDone] = useState<string[]>([]);
 const analysis = useMemo(() => schedules.map(s => {
  const existing = new Set(charges.filter(c => c.receipt_schedule_id === s.id && c.status !== "cancelado").map(c => c.due_date));
  const missing = scheduleDates(s.config).filter(d => !existing.has(d));
  return { schedule: s, missing };
 }).filter(a => a.missing.length > 0), [schedules, charges]);
 const mutation = useMutation({
  mutationFn: async () => {
   const created: string[] = [];
   for (const a of analysis) {
    const r = await fn({ data: { id: a.schedule.id, revision: a.schedule.revision, clientId: a.schedule.client_id, projectId: a.schedule.project_id, config: a.schedule.config, generate: true, operation: crypto.randomUUID(), confirmed: true } });
    if (r.id) created.push(a.schedule.id);
   }
   return created;
  },
  onSuccess: async created => { setDone(created); await qc.invalidateQueries({ queryKey: ["receipt-control"] }); await qc.invalidateQueries({ queryKey: ["finance-management"] }); },
 });
 const totalMissing = analysis.reduce((n, a) => n + a.missing.length, 0);
 return <Dialog open onOpenChange={v => { if (!v) onClose(); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="size-5 text-primary" />Organizar com Pipeflow IA</DialogTitle><DialogDescription>A análise compara contratos e cobranças existentes. Nenhum valor ou vencimento é inventado, nenhuma cobrança é duplicada e nenhum pagamento é marcado como recebido.</DialogDescription></DialogHeader>
 {done.length ? <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">Organização concluída: {done.length} configuração(ões) atualizadas com as cobranças que faltavam.</p> : !analysis.length ? <p className="py-6 text-center text-sm text-muted-foreground">Tudo organizado: não há vencimentos contratados faltando nas cobranças cadastradas.</p> : <>
  <p className="text-sm">{totalMissing} vencimento(s) previstos em contrato ainda não cadastrados:</p>
  <div className="divide-y rounded-md border">{analysis.map(a => <div key={a.schedule.id} className="p-3 text-sm"><p className="font-medium">{names.get(a.schedule.client_id) ?? "Cliente"} · {a.schedule.config.description} · {currency(a.schedule.config.amount / 100)} · {a.schedule.config.frequency === "quinzenal_fixa" ? "Quinzenal · datas fixas" : a.schedule.config.frequency}</p><p className="mt-1 text-xs text-muted-foreground">{a.missing.length} vencimento(s) faltando: {a.missing.slice(0, 12).map(d => d.split("-").reverse().join("/")).join(", ")}{a.missing.length > 12 ? ` e mais ${a.missing.length - 12}` : ""}</p></div>)}</div>
  <label className="flex gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} />Confirmei a prévia e autorizo cadastrar somente os vencimentos listados.</label>
  {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
  <Button disabled={!confirmed || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Organizando…" : "Cadastrar vencimentos faltantes"}</Button>
 </>}
 </DialogContent></Dialog>;
}
