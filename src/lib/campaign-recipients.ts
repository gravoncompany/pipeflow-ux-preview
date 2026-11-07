// Shared, browser-safe helpers to turn registered clients and selected
// conversations into campaign recipients. Campaigns stay lead-based: a client or
// conversation becomes a recipient only through an existing CRM card, so nothing
// here creates or duplicates records.
import { phoneKey } from "./phone";

export type CampaignClientRow = { id: string; lead_id: string | null; trade_name: string; contact_name: string; whatsapp: string; phone: string; status: string };
export type CampaignLeadRow = { id: string; whatsapp: string };
export type CampaignClient = { clientId: string; name: string; company: string; whatsapp: string; leadId: string | null; note: string };

const keyOf = (raw: string) => { const k = phoneKey(raw || ""); return k.length >= 10 ? k : ""; };

/** Maps each client to its CRM card: the linked card first, else the single card with the same WhatsApp. */
export function campaignClients(clients: CampaignClientRow[], leads: CampaignLeadRow[]): CampaignClient[] {
  const byKey = new Map<string, string[]>();
  for (const l of leads) { const k = keyOf(l.whatsapp); if (k) byKey.set(k, [...(byKey.get(k) ?? []), l.id]); }
  return clients
    .filter((c) => c.status !== "encerrado")
    .map((c) => {
      const whatsapp = c.whatsapp || c.phone;
      const base = { clientId: c.id, name: c.contact_name || c.trade_name, company: c.trade_name, whatsapp };
      if (c.lead_id) return { ...base, leadId: c.lead_id, note: "" };
      const k = keyOf(whatsapp);
      const matches = k ? byKey.get(k) ?? [] : [];
      if (matches.length === 1) return { ...base, leadId: matches[0], note: "" };
      return { ...base, leadId: null, note: matches.length > 1 ? "Mais de um card com este WhatsApp" : "Sem card no CRM" };
    })
    .sort((a, b) => a.company.localeCompare(b.company, "pt-BR"));
}

/** Unique lead ids for a set of clients; clients without a CRM card are left out. */
export function clientLeadIds(clients: CampaignClient[]): string[] {
  return [...new Set(clients.map((c) => c.leadId).filter((id): id is string => Boolean(id)))];
}

export type ConversationKind = "all" | "clientes" | "leads" | "fora";
export type FilterableConversation = { phoneKey: string; leadId: string | null; clientId: string | null };

/** Conversation filters shared by the Cards and List views. */
export function filterConversations<T extends FilterableConversation>(convs: T[], kind: ConversationKind, tag: string, tagsByLead: Map<string, string[]>): T[] {
  return convs.filter((c) => {
    if (kind === "clientes" && !c.clientId) return false;
    if (kind === "leads" && (!c.leadId || c.clientId)) return false;
    if (kind === "fora" && (c.leadId || c.clientId)) return false;
    if (tag !== "all" && !(c.leadId && (tagsByLead.get(c.leadId) ?? []).includes(tag))) return false;
    return true;
  });
}

/** Lead ids of the selected conversations (deduplicated) plus how many have no CRM card. */
export function conversationCampaignLeads(convs: FilterableConversation[], selected: Set<string>) {
  const picked = convs.filter((c) => selected.has(c.phoneKey));
  const leadIds = [...new Set(picked.map((c) => c.leadId).filter((id): id is string => Boolean(id)))];
  return { leadIds, outside: picked.filter((c) => !c.leadId).length };
}

export const CAMPAIGN_SELECTION_KEY = "pipeflow-campaign-selection";
