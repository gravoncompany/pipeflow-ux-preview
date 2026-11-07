import { administrator, db } from "./meta-capi.server";
import { summarizeEvents } from "./meta-capi-monitor";

type Filter = { companyKey?: string; from?: string; to?: string };

/** Every read is scoped to the verified administrator's own company; another company key is refused. */
async function scope(companyKey?: string) {
  const actor = await administrator();
  if (companyKey && companyKey !== actor.company) throw new Error("Você não tem acesso aos eventos dessa empresa.");
  return actor;
}

export async function listConversions(filter: Filter) {
  const actor = await scope(filter.companyKey);
  const client = await db();
  let q = client.from("meta_capi_lead_events").select("id,lead_id,event_name,event_time,status,source,attempts,retryable,next_attempt_at,last_http,last_code,sent_at")
    .eq("company_key", actor.company).order("event_time", { ascending: false }).limit(1000);
  if (filter.from) q = q.gte("event_time", `${filter.from}T00:00:00-03:00`);
  if (filter.to) q = q.lte("event_time", `${filter.to}T23:59:59.999-03:00`);
  const { data, error } = await q;
  if (error) throw new Error("Não foi possível ler o histórico de conversões.");
  const ids = [...new Set((data ?? []).map((r) => r.lead_id))];
  const { data: leads } = ids.length ? await client.from("leads").select("id,name,company").in("id", ids) : { data: [] };
  const byId = new Map((leads ?? []).map((l) => [l.id, l]));
  await actor.authorize();
  const rows = (data ?? []).map((r) => ({ ...r, leadName: byId.get(r.lead_id)?.name ?? "Lead removido", leadCompany: byId.get(r.lead_id)?.company ?? "" }));
  return { companies: [{ key: actor.company, label: actor.company === "crm:1" ? "Gravon" : actor.company }], summary: summarizeEvents(rows), rows };
}

export async function conversionDetail(id: string) {
  const actor = await scope();
  const client = await db();
  const { data: ev, error } = await client.from("meta_capi_lead_events").select("id,lead_id,event_name,event_id,event_time,pixel_id,status,source,attempts,retryable,next_attempt_at,last_http,last_code,sent_at,created_at")
    .eq("id", id).eq("company_key", actor.company).maybeSingle();
  if (error) throw new Error("Não foi possível ler o evento.");
  if (!ev) throw new Error("Evento não encontrado nesta empresa.");
  const [{ data: attempts }, { data: lead }] = await Promise.all([
    client.from("meta_capi_event_attempts").select("attempt_no,trigger,outcome,http,code,request_summary,response_summary,created_at").eq("event_row", ev.id).eq("company_key", actor.company).order("attempt_no"),
    client.from("leads").select("name,company").eq("id", ev.lead_id).maybeSingle(),
  ]);
  await actor.authorize();
  return { event: ev, lead: lead ?? null, attempts: attempts ?? [] };
}

export async function retryConversion(id: string) {
  const actor = await scope();
  const client = await db();
  await actor.authorize();
  const { data, error } = await client.rpc("request_meta_capi_retry", { p_event: id, p_company: actor.company });
  if (error) throw new Error("Não foi possível agendar a nova tentativa.");
  if (data === "not_found") throw new Error("Evento não encontrado nesta empresa.");
  if (data === "not_retryable") throw new Error("Este evento não permite nova tentativa: a Meta recusou definitivamente ou ele ainda não foi enviado.");
  if (data === "limit") throw new Error("Limite de tentativas atingido para este evento.");
  const { data: s } = await client.from("meta_capi_settings").select("production_enabled").eq("company_key", actor.company).maybeSingle();
  return { scheduled: true, productionEnabled: Boolean(s?.production_enabled) };
}
