import { z } from "zod";
import { deskHistory, deskProfile, deskQueryCode, leadDeskDatasets, type DeskHistory } from "./lead-deskdata";
import { requireCrmLeadSession } from "./crm-leads.server";
import { assertCrmAdmin, assertCrmLeadWrite } from "./crm-leads-access";
import { b2bConfig, b2bDb, metered } from "./b2b-prospecting.server";
import { configuredDeskCosts, lookupKey } from "./b2b-hybrid.server";
import { estimateDeskCredits } from "./b2b-hybrid";
import { signCrmSession } from "./crm-session-token";

export async function deskLeadAccess(leadId: string, full = true) {
  const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET);
  if (full) assertCrmAdmin(level);
  const db = await b2bDb();
  const row = await db.from("leads").select("id,stage,pipeline_id").eq("id", leadId).maybeSingle();
  if (row.error || !row.data) throw new Error("Lead indisponível.");
  assertCrmLeadWrite(level, row.data, { stage: row.data.stage, pipelineId: row.data.pipeline_id });
  return { db, level };
}
async function binding(leadId: string) {
  const db = await b2bDb();
  const result = await db.from("lead_deskdata_bindings").select("cnpj").eq("lead_id", leadId).maybeSingle();
  if (result.error) throw new Error("Vínculo cadastral indisponível.");
  if (result.data) return result.data.cnpj as string;
  const legacy = await db.from("b2b_companies").select("cnpj").eq("lead_id", leadId).limit(2);
  if (legacy.error) throw new Error("Cadastro empresarial indisponível.");
  return legacy.data?.length === 1 ? legacy.data[0].cnpj as string : "";
}
export async function leadDeskOverview(leadId: string) {
  const { db, level } = await deskLeadAccess(leadId, false);
  if (level !== "full") return { allowed: false, cnpj: "", history: [] as DeskHistory[], configured: [] as string[] };
  const cnpj = await binding(leadId);
  const history = await db.from("lead_deskdata_history").select("id,cnpj,datasets,estimated_credits,status,profile,outcome_code,created_at,checked_at,query_key").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(30);
  if (history.error) throw new Error("Histórico de enriquecimento indisponível.");
  const keys = (history.data ?? []).map(r => r.query_key);
  const cache = keys.length ? await db.from("b2b_lookup_cache").select("query_key,desk_query_code,desk_pending,state,profile").in("query_key", keys) : { data: [], error: null };
  if (cache.error) throw new Error("Histórico de consultas indisponível.");
  return { allowed: true, cnpj, configured: b2bConfig().datasets, history: (history.data ?? []).map(row => {
    const entry = cache.data?.find(c => c.query_key === row.query_key);
    const parsed = deskProfile.safeParse(entry?.state === "success" ? entry.profile : row.profile);
    const pending = entry?.desk_pending && Boolean(deskQueryCode(entry.desk_query_code));
    const status = entry?.state === "success" ? parsed.success ? "success" : "empty" : pending ? "pending" : row.status;
    return deskHistory.parse({ ...row, status, profile: parsed.success ? parsed.data : null, recoverable: Boolean(pending) });
  }) };
}
export async function bindLeadDesk(input: { leadId: string; cnpj: string }) {
  const { db } = await deskLeadAccess(input.leadId);
  const pending = await db.from("lead_deskdata_history").select("id").eq("lead_id", input.leadId).in("status", ["pending", "unknown"]).limit(1);
  if (pending.error || pending.data?.length) throw new Error("Resolva a consulta pendente antes de alterar o CNPJ.");
  const result = await db.from("lead_deskdata_bindings").upsert({ lead_id: input.leadId, cnpj: input.cnpj, identity_confirmed_at: new Date().toISOString(), storage_authorized_at: new Date().toISOString() });
  if (result.error) throw new Error("Não foi possível vincular o CNPJ.");
  return { ok: true };
}
export async function quoteLeadDesk(input: { leadId: string; selected: string[] }) {
  const { db } = await deskLeadAccess(input.leadId);
  const cnpj = await binding(input.leadId);
  if (!cnpj) throw new Error("Vincule e confira o CNPJ antes de consultar.");
  const datasets = leadDeskDatasets(input.selected), key = await lookupKey("deskdata", "cnpj", cnpj, datasets);
  const cached = await db.from("b2b_lookup_cache").select("state,profile,valid_until").eq("query_key", key).maybeSingle();
  if (cached.error) throw new Error("Controle de consumo indisponível.");
  const reusable = cached.data?.state === "success" && Date.parse(cached.data.valid_until) > Date.now() && deskProfile.safeParse(cached.data.profile).success;
  const config = b2bConfig();
  const estimatedCredits = reusable ? 0 : estimateDeskCredits(datasets, config.datasets, configuredDeskCosts());
  const blockedReason = reusable ? "" : cached.data ? "Consulta já enviada. Recupere a operação anterior; não será iniciada outra cobrança." : !config.deskReady ? "Acesso DeskData indisponível." : datasets.some(d => !config.datasets.includes(d)) ? "A contratação dos conjuntos selecionados ainda não foi confirmada." : estimatedCredits === null ? "Custo total não confirmado; consulta paga bloqueada até comprovação pela DeskData." : "";
  const payload = JSON.stringify({ leadId: input.leadId, cnpj, datasets, key, estimatedCredits, expires: Date.now() + 300000 });
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret) throw new Error("Sessão indisponível.");
  return { datasets, estimatedCredits, cached: Boolean(reusable), blockedReason, quote: blockedReason ? "" : JSON.stringify({ payload, signature: await signCrmSession(`lead-desk:${payload}`, secret) }) };
}
async function verifiedQuote(leadId: string, token: string) {
  const envelope = z.object({ payload: z.string().max(8000), signature: z.string().length(64) }).parse(JSON.parse(token));
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret) throw new Error("Sessão indisponível.");
  const expected = await signCrmSession(`lead-desk:${envelope.payload}`, secret);
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
  if (diff) throw new Error("Confirmação inválida.");
  const p = z.object({ leadId: z.string().uuid(), cnpj: z.string(), datasets: z.array(z.string()).max(6), key: z.string().length(64), estimatedCredits: z.number().int().nonnegative(), expires: z.number() }).parse(JSON.parse(envelope.payload));
  if (p.leadId !== leadId || p.expires <= Date.now() || p.cnpj !== await binding(leadId)) throw new Error("A confirmação expirou ou o cadastro mudou.");
  return p;
}
async function saveOutcome(leadId: string, historyId: string, key: string, result: Awaited<ReturnType<typeof import("./b2b-providers.server").deskQueryOperation>>) {
  await deskLeadAccess(leadId);
  const db = await b2bDb(), now = new Date().toISOString();
  const profile = result.company ? deskProfile.parse(result.company) : null;
  const status = result.pending ? "pending" : profile ? "success" : "empty";
  const saved = await db.from("b2b_lookup_cache").update({ state: result.pending ? "reserved" : "success", profile, desk_query_code: result.queryCode, desk_pending: result.pending, checked_at: now, valid_until: new Date(Date.now() + 30 * 86400000).toISOString() }).eq("query_key", key);
  if (saved.error) throw new Error("Consulta enviada; recuperação do registro necessária. Não repita a consulta paga.");
  const history = await db.from("lead_deskdata_history").update({ status, profile, outcome_code: result.pending ? "desk_4008" : null, checked_at: now }).eq("id", historyId).eq("lead_id", leadId);
  if (history.error) throw new Error("Resultado preservado; atualize o histórico antes de prosseguir.");
  return { status };
}
export async function sendLeadDesk(leadId: string, token: string) {
  const { db } = await deskLeadAccess(leadId), q = await verifiedQuote(leadId, token);
  const cache = await db.from("b2b_lookup_cache").select("state,profile,valid_until").eq("query_key", q.key).maybeSingle();
  if (cache.error) throw new Error("Controle de consumo indisponível.");
  const profile = deskProfile.safeParse(cache.data?.profile);
  if (cache.data?.state === "success" && Date.parse(cache.data.valid_until) > Date.now() && profile.success) {
    const saved = await db.from("lead_deskdata_history").upsert({ lead_id: leadId, cnpj: q.cnpj, query_key: q.key, datasets: q.datasets, estimated_credits: 0, status: "success", profile: profile.data }, { onConflict: "lead_id,query_key", ignoreDuplicates: true });
    if (saved.error) throw new Error("Não foi possível associar o resultado já armazenado.");
    return { status: "success" };
  }
  if (cache.data || !b2bConfig().deskReady || estimateDeskCredits(q.datasets, b2bConfig().datasets, configuredDeskCosts()) !== q.estimatedCredits) throw new Error("Consulta bloqueada; confira o custo e a operação anterior.");
  const claim = await db.rpc("claim_b2b_lookup", { p_key: q.key, p_provider: "deskdata" });
  if (claim.error || claim.data !== true) throw new Error("Consulta já reservada; nenhuma nova cobrança iniciada.");
  const history = await db.from("lead_deskdata_history").insert({ lead_id: leadId, cnpj: q.cnpj, query_key: q.key, datasets: q.datasets, estimated_credits: q.estimatedCredits, status: "unknown" }).select("id").single();
  if (history.error) throw new Error("Histórico indisponível; nenhuma consulta enviada.");
  try {
    const [{ deskQueryOperation }, { getDeskDataToken }] = await Promise.all([import("./b2b-providers.server"), import("./deskdata-auth.server")]);
    const result = await metered("deskdata", async () => {
      await deskLeadAccess(leadId);
      if (q.cnpj !== await binding(leadId)) throw new Error("Cadastro mudou; nenhuma consulta enviada.");
      const operation = await deskQueryOperation(q.cnpj, q.datasets, await getDeskDataToken());
      // Save inside metering callback: accounting persistence failures cannot lose the provider handle/result.
      const handle = await db.from("b2b_lookup_cache").update({ state: operation.pending ? "reserved" : "success", profile: operation.company, desk_query_code: operation.queryCode, desk_pending: operation.pending }).eq("query_key", q.key);
      if (handle.error) throw new Error("Não foi possível registrar a recuperação; não repita a consulta paga.");
      return operation;
    });
    return await saveOutcome(leadId, history.data.id, q.key, result);
  } catch (error) {
    const { B2bProviderError } = await import("./b2b-providers.server");
    const code = error instanceof B2bProviderError ? error.code : "unconfirmed";
    await db.from("lead_deskdata_history").update({ status: ["transport", "unconfirmed", "schema", "invalid_response"].includes(code) ? "unknown" : "error", outcome_code: code.slice(0, 60) }).eq("id", history.data.id);
    return { status: "error", message: error instanceof B2bProviderError ? error.message : "Resultado não confirmado; consulte o histórico antes de qualquer nova operação." };
  }
}
export async function recoverLeadDesk(leadId: string, historyId: string) {
  const { db } = await deskLeadAccess(leadId);
  const history = await db.from("lead_deskdata_history").select("query_key,cnpj,datasets,status").eq("id", historyId).eq("lead_id", leadId).maybeSingle();
  if (history.error || !history.data) throw new Error("Consulta indisponível para este lead.");
  const cache = await db.from("b2b_lookup_cache").select("state,profile,desk_query_code,desk_pending,checked_at").eq("query_key", history.data.query_key).maybeSingle();
  if (cache.error || !cache.data) throw new Error("Registro da operação indisponível.");
  const parsed = deskProfile.safeParse(cache.data.profile);
  if (cache.data.state === "success") return saveOutcome(leadId, historyId, history.data.query_key, { pending: false, queryCode: cache.data.desk_query_code, company: parsed.success ? parsed.data : null });
  const code = deskQueryCode(cache.data.desk_query_code);
  if (!cache.data.desk_pending || !code) throw new Error("Sem identificador recuperável. Confira a operação com a DeskData; nenhuma consulta paga será repetida.");
  if (Date.now() - Date.parse(cache.data.checked_at) < 20000) return {status:"pending"};
  const lease = await db.from("b2b_lookup_cache").update({checked_at:new Date().toISOString()}).eq("query_key",history.data.query_key).eq("checked_at",cache.data.checked_at).select("query_key");
  if (lease.error || !lease.data?.length) return {status:"pending"};
  const [{ deskQueryOperation }, { getDeskDataToken }] = await Promise.all([import("./b2b-providers.server"), import("./deskdata-auth.server")]);
  const result = await deskQueryOperation(history.data.cnpj, history.data.datasets, await getDeskDataToken(), code);
  return saveOutcome(leadId, historyId, history.data.query_key, result);
}