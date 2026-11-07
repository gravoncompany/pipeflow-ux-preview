import { parseEvolutionCall, callText } from "./lead-interactions";
import { sameWhatsAppNumber } from "./phone";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function processEvolutionCalls(instance: string, values: unknown[]) {
  // This legacy CRM has one tenant. Additional companies must not be inferred from lead.company (customer name).
  const { data: channels, error: channelError } = await supabaseAdmin.from("portal_admin_channels").select("company_key").eq("instance", instance);
  if (channelError) throw new Error("call_channel_read_failed");
  if (!channels?.length || channels.some(c => c.company_key !== "crm:1")) { console.warn("call_ignored_unbound_instance"); return; }
  const { data: leads, error } = await supabaseAdmin.from("leads").select("id,whatsapp");
  if (error) throw new Error("call_leads_read_failed");
  for (const value of values) {
    const c = parseEvolutionCall(value);
    if (!c) { console.warn("call_payload_unsupported", { instance, fields: value && typeof value === "object" ? Object.keys(value).slice(0, 20) : [] }); continue; }
    const matches = !c.group && /^\d{10,15}@s\.whatsapp\.net$/.test(c.jid) ? (leads ?? []).filter(l => sameWhatsAppNumber(l.whatsapp, c.jid)) : [];
    const lead = matches.length === 1 ? matches[0] : null;
    const { error: receiptError } = await supabaseAdmin.from("whatsapp_call_receipts").upsert({ instance, call_id: c.id, company_key: "crm:1", contact_jid: c.jid, state: c.state, occurred_at: c.date || null, direction: c.direction, result: c.result, lead_id: lead?.id ?? null, received_at: new Date().toISOString() }, { onConflict: "instance,call_id" });
    if (receiptError) throw new Error("call_receipt_save_failed");
    console.info("call_event_received", { instance, state: c.state, matched: Boolean(lead), result: c.result, hasTimestamp: Boolean(c.date) });
    if (!lead) continue; // Ambiguity and LID without verified PN mapping fail closed.
    const { error: saveError } = await supabaseAdmin.rpc("persist_lead_interaction", { p_lead: lead.id, p_instance: instance, p_call_id: c.id, p_company: "crm:1", p_entry: { id: `call:${instance}:${c.id}`, date: c.date, text: callText(c.direction, c.result), kind: "whatsapp_call", source: "evolution", result: c.result, direction: c.direction, state: c.state, instance } });
    if (saveError) throw new Error("call_history_save_failed");
  }
}