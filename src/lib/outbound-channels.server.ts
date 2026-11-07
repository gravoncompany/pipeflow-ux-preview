// Leitura das abas E-mail/WhatsApp da Prospecção Outbound. Chamadores DEVEM ter verificado a sessão completa do CRM.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { phoneKey } from "./phone";
import { outboundChannels, type Dated, type SentEmail, type SentWhatsApp } from "./outbound-channels";

const chunks = <T,>(xs: T[], n = 200) => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

async function byIds<T>(ids: string[], q: (part: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunks(ids)) {
    const r = await q(part);
    if (r.error) throw new Error("Não foi possível carregar os dados do Outbound.");
    rows.push(...(r.data ?? []));
  }
  return rows;
}

export async function loadOutboundChannels(from: string, to: string) {
  const db = supabaseAdmin;
  const pipes = await db.from("sales_pipelines").select("id,name").eq("archived", false);
  if (pipes.error) throw new Error("Não foi possível carregar os dados do Outbound.");
  const outboundId = (pipes.data ?? []).find((p) => String(p.name).trim().toLowerCase() === "outbound")?.id ?? null;
  if (!outboundId) return { found: false as const };

  const leadsR = await db.from("leads").select("id,stage,entry_date,whatsapp").eq("pipeline_id", outboundId).limit(5000);
  if (leadsR.error) throw new Error("Não foi possível carregar os dados do Outbound.");
  const leads = leadsR.data ?? [];
  const ids = leads.map((l) => l.id as string);

  const [b2b, flowOut, flowIn, campaign, runs, diag, inbox] = await Promise.all([
    byIds<any>(ids, (p) => db.from("b2b_ai_email_items").select("send_lead_id,sent_at,provider_message_id").eq("send_state", "accepted").in("send_lead_id", p)),
    byIds<any>(ids, (p) => db.from("crm_email_flow_messages").select("lead_id,created_at,provider_message_id").eq("direction", "out").in("state", ["accepted", "sent"]).in("lead_id", p)),
    byIds<any>(ids, (p) => db.from("crm_email_flow_messages").select("lead_id,created_at").eq("direction", "in").in("lead_id", p)),
    byIds<any>(ids, (p) => db.from("crm_campaign_deliveries").select("lead_id,created_at,scheduled_at,provider_message_id").eq("state", "accepted").in("lead_id", p)),
    byIds<any>(ids, (p) => db.from("crm_automation_runs").select("lead_id,source,clicks,last_click_at,reply_at,form_at").neq("source", "test").in("lead_id", p)),
    byIds<any>(ids, (p) => db.from("crm_diagnosis_submissions").select("lead_id,received_at").in("lead_id", p)),
    byIds<any>(ids, (p) => db.from("crm_email_inbox").select("lead_id,received_at").in("lead_id", p)),
  ]);

  // E-mails aceitos pelo Brevo, um por messageId.
  const seen = new Set<string>();
  const emails: SentEmail[] = [];
  const push = (leadId: string | null, at: string | null, messageId: string | null) => {
    if (!leadId || !at) return;
    if (messageId) { if (seen.has(messageId)) return; seen.add(messageId); }
    emails.push({ leadId, at, messageId });
  };
  for (const r of b2b) push(r.send_lead_id, r.sent_at, r.provider_message_id);
  for (const r of flowOut) push(r.lead_id, r.created_at, r.provider_message_id);
  const now = new Date().toISOString();
  for (const r of campaign) { const at = r.scheduled_at ?? r.created_at; if (at <= now) push(r.lead_id, at, r.provider_message_id); }

  const periodIds = emails.filter((e) => e.messageId && e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= addDay(to)).map((e) => e.messageId!) ;
  let emailEvents: Awaited<ReturnType<typeof import("./brevo.server").brevoMessageEvents>> = { byMessage: new Map(), failed: 0 };
  if (periodIds.length) {
    try { const { brevoMessageEvents } = await import("./brevo.server"); emailEvents = await brevoMessageEvents(periodIds); }
    catch { console.error("outbound_brevo_events_unavailable"); emailEvents = null; }
  }

  const diagnosisClicks: Dated[] = runs.filter((r) => r.clicks > 0 && r.last_click_at).map((r) => ({ leadId: r.lead_id, at: r.last_click_at }));
  const forms: Dated[] = [
    ...runs.filter((r) => r.form_at).map((r) => ({ leadId: r.lead_id, at: r.form_at })),
    ...diag.filter((r) => r.lead_id).map((r) => ({ leadId: r.lead_id, at: r.received_at })),
  ];
  const emailReplies: Dated[] = [
    ...inbox.map((r) => ({ leadId: r.lead_id, at: r.received_at })),
    ...flowIn.map((r) => ({ leadId: r.lead_id, at: r.created_at })),
    ...runs.filter((r) => r.reply_at).map((r) => ({ leadId: r.lead_id, at: r.reply_at })),
  ];

  // WhatsApp (Evolution): só números que identificam um único card do Outbound.
  const keyLeads = new Map<string, string[]>();
  for (const l of leads) {
    const k = l.whatsapp ? phoneKey(String(l.whatsapp)) : "";
    if (k.length >= 10) keyLeads.set(k, [...(keyLeads.get(k) ?? []), l.id as string]);
  }
  const unique = [...keyLeads].filter(([, v]) => v.length === 1);
  const leadOfKey = new Map(unique.map(([k, v]) => [k, v[0]]));
  const msgs = await byIds<any>([...leadOfKey.keys()], (p) => db.from("whatsapp_messages").select("phone_key,from_me,sent_at,delivered_at,read_at").in("phone_key", p).limit(20000));
  const waOut: SentWhatsApp[] = [];
  const waIn: Dated[] = [];
  for (const m of msgs) {
    const leadId = leadOfKey.get(m.phone_key);
    if (!leadId || !m.sent_at) continue;
    if (m.from_me) waOut.push({ leadId, at: m.sent_at, delivered: Boolean(m.delivered_at), read: Boolean(m.read_at) });
    else waIn.push({ leadId, at: m.sent_at });
  }

  const result = outboundChannels({
    leads: leads.map((l) => ({ id: l.id as string, stage: l.stage as string, entryDate: l.entry_date as string })),
    emails, emailEvents, diagnosisClicks, forms, emailReplies, waOut, waIn,
  }, from, to);
  return { found: true as const, ...result, ambiguousPhones: [...keyLeads].filter(([, v]) => v.length > 1).length };
}

function addDay(d: string) { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }
