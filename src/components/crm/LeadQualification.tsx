import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Hourglass, Send, Sparkles } from "lucide-react";
import { statusBucket } from "@/lib/meta-capi-monitor";
import { getLeadQualification, listLeadQualifications } from "@/lib/lead-ai-qualification.functions";
import { metaEventLabel, qualificationLabel, stateExplanation } from "@/lib/lead-ai-qualification";

/** One shared query for every card on the board. */
export function useLeadQualificationStatuses() {
  const list = useServerFn(listLeadQualifications);
  const q = useQuery({ queryKey: ["lead-qualifications"], queryFn: () => list(), refetchInterval: 60_000, staleTime: 30_000, retry: false });
  return q.data?.authorized ? q.data.statuses : {};
}
export function useLeadMetaConversionStatuses() {
  const list = useServerFn(listLeadQualifications);
  const q = useQuery({ queryKey: ["lead-qualifications"], queryFn: () => list(), refetchInterval: 60_000, staleTime: 30_000, retry: false });
  return q.data?.authorized ? q.data.meta : {};
}

const META_TONE: Record<string, string> = { accepted: "text-success", error: "text-destructive", pending: "text-muted-foreground" };
/** Discreet card indicator for the Meta conversion of this lead. */
export function MetaConversionIndicator({ status }: { status: string | undefined }) {
  if (!status) return null;
  const tone = META_TONE[statusBucket(status)];
  return <span title={`Meta: ${metaEventLabel[status] ?? status}`} aria-label={`Conversão Meta: ${metaEventLabel[status] ?? status}`} className={`inline-flex items-center gap-0.5 text-[10px] ${tone}`}><Send className="size-3" />Meta</span>;
}

export function LeadQualificationBadge({ status }: { status: "em_analise" | "qualificado" | undefined }) {
  if (!status) return null;
  const qualified = status === "qualificado";
  return <span title="Avaliação automática da Pipeflow IA" className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${qualified ? "bg-success/15 text-success ring-1 ring-success/30" : "bg-muted text-muted-foreground ring-1 ring-border"}`}>
    {qualified ? <BadgeCheck className="size-3" /> : <Hourglass className="size-3" />}{qualificationLabel[status]}
  </span>;
}

const when = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "");

export function LeadQualificationSection({ leadId }: { leadId: string }) {
  const get = useServerFn(getLeadQualification);
  const q = useQuery({ queryKey: ["lead-qualification", leadId], queryFn: () => get({ data: { leadId } }), refetchInterval: 30_000, retry: false });
  const v = q.data?.authorized ? q.data.view : null;
  if (!v) return null;
  const hint = v.status === "em_analise" ? stateExplanation(v.state) || "Ainda não há evidência suficiente de interesse e adequação ao serviço." : "";
  return <section aria-label="Qualificação pela Pipeflow IA" className="rounded-xl border bg-card p-4">
    <div className="flex items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />Qualificação pela Pipeflow IA</p>
      <LeadQualificationBadge status={v.status} />
    </div>
    {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    {v.summary && <p className="mt-2 text-sm">{v.summary}</p>}
    {v.fitReason && v.status === "qualificado" && <p className="mt-2 text-sm"><span className="font-medium">Adequação: </span>{v.fitReason}</p>}
    {v.evidence.length > 0 && <ul className="mt-2 space-y-1">{v.evidence.map((e) => <li key={e.messageId} className="text-xs text-muted-foreground">Cliente: “{e.quote}”</li>)}</ul>}
    <p className="mt-2 text-[11px] text-muted-foreground">
      {v.qualifiedAt ? `Qualificado em ${when(v.qualifiedAt)}` : v.assessedAt ? `Última avaliação em ${when(v.assessedAt)}` : ""}
      {v.meta ? ` · Meta: ${metaEventLabel[v.meta.status] ?? v.meta.status}` : ""}
    </p>
  </section>;
}
