import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bulkMoveCrmLeads } from "@/lib/crm-leads.functions";
import { MAIN_PIPELINE, OUTBOUND_STAGES, type Pipeline } from "@/lib/pipelines";
import type { Lead, Stage } from "@/lib/crm-types";
import { chunk } from "@/lib/bulk-actions";

const isOutbound = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase() === "outbound";

export function BulkMoveDialog({ open, onOpenChange, leads, pipelines, mainStages, currentPipeline, createPipeline, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; leads: Lead[]; pipelines: Pipeline[]; mainStages: Stage[]; currentPipeline: string;
  createPipeline: (input: { name: string; stages: Stage[] }) => Promise<Pipeline | null>; onDone: (movedIds: string[]) => Promise<void> | void;
}) {
  const move = useServerFn(bulkMoveCrmLeads);
  const [pipelineId, setPipelineId] = useState(currentPipeline), [stageId, setStageId] = useState("");
  const [working, setWorking] = useState(false), [result, setResult] = useState<{ moved: number; unchanged: number; failed: { id: string; reason: string }[] } | null>(null), [err, setErr] = useState("");
  const options = [{ id: MAIN_PIPELINE, name: "Funil principal", stages: mainStages }, ...pipelines];
  const target = options.find(p => p.id === pipelineId);
  const stages = (target?.stages ?? []).filter(s => s.id !== "fechado");
  const hasOutbound = pipelines.some(p => isOutbound(p.name));
  const names = new Map(leads.map(l => [l.id, l.company || l.name || "Card"]));

  async function confirm() {
    if (!target || !stageId) return;
    const stage = stages.find(s => s.id === stageId);
    setWorking(true); setErr(""); setResult(null);
    const total = { moved: 0, unchanged: 0, failed: [] as { id: string; reason: string }[] }; const movedIds: string[] = [];
    try {
      for (const ids of chunk(leads.map(l => l.id), 40)) {
        try {
          const r = await move({ data: { ids, pipelineId: pipelineId === MAIN_PIPELINE ? null : pipelineId, stage: stageId, stageTitle: stage?.title ?? stageId, pipelineName: target.name } });
          total.moved += r.moved; total.unchanged += r.unchanged; total.failed.push(...r.failed);
          const failedIds = new Set(r.failed.map(f => f.id)); movedIds.push(...ids.filter(id => !failedIds.has(id)));
        } catch (e) { const reason = e instanceof Error ? e.message : "falha na movimentação"; total.failed.push(...ids.map(id => ({ id, reason }))); }
      }
      setResult(total);
      await onDone(movedIds);
    } finally { setWorking(false); }
  }
  async function createOutbound() {
    setErr("");
    const saved = await createPipeline({ name: "Outbound", stages: OUTBOUND_STAGES });
    if (saved) { setPipelineId(saved.id); setStageId(""); } else setErr("Não foi possível criar o funil Outbound.");
  }
  return <Dialog open={open} onOpenChange={v => { if (!working) { onOpenChange(v); if (!v) { setResult(null); setStageId(""); } } }}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Mover em massa</DialogTitle><DialogDescription>{leads.length} card(s) selecionado(s). Dados, contatos, etiquetas e histórico são preservados; a movimentação fica registrada no histórico de cada card.</DialogDescription></DialogHeader>
      {!result ? <div className="space-y-3 text-sm">
        <label className="block">Funil de destino<select className="mt-1 w-full rounded-md border bg-background px-2 py-2" value={pipelineId} onChange={e => { setPipelineId(e.target.value); setStageId(""); }}>{options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {!hasOutbound && <p className="text-xs text-muted-foreground">Funil Outbound ainda não existe. <button type="button" className="text-primary underline" onClick={() => void createOutbound()}>Criar funil Outbound</button> (etapas: {OUTBOUND_STAGES.map(s => s.title).join(", ")}).</p>}
        <label className="block">Etapa de destino<select className="mt-1 w-full rounded-md border bg-background px-2 py-2" value={stageId} onChange={e => setStageId(e.target.value)}><option value="">Escolha a etapa…</option>{stages.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <p className="text-xs text-muted-foreground">“Fechado” não aparece aqui: fechar uma venda exige a classificação feita no próprio card.</p>
        {err && <p role="alert" className="text-destructive">{err}</p>}
      </div> : <div className="space-y-2 text-sm" role="status">
        <p><strong>{result.moved}</strong> movido(s) · {result.unchanged} já estava(m) no destino · {result.failed.length} não movido(s).</p>
        {result.failed.length > 0 && <ul className="max-h-40 list-disc overflow-auto pl-5 text-xs text-muted-foreground">{result.failed.slice(0, 50).map(f => <li key={f.id}>{names.get(f.id) ?? f.id}: {f.reason} (estado anterior preservado)</li>)}</ul>}
      </div>}
      <DialogFooter>{!result ? <><Button variant="ghost" disabled={working} onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={!stageId || working || !leads.length} onClick={() => void confirm()}>{working ? "Movendo…" : `Confirmar movimentação (${leads.length})`}</Button></> : <Button onClick={() => { onOpenChange(false); setResult(null); setStageId(""); }}>Fechar</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
