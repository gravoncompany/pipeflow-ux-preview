import { LeadDetailSheet } from "./LeadDetailSheet";
import { useLeads } from "@/hooks/use-leads";
import { usePipelines } from "@/hooks/use-pipelines";

/** Abre o card completo de um lead pelo id (usado nos painéis de acompanhamento). Só carrega quando há um id. */
export function LeadCardOpener({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  if (!leadId) return null;
  return <Opener leadId={leadId} onClose={onClose} />;
}

function Opener({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { leads, loading, upsertLead, deleteLead } = useLeads();
  const { pipelines } = usePipelines(true);
  const lead = leads.find((l) => l.id === leadId) ?? null;
  if (loading || !lead) return null;
  return <LeadDetailSheet open lead={lead} isNew={false} onOpenChange={(o) => { if (!o) onClose(); }} onSave={(l) => void upsertLead(l)} onDelete={deleteLead}
    pipelineId={lead.pipelineId} pipelineStages={pipelines.find((p) => p.id === lead.pipelineId)?.stages} />;
}
