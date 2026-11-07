import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmLeadClosedValue } from "@/lib/crm-leads.functions";
import type { Lead } from "@/lib/crm-types";
import { currency } from "@/lib/revenue";

/** Confirma ou corrige o Valor fechado de um card em Fechado, sugerindo o valor potencial. */
export function ClosedValueDialog({ lead, onDone }: { lead: Lead | null; onDone: (saved: boolean) => void | Promise<void> }) {
  const confirm = useServerFn(confirmLeadClosedValue);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (lead) setValue(String(lead.closedValue ?? lead.potentialValue ?? 0));
  }, [lead]);
  const amount = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000_000;
  const editing = lead?.closedValue !== null && lead?.closedValue !== undefined;

  const save = async () => {
    if (!lead || !valid) return;
    setSaving(true);
    try {
      await confirm({ data: { id: lead.id, value: Math.round(amount * 100) / 100 } });
      toast.success(`Valor fechado ${editing ? "atualizado" : "confirmado"}: ${currency(amount)}`);
      await onDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível confirmar o valor fechado.");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={lead !== null} onOpenChange={(open) => { if (!open && !saving) void onDone(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar valor fechado" : "Confirmar valor fechado"} — {lead?.name || "Sem nome"}</DialogTitle>
          <DialogDescription>
            Valor potencial do card: <strong>{currency(lead?.potentialValue ?? 0)}</strong>. Confirme ou corrija o valor negociado.
            O recebimento continua sendo registrado no Financeiro.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="closed-value">Valor fechado (R$)</Label>
          <Input id="closed-value" inputMode="decimal" type="number" min={0} step="0.01" autoFocus value={value}
            onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
          {!valid && <p className="text-xs text-destructive">Informe um valor igual ou maior que zero.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => void onDone(false)}>{editing ? "Cancelar" : "Confirmar depois"}</Button>
          <Button disabled={!valid || saving} onClick={() => void save()}>{saving ? "Salvando…" : editing ? "Salvar valor" : "Confirmar valor"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
