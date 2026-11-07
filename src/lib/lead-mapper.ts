import { type Lead, type StageId, type TagId } from "./crm-types";
import { businessLinks } from "./business-links";

// Maps DB row (snake_case) <-> Lead (camelCase)
export function rowToLead(r: any): Lead {
  return {
    id: r.id,
    pipelineId: r.pipeline_id ?? null,
    name: r.name ?? "",
    company: r.company ?? "",
    whatsapp: r.whatsapp ?? "",
    email: r.email ?? "",
    ...businessLinks(r.website ?? "", r.instagram ?? ""),
    investedTraffic: r.invested_traffic ?? "",
    revenue: r.revenue ?? "",
    employees: r.employees ?? "",
    source: r.source ?? "",
    utmSource: r.utm_source ?? "",
    utmMedium: r.utm_medium ?? "",
    utmCampaign: r.utm_campaign ?? "",
    utmContent: r.utm_content ?? "",
    utmTerm: r.utm_term ?? "",
    service: r.service ?? "",
    potentialValue: Number(r.potential_value ?? 0),
    closedValue: r.closed_value === null || r.closed_value === undefined ? null : Number(r.closed_value),
    closedValueConfirmedAt: r.closed_value_confirmed_at ?? null,
    owner: r.owner ?? "",
    entryDate: r.entry_date ?? new Date().toISOString().slice(0, 10),
    nextAction: r.next_action ?? "",
    nextActionDate: r.next_action_date ?? "",
    status: r.status ?? "",
    stage: (r.stage ?? "lead-novo") as StageId,
    tags: (r.tags ?? []) as TagId[],
    notes: r.notes ?? "",
    lastConversation: r.last_conversation ?? "",
    nextSteps: r.next_steps ?? "",
    history: (r.history ?? []) as Lead["history"],
  };
}

export function leadToRow(l: Lead) {
  return {
    id: l.id,
    ...(l.pipelineId !== undefined ? { pipeline_id: l.pipelineId } : {}),
    name: l.name,
    company: l.company,
    whatsapp: l.whatsapp,
    email: l.email,
    ...businessLinks(l.website, l.instagram),
    invested_traffic: l.investedTraffic,
    revenue: l.revenue,
    employees: l.employees,
    source: l.source,
    utm_source: l.utmSource ?? "",
    utm_medium: l.utmMedium ?? "",
    utm_campaign: l.utmCampaign ?? "",
    utm_content: l.utmContent ?? "",
    utm_term: l.utmTerm ?? "",
    service: l.service,
    potential_value: l.potentialValue,
    owner: l.owner,
    entry_date: l.entryDate,
    next_action: l.nextAction,
    next_action_date: l.nextActionDate || null,
    status: l.status,
    stage: l.stage,
    tags: l.tags,
    notes: l.notes,
    last_conversation: l.lastConversation,
    next_steps: l.nextSteps,
    history: l.history,
  };
}

export async function fireZapierWebhook(url: string, lead: Lead) {
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "lead.created",
        timestamp: new Date().toISOString(),
        lead,
      }),
    });
  } catch (e) {
    console.warn("Zapier webhook failed", e);
  }
}
