import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Building2, Calendar, DollarSign, Briefcase, MapPin, BadgeCheck, Pencil } from "lucide-react";
import { leadOrigin } from "@/lib/lead-attribution";
import type { Lead } from "@/lib/crm-types";
import { useTags } from "@/hooks/use-tags";
import { Checkbox } from "@/components/ui/checkbox";
import { useOutboundAutoTags } from "@/hooks/use-outbound-auto-tags";
import { AUTO_TAGS } from "@/lib/outbound-auto-tags";
import { LeadQualificationBadge, MetaConversionIndicator, useLeadMetaConversionStatuses, useLeadQualificationStatuses } from "./LeadQualification";
import { OutboundClickActivity } from './OutboundClickActivity';

const currency = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function LeadCard({ lead, onClick, selected, onSelect, onClosedValue }: { lead: Lead; onClick: () => void; selected?: boolean; onSelect?: (checked: boolean) => void; onClosedValue?: () => void }) {
  const { tags: allTags } = useTags();
  const qualification = useLeadQualificationStatuses()[lead.id];
  const metaStatus = useLeadMetaConversionStatuses()[lead.id];
  const autoTags = useOutboundAutoTags()[lead.id] ?? [];
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { stage: lead.stage },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // dnd-kit handles drag; click only fires on a real click
        if (!isDragging) onClick();
        e.stopPropagation();
      }}
      className="surface surface-hover lab-fade group relative cursor-grab overflow-hidden rounded-xl border border-border/80 bg-card p-3 active:cursor-grabbing active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-2">
        {onSelect && <span onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><Checkbox aria-label={`Selecionar ${lead.name}`} checked={selected} onCheckedChange={v=>onSelect(v===true)} /></span>}
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-chart-2/20 text-[11px] font-semibold text-primary ring-1 ring-primary/15 transition-transform duration-300 group-hover:scale-105" aria-hidden>{lead.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")}</span>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-sm text-card-foreground truncate">{lead.name}</h4>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground truncate">
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.company}</span>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-highlight/10 px-1.5 py-0.5 text-[10px] font-semibold text-highlight-foreground ring-1 ring-highlight/25">
          {currency(lead.potentialValue)}
        </span>
      </div>

      <div className="mt-2 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" title={leadOrigin(lead)}>
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">Origem: {leadOrigin(lead)}</span>
      </div>
      {lead.stage === "fechado" && (lead.closedValue !== null && lead.closedValue !== undefined
        ? <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-success/10 px-2 py-1 text-[11px] ring-1 ring-success/25">
            <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-foreground"><BadgeCheck className="h-3 w-3 shrink-0 text-success" />Valor fechado: {currency(lead.closedValue)}</span>
            {onClosedValue && <button type="button" aria-label="Editar valor fechado" title="Editar valor fechado" className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClosedValue(); }}><Pencil className="h-3 w-3" /></button>}
          </div>
        : onClosedValue
          ? <button type="button" className="mt-2 w-full rounded-md border border-dashed border-primary/40 px-2 py-1 text-left text-[11px] font-medium text-primary hover:bg-primary/5"
              onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClosedValue(); }}>Confirmar valor fechado</button>
          : <p className="mt-2 text-[11px] text-muted-foreground">Valor fechado a confirmar</p>)}
      {lead.utmCampaign && <p className="mt-1 truncate text-[11px] text-muted-foreground" title={lead.utmCampaign}>Campanha: {lead.utmCampaign}</p>}

      {(lead.revenue || lead.service) && (
        <div className="mt-2 flex flex-col gap-1 text-[11px] text-muted-foreground">
          {lead.revenue && (
            <span className="inline-flex items-center gap-1 truncate">
              <DollarSign className="h-3 w-3 shrink-0" />
              <span className="truncate">Faturamento: {lead.revenue}</span>
            </span>
          )}
          {lead.service && (
            <span className="inline-flex items-center gap-1 truncate">
              <Briefcase className="h-3 w-3 shrink-0" />
              <span className="truncate">Segmento: {lead.service}</span>
            </span>
          )}
        </div>
      )}

      {(qualification || metaStatus) && <div className="mt-2 flex items-center gap-2"><LeadQualificationBadge status={qualification} /><MetaConversionIndicator status={metaStatus} /></div>}
      <OutboundClickActivity lead={lead} />

      {autoTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="Etiquetas automáticas">
          {AUTO_TAGS.filter((t) => autoTags.includes(t.id)).map((t) => (
            <span key={t.id} title="Etiqueta automática (eventos reais)" className="rounded-full border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t.label}</span>
          ))}
        </div>
      )}

      {lead.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {lead.tags.map((t) => {
            const tag = allTags.find((x) => x.id === t);
            if (!tag) return null;
            return (
              <span
                key={t}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.label}
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-end text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" /> {lead.nextActionDate || lead.entryDate}
        </span>
      </div>
    </div>
  );
}
