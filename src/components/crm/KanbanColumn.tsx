import { useDroppable } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { Lead, StageId } from "@/lib/crm-types";
import { LeadCard } from "./LeadCard";
import { Checkbox } from "@/components/ui/checkbox";

const currency = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function KanbanColumn({
  stageId,
  title,
  leads,
  onCardClick,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
  onDelete,
  selectedIds,
  onSelect,
  onSelectColumn,
  onClosedValue,
}: {
  stageId: StageId;
  title: string;
  leads: Lead[];
  onCardClick: (lead: Lead) => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onDelete?: () => void;
  selectedIds?: string[];
  onSelect?: (id: string, checked: boolean) => void;
  onSelectColumn?: (ids: string[], checked: boolean) => void;
  onClosedValue?: (lead: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  const total = leads.reduce((s, l) => s + (l.potentialValue || 0), 0);

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-2xl bg-muted/40 p-2">
      <div className="px-2 pb-2 pt-1">
        <div className="flex items-center justify-between gap-1">
          {onSelectColumn && <Checkbox aria-label={`Selecionar coluna ${title}`} checked={leads.length>0&&leads.every(l=>selectedIds?.includes(l.id))} disabled={!leads.length} onCheckedChange={v=>onSelectColumn(leads.map(l=>l.id),v===true)} />}
          <h3 className="flex-1 truncate text-sm font-semibold text-foreground">{title}</h3>
          <div className="flex items-center gap-0.5 opacity-60 transition-opacity hover:opacity-100">
            {onMoveLeft && (
              <button
                onClick={onMoveLeft}
                disabled={!canMoveLeft}
                title="Mover para a esquerda"
                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            )}
            {onMoveRight && (
              <button
                onClick={onMoveRight}
                disabled={!canMoveRight}
                title="Mover para a direita"
                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                title="Excluir coluna"
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <span className="ml-1 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
              {leads.length}
            </span>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{currency(total)}</p>
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-1 flex-col gap-2 rounded-xl p-1.5 transition-colors ${
          isOver ? "bg-primary/10 ring-2 ring-primary/40" : ""
        }`}
        style={{ minHeight: 100 }}
      >
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onClick={() => onCardClick(lead)} selected={selectedIds?.includes(lead.id)} onSelect={onSelect?checked=>onSelect(lead.id,checked):undefined} onClosedValue={onClosedValue ? () => onClosedValue(lead) : undefined} />
        ))}
        {leads.length === 0 && (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground/60">
            Arraste leads aqui
          </div>
        )}
      </div>
    </div>
  );
}
