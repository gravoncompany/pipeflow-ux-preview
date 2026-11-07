import { phoneKey } from "./phone";
import type { AnalysisMessage } from "./whatsapp-analysis";
import { criteriaText, decideQualification } from "./lead-ai-qualification";

async function adminDb() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }
type Db = Awaited<ReturnType<typeof adminDb>>;

function sameToken(expected: string, given: string) {
  if (!expected || expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** Scheduled entry point (pg_cron). Returns only counts; never conversation content. */
export async function runLeadQualificationScheduled(bearer: string) {
  const db = await adminDb();
  const { data: runner } = await db.from("lead_ai_qualification_runner").select("token,enabled,ai_blocked_reason").eq("id", true).single();
  if (!runner || !sameToken(runner.token, bearer)) return null;
  const counts = { evaluated: 0, qualified: 0, pending: 0, failed: 0, metaSent: 0, skipped: "" };
  if (!runner.enabled) counts.skipped = "disabled";
  else if (runner.ai_blocked_reason) counts.skipped = "ai_blocked";
  else await evaluateDue(db, counts);
  try {
    const { dispatchQualifiedLeadEvents } = await import("./meta-capi.server");
    counts.metaSent = (await dispatchQualifiedLeadEvents()).sent;
  } catch { console.error("lead_qualification_meta_dispatch_failed"); }
  await db.from("lead_ai_qualification_runner").update({ last_run_at: new Date().toISOString(), last_result: counts }).eq("id", true);
  return counts;
}

async function evaluateDue(db: Db, counts: { evaluated: number; qualified: number; pending: number; failed: number }) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return;
  const lease = crypto.randomUUID();
  const { data: claimed, error } = await db.rpc("claim_lead_ai_qualifications", { p_lease: lease, p_limit: 5 });
  if (error) { console.error("lead_qualification_claim_failed"); return; }
  if (!claimed?.length) return;
  const { data: knowledge } = await db.from("ai_knowledge").select("title,text").eq("company_key", "crm:1").eq("entry_type", "manual").order("updated_at", { ascending: false }).limit(40);
  const criteria = criteriaText(knowledge ?? []);
  const finish = (lead: string, outcome: string, extra: { summary?: string; fit?: string; evidence?: unknown[]; fingerprint?: string | null; lastInbound?: string | null; error?: string } = {}) =>
    db.rpc("finish_lead_ai_qualification", { p_lead: lead, p_lease: lease, p_outcome: outcome, p_summary: extra.summary ?? "", p_fit: extra.fit ?? "",
      p_evidence: (extra.evidence ?? []) as never, p_fingerprint: extra.fingerprint ?? null as never, p_last_inbound: extra.lastInbound ?? null as never, p_error: extra.error ?? "" });

  for (const lead of claimed) {
    counts.evaluated++;
    if (lead.same_phone > 1) { await finish(lead.lead_id, "ambiguous"); counts.pending++; continue; }
    const key = phoneKey(lead.whatsapp ?? "");
    if (key.length < 8) { await finish(lead.lead_id, "no_conversation"); counts.pending++; continue; }
    const { data: fetched, error: msgError } = await db.from("whatsapp_messages").select("message_id,body,from_me,sent_at,media_type").eq("phone_key", key).order("sent_at", { ascending: false }).order("message_id").limit(200);
    if (msgError) { await finish(lead.lead_id, "failed", { error: "Leitura da conversa falhou." }); counts.failed++; continue; }
    const lastInbound = (fetched ?? []).find((m) => !m.from_me)?.sent_at ?? null;
    if (!lastInbound) { await finish(lead.lead_id, "no_conversation", { lastInbound }); counts.pending++; continue; }
    let size = 0;
    const messages: AnalysisMessage[] = [];
    for (const m of fetched ?? []) { size += m.body.length; if (size > 60_000) break; messages.push(m); }
    messages.reverse();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(messages)));
    const fingerprint = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      const { runLeadQualification } = await import("./ai/lead-qualification.server");
      const raw = await runLeadQualification(apiKey, { lead: { name: lead.name ?? "", company: lead.company ?? "", service: lead.service ?? "" }, criteria, messages });
      const d = decideQualification(raw, messages);
      const { data: res, error: finishError } = await finish(lead.lead_id, d.outcome, { summary: d.summary, fit: d.fitReason, evidence: d.evidence, fingerprint, lastInbound });
      if (finishError) { console.error("lead_qualification_finish_failed"); counts.failed++; continue; }
      if (d.outcome === "qualified" && res === "ok") counts.qualified++; else counts.pending++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      counts.failed++;
      await finish(lead.lead_id, "failed", { error: status ? `IA indisponível (HTTP ${status}).` : "IA indisponível." });
      if (status === 402 || status === 403 || status === 404) {
        await db.from("lead_ai_qualification_runner").update({ ai_blocked_reason: status === 402 ? "Créditos de IA esgotados." : "Acesso à IA indisponível." }).eq("id", true);
        break;
      }
    }
  }
}
