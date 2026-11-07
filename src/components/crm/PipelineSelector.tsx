import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAIN_PIPELINE, type Pipeline } from "@/lib/pipelines";
import { CommercialAgentButton } from "./CommercialAgentSettings";

type Props = {
  pipelines: Pipeline[]; selected: string; loading: boolean;
  onSelect: (id: string) => void;
  onSave: (name: string, id?: string) => Promise<boolean>;
};

export function PipelineSelector({ pipelines, selected, loading, onSelect, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const current = pipelines.find((p) => p.id === selected);
  return <div className="flex min-w-0 items-center gap-2">
    <Select value={selected} onValueChange={onSelect} disabled={loading || saving}>
      <SelectTrigger aria-label="Selecionar funil" className="w-[220px] max-w-full font-semibold"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={MAIN_PIPELINE}>Funil principal</SelectItem>
        {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
    <Button variant="outline" size="icon" aria-label="Criar funil" title="Criar funil" disabled={loading} onClick={() => { setName(""); setEditing(undefined); setOpen(true); }}><Plus className="size-4" /></Button>
    {current && <Button variant="ghost" size="icon" aria-label="Renomear funil" title="Renomear funil" onClick={() => { setName(current.name); setEditing(current.id); setOpen(true); }}><Pencil className="size-4" /></Button>}
    {(current || selected === MAIN_PIPELINE) && !loading && <CommercialAgentButton key={selected} pipelineId={current ? current.id : null} pipelineName={current?.name ?? "Funil principal"} />}
    <Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Renomear funil" : "Novo funil de vendas"}</DialogTitle></DialogHeader>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim() || saving) return;
          setSaving(true);
          try { if (await onSave(name.trim(), editing)) setOpen(false); }
          finally { setSaving(false); }
        }} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="pipeline-name">Nome do funil</Label><Input id="pipeline-name" autoFocus placeholder="Ex: Vendas de consultoria" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? "Salvando…" : editing ? "Salvar" : "Criar funil"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}