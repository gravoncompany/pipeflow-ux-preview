import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { phoneKey } from "./phone";

type Lead = { name: string; company: string; email: string; whatsapp: string; instagram: string; website: string; invested_traffic: string; revenue: string; employees: string; service: string; potential_value: number; owner: string; notes: string; stage: string; status: string };
type Input = { pipelineRaw?: string; eventId?: string; lead: Lead; utms: Record<string, string>; answers: Record<string, string>; source: string; today: string; commercialForm?: boolean; evidence?: Partial<Database["public"]["Tables"]["leads"]["Insert"]> };
type Result = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hid = () => Math.random().toString(36).slice(2, 10);

export async function routeToPipeline(db: SupabaseClient<Database>, input: Input): Promise<Result> {
  const { lead: d, today } = input;
  let pipelineId: string | null = null;
  let stage = d.stage;
  if (input.pipelineRaw !== undefined) {
    if (!UUID.test(input.pipelineRaw)) return { status: 400, body: { error: "invalid_pipeline", message: "pipeline_id inválido." } };
    const { data: p, error } = await db.from("sales_pipelines").select("id,stages").eq("id", input.pipelineRaw).eq("archived", false).maybeSingle();
    if (error) return { status: 500, body: { error: "Unable to verify pipeline" } };
    const first = (p?.stages as { id: string }[] | undefined)?.[0]?.id;
    if (!p || !first) return { status: 400, body: { error: "invalid_pipeline", message: "Funil não encontrado ou arquivado." } };
    pipelineId = p.id; stage = first; // always the initial stage; never auto-qualified
  }

  if (input.eventId !== undefined) {
    if (input.eventId.length > 200) return { status: 400, body: { error: "invalid_event_id" } };
    const { error } = await db.from("zapier_inbound_events").insert({ event_id: input.eventId, pipeline_id: pipelineId });
    if (error?.code === "23505") {
      const { data: prev } = await db.from("zapier_inbound_events").select("lead_id").eq("event_id", input.eventId).maybeSingle();
      return prev?.lead_id ? { status: 200, body: { ok: true, duplicate: true, id: prev.lead_id } } : { status: 409, body: { error: "event_in_progress" } };
    }
    if (error) return { status: 500, body: { error: "Unable to register event" } };
  }
  const release = async () => { if (input.eventId !== undefined) await db.from("zapier_inbound_events").delete().eq("event_id", input.eventId).is("lead_id", null); };
  const finish = async (id: string, created: boolean) => { if (input.eventId !== undefined) await db.from("zapier_inbound_events").update({ lead_id: id, created_lead: created }).eq("event_id", input.eventId); };

  const answersText = Object.entries(input.answers).map(([k, v]) => `${k}: ${v}`).join("\n");
  const email = d.email.toLowerCase();
  const pk = d.whatsapp ? phoneKey(d.whatsapp) : "";

  // Existing contacts (same e-mail or phone) anywhere in the CRM.
  let matches: { id: string; pipeline_id: string | null; history: unknown; email: string; whatsapp: string; gravon_change_revision: number }[] = [];
  if ((pipelineId || input.commercialForm) && (email || pk)) {
    const { data, error } = await db.from("leads").select("id,pipeline_id,history,email,whatsapp,gravon_change_revision").or([email && `email.ilike.${email.replace(/[,()]/g, "")}`, pk && `whatsapp.ilike.%${pk.slice(-8)}%`].filter(Boolean).join(","));
    if (error) { await release(); return { status: 500, body: { error: "Unable to check contact" } }; }
    matches = (data ?? []).filter((l) => (email && l.email.toLowerCase() === email) || (pk && phoneKey(l.whatsapp) === pk));
  }

  const sameMatches = matches.filter(m => m.pipeline_id === pipelineId);
  if (input.commercialForm && sameMatches.length > 1) { await release(); return { status: 409, body: { error: "ambiguous_contact" } }; }
  const same = sameMatches[0];
  if (same) {
    // Contact already has an opportunity in this pipeline: keep its data and stage, append the submission to history.
    const history = Array.isArray(same.history) ? same.history : [];
    const entry = { id: hid(), date: today, text: `Novo envio do formulário via Zapier.${answersText ? `\n${answersText}` : ""}` };
    const { data: up, error } = await db.from("leads").update({ history: [...history, entry] }).eq("id", same.id).eq("gravon_change_revision", same.gravon_change_revision).select("id").maybeSingle();
    if (error || !up) { await release(); return { status: 409, body: { error: "lead_changed_retry" } }; }
    await finish(same.id, false);
    return { status: 200, body: { ok: true, id: same.id, existing_contact: true, created: false } };
  }

  const others = matches.length ? ` Contato já existente em outra oferta (${matches.length} registro(s)), mantidos sem alteração.` : "";
  const { data, error } = await db.from("leads").insert({
    ...input.evidence,
    name: d.name, company: d.company, email: d.email, whatsapp: d.whatsapp, instagram: d.instagram, website: d.website,
    invested_traffic: d.invested_traffic, revenue: d.revenue, employees: d.employees, source: input.source, ...input.utms,
    service: d.service, potential_value: d.potential_value, owner: d.owner,
    notes: [d.notes, pipelineId && answersText ? `Respostas do formulário:\n${answersText}` : ""].filter(Boolean).join("\n\n"),
    stage, status: d.status, entry_date: today, pipeline_id: pipelineId,
    history: [{ id: hid(), date: today, text: `Lead criado via Zapier.${others}` }],
  }).select("id").single();
  if (error || !data) { await release(); return { status: 500, body: { error: "Unable to save lead" } }; }
  await finish(data.id, true);
  return { status: 200, body: { ok: true, id: data.id, created: true, existing_contact: matches.length > 0 } };
}
