// Chamadores DEVEM ter verificado a sessão completa do CRM.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { outboundAutoTags } from "./outbound-auto-tags";

const fail = () => new Error("Não foi possível carregar as etiquetas automáticas.");

export async function loadOutboundAutoTags() {
  const db = supabaseAdmin;
  const pipes = await db.from("sales_pipelines").select("id,name").eq("archived", false);
  if (pipes.error) throw fail();
  const outboundId = (pipes.data ?? []).find((p) => String(p.name).trim().toLowerCase() === "outbound")?.id;
  if (!outboundId) return {};
  const leads = await db.from("leads").select("id").eq("pipeline_id", outboundId).limit(5000);
  if (leads.error) throw fail();
  const ids = (leads.data ?? []).map((l) => l.id as string);
  if (!ids.length) return {};
  const runs: any[] = [], emailed: string[] = [], formLeads: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const [r, b2b, flow, camp, diag] = await Promise.all([
      db.from("crm_automation_runs").select("lead_id,source,finished_at,cancelled_at,form_at,enrollment_id,automation_id").in("lead_id", part),
      db.from("b2b_ai_email_items").select("send_lead_id").eq("send_state", "accepted").not("provider_message_id", "is", null).in("send_lead_id", part),
      db.from("crm_email_flow_messages").select("lead_id").eq("direction", "out").in("state", ["accepted", "sent"]).not("provider_message_id", "is", null).in("lead_id", part),
      db.from("crm_campaign_deliveries").select("lead_id,scheduled_at").eq("state", "accepted").not("provider_message_id", "is", null).in("lead_id", part),
      db.from("crm_diagnosis_submissions").select("lead_id").in("lead_id", part),
    ]);
    if (r.error || b2b.error || flow.error || camp.error || diag.error) throw fail();
    const enrIds = (r.data ?? []).map((x: any) => x.enrollment_id).filter(Boolean);
    const enr = enrIds.length ? await db.from("crm_email_flow_enrollments").select("id,status").in("id", enrIds) : { data: [], error: null };
    if (enr.error) throw fail();
    const autoIds = [...new Set((r.data ?? []).map((x: any) => x.automation_id).filter(Boolean))];
    const autos = autoIds.length ? await db.from("crm_automations").select("id,state").in("id", autoIds) : { data: [], error: null };
    if (autos.error) throw fail();
    const autoState = new Map((autos.data ?? []).map((a: any) => [a.id, a.state]));
    const enrStatus = new Map((enr.data ?? []).map((e: any) => [e.id, e.status]));
    for (const x of r.data ?? []) runs.push({
      leadId: x.lead_id, source: x.source, finishedAt: x.finished_at, cancelledAt: x.cancelled_at, formAt: x.form_at,
      automationState: autoState.get(x.automation_id) ?? "", enrollmentStatus: x.enrollment_id ? (enrStatus.get(x.enrollment_id) ?? "unknown") : null,
    });
    const now = new Date().toISOString();
    emailed.push(...(b2b.data ?? []).map((x) => x.send_lead_id as string), ...(flow.data ?? []).map((x) => x.lead_id as string),
      ...(camp.data ?? []).filter((x) => !x.scheduled_at || x.scheduled_at <= now).map((x) => x.lead_id as string));
    formLeads.push(...(diag.data ?? []).map((x) => x.lead_id as string));
  }
  return outboundAutoTags({ leadIds: ids, runs, emailed, formLeads });
}
