import { useState, useMemo } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { type Lead, type Stage, STAGES } from "@/lib/crm-types";
import { toast } from "sonner";
import { leadOrigin } from "@/lib/lead-attribution";

const currency = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function LeadListView({
  leads,
  stages = STAGES,
  onCardClick,
  onBulkDelete,
  selectedIds,
  onSelectionChange,
}: {
  leads: Lead[];
  stages?: Stage[];
  onCardClick: (l: Lead) => void;
  onBulkDelete: (ids: string[]) => Promise<void> | void;
  // Seleção compartilhada com o quadro (mantém a seleção ao alternar cartões/lista e libera as ações em massa).
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
}) {
  const [internal, setInternal] = useState<Set<string>>(new Set());
  const selected = selectedIds ? new Set(selectedIds) : internal;
  const setSelected = (next: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    const value = typeof next === "function" ? next(selected) : next;
    if (onSelectionChange) onSelectionChange([...value]); else setInternal(value);
  };
  const stageTitle = (id: string) => stages.find((s) => s.id === id)?.title ?? id;

  const allIds = useMemo(() => leads.map((l) => l.id), [leads]);
  const allSelected = selected.size > 0 && selected.size === leads.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    try {
      await onBulkDelete(ids);
      setSelected(new Set());
      toast.success(`${ids.length} lead(s) excluído(s)`);
    } catch { /* A ação existente já mostra o erro; mantém a seleção para nova tentativa. */ }
  };

  return (
    <div className="flex h-full flex-col">
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2 md:px-6">
          <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="mr-1.5 h-4 w-4" /> Excluir selecionados
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir leads selecionados?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação não pode ser desfeita. {selected.size} lead(s) serão removidos permanentemente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleBulkDelete}>Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b">
              <th className="w-10 px-4 py-3">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Selecionar todos"
                />
              </th>
              <th className="px-3 py-3 text-left font-medium">Nome</th>
              <th className="px-3 py-3 text-left font-medium">Empresa</th>
              <th className="px-3 py-3 text-left font-medium">Estágio</th>
              <th className="px-3 py-3 text-left font-medium">Origem</th>
              <th className="px-3 py-3 text-left font-medium">WhatsApp</th>
              <th className="px-3 py-3 text-right font-medium">Potencial</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const isSel = selected.has(l.id);
              return (
                <tr
                  key={l.id}
                  className={`border-b transition-colors hover:bg-muted/40 ${isSel ? "bg-muted/30" : ""}`}
                >
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={isSel} onCheckedChange={() => toggleOne(l.id)} aria-label={`Selecionar ${l.name}`} />
                  </td>
                  <td className="cursor-pointer px-3 py-2.5 font-medium" onClick={() => onCardClick(l)}>
                    {l.name || "—"}
                  </td>
                  <td className="cursor-pointer px-3 py-2.5 text-muted-foreground" onClick={() => onCardClick(l)}>
                    {l.company || "—"}
                  </td>
                  <td className="cursor-pointer px-3 py-2.5" onClick={() => onCardClick(l)}>
                    <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs">{stageTitle(l.stage)}</span>
                  </td>
                  <td className="cursor-pointer px-3 py-2.5 text-muted-foreground" onClick={() => onCardClick(l)}>
                    {leadOrigin(l)}
                  </td>
                  <td className="cursor-pointer px-3 py-2.5 text-muted-foreground" onClick={() => onCardClick(l)}>
                    {l.whatsapp || "—"}
                  </td>
                  <td className="cursor-pointer px-3 py-2.5 text-right font-medium" onClick={() => onCardClick(l)}>
                    {currency(l.potentialValue || 0)}
                  </td>
                </tr>
              );
            })}
            {leads.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Nenhum lead encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
