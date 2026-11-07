// Browser-safe: decides whether a registered client already has a CRM card,
// and which unlinked cards might be the same company (for manual linking only).
import { phoneKey } from "./phone";

export type LinkClientRow = { id: string; lead_id: string | null; trade_name: string; contact_name: string; phone: string; whatsapp: string; email: string };
export type LinkLeadRow = { id: string; name: string; company: string; whatsapp: string; email: string; stage: string; pipeline_id: string | null };
export type CardCandidate = { leadId: string; name: string; company: string; whatsapp: string; stage: string; pipelineId: string | null; reasons: string[] };
export type ClientCardLink =
  | { clientId: string; state: "linked"; leadId: string; pipelineId: string | null }
  | { clientId: string; state: "unlinked"; candidates: CardCandidate[] };

const phone = (raw: string) => { const k = phoneKey(raw || ""); return k.length >= 10 ? k : ""; };
const mail = (raw: string) => (raw || "").trim().toLowerCase();
const norm = (raw: string) => (raw || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Never links anything by itself: only the stored link counts; matches are suggestions. */
export function clientCardLinks(clients: LinkClientRow[], leads: LinkLeadRow[]): ClientCardLink[] {
  const linked = new Set(clients.map((c) => c.lead_id).filter(Boolean) as string[]);
  const byId = new Map(leads.map((l) => [l.id, l]));
  const free = leads.filter((l) => !linked.has(l.id));
  return clients.map((c) => {
    if (c.lead_id) return { clientId: c.id, state: "linked" as const, leadId: c.lead_id, pipelineId: byId.get(c.lead_id)?.pipeline_id ?? null };
    const phones = new Set([phone(c.whatsapp), phone(c.phone)].filter(Boolean));
    const email = mail(c.email);
    const company = norm(c.trade_name);
    const candidates: CardCandidate[] = [];
    for (const l of free) {
      const reasons: string[] = [];
      if (phones.size && phones.has(phone(l.whatsapp))) reasons.push("mesmo WhatsApp");
      if (email && email === mail(l.email)) reasons.push("mesmo e-mail");
      if (company.length >= 3 && company === norm(l.company)) reasons.push("mesma empresa");
      if (reasons.length) candidates.push({ leadId: l.id, name: l.name, company: l.company, whatsapp: l.whatsapp, stage: l.stage, pipelineId: l.pipeline_id, reasons });
    }
    return { clientId: c.id, state: "unlinked" as const, candidates };
  });
}
