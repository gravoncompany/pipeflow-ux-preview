import { z } from "zod";
import { DEFAULT_STAGES } from "./crm-types";
import { criteriaFrom, decideAgentMove, humanRisk, safeAgentResponse, type AgentVerdict, type StageMap } from "./commercial-agent";
import { normalizeAcceptedMessage, openInstances } from "./whatsapp-message-sync";
import { sameWhatsAppNumber } from "./phone";
import type { AgentPromptInput } from "./ai/commercial-agent-ai.server";

/** Service-role RPC boundary; every state transition lives in the database (0084). */
export type AgentRpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type AgentDeps = {
  rpc: AgentRpc;
  generate: (input: AgentPromptInput, maxChars: number) => Promise<AgentVerdict>;
  /** Throws unless the instance is connected with exactly the configured sender number. */
  verifySender: (instance: string, sender: string) => Promise<void>;
  send: (instance: string, number: string, text: string) => Promise<Response>;
  readReceipt?: (response: Response) => Promise<unknown>;
};
export class AgentProviderBlocked extends Error { constructor(message: string) { super(message); this.name = "AgentProviderBlocked"; } }

const runSchema = z.object({ id: z.string().uuid(), settings_id: z.string().uuid(), inbound_id: z.string(), instance: z.string(), phone: z.string(), contact_key: z.string(), from_stage: z.string().nullable(), pipeline_id: z.string().uuid().nullable() }).passthrough();
type Run = z.infer<typeof runSchema>;
const claimSchema = z.object({ status: z.string(), run: runSchema.optional(), reason: z.string().optional() }).passthrough();
const stageList = z.array(z.object({ id: z.string(), title: z.string() }).passthrough());
const contextSchema = z.object({
  run: runSchema,
  settings: z.object({ id: z.string().uuid(), instance: z.string(), sender_phone: z.string(), instructions: z.string(), stage_map: z.record(z.string(), z.string()), handoff_keywords: z.array(z.string()),
    served_regions: z.array(z.string()), excluded_regions: z.array(z.string()), services: z.array(z.string()), qualification_requirements: z.string(), max_reply_chars: z.number(), move_stages: z.array(z.string()).nullable().optional() }).passthrough(),
  lead: z.object({ id: z.string(), name: z.string().nullable(), stage: z.string() }).passthrough().nullable(),
  pipeline: z.object({ id: z.string().nullable(), name: z.string(), stages: stageList.nullable() }),
  messages: z.array(z.object({ id: z.string(), fromMe: z.boolean(), body: z.string(), sentAt: z.string(), mediaType: z.string().nullable() })),
  knowledge: z.array(z.object({ title: z.string(), text: z.string() })),
  adMessages: z.array(z.string()),
});
const MAX_CONTEXT_CHARS = 80000;

async function recoverAccepted(deps: AgentDeps) {
  await deps.rpc("quarantine_crm_agent_runs", {});
  const pending = z.array(z.string().uuid()).parse(await deps.rpc("crm_agent_pending_sync", {}) ?? []);
  for (const id of pending) {
    try { await deps.rpc("sync_crm_agent_send", { p_run: id }); } catch { console.error("commercial_agent_sync_pending"); }
  }
}

async function finish(deps: AgentDeps, run: Run, analysis: unknown, reply: string | null, human: string | null) {
  const ok = await deps.rpc("finish_crm_agent_analysis", { p_run: run.id, p_analysis: analysis, p_reply: reply, p_human: human });
  if (ok !== true) throw new Error("analysis_not_recorded");
}
/** No reply and no handoff: the reservation step records the skip and releases the contact. */
async function skip(deps: AgentDeps, run: Run, reason: string) {
  await finish(deps, run, { skip: reason }, null, null);
  await deps.rpc("begin_crm_agent_send", { p_run: run.id });
}

export async function answerRun(deps: AgentDeps, run: Run): Promise<string> {
  const raw = await deps.rpc("crm_agent_context", { p_run: run.id });
  if (!raw) return "lease_lost";
  const ctx = contextSchema.parse(raw);
  const s = ctx.settings;
  const last = ctx.messages.at(-1);
  if (!ctx.lead) { await finish(deps, run, { reason: "lead_missing" }, null, "Card do lead não encontrado; atendimento humano necessário."); return "human"; }
  if (!last || last.id !== run.inbound_id || last.fromMe) { await skip(deps, run, "A conversa mudou antes da análise."); return "skipped"; }
  const risk = humanRisk(last.body, s.handoff_keywords);
  if (risk) { await finish(deps, run, { reason: risk }, null, risk); return "human"; }
  if (!ctx.knowledge.length) { await finish(deps, run, { reason: "knowledge_empty" }, null, "Conhecimento Comercial vazio; a IA não responde sem base cadastrada."); return "human"; }
  const size = ctx.knowledge.reduce((n, k) => n + k.text.length + k.title.length, 0) + ctx.messages.reduce((n, m) => n + m.body.length, 0);
  if (size > MAX_CONTEXT_CHARS) { await finish(deps, run, { reason: "context_too_large" }, null, "Base ou histórico acima do limite seguro; revisão humana necessária."); return "human"; }
  try { await deps.verifySender(s.instance, s.sender_phone); }
  catch { await finish(deps, run, { reason: "channel_unavailable" }, null, "WhatsApp conectado indisponível ou diferente do configurado; nada foi enviado."); return "human"; }

  const mainFunnel = ctx.pipeline.id === null;
  const stages = ctx.pipeline.stages ?? DEFAULT_STAGES;
  const criteria = criteriaFrom(s, ctx.adMessages);
  const messages = ctx.messages.map((m) => ({ from_me: m.fromMe, body: m.body }));
  let verdict: AgentVerdict;
  try {
    verdict = await deps.generate({
      empresa: "Gravon Company", funil: ctx.pipeline.name, etapa_atual: stages.find((x) => x.id === ctx.lead!.stage)?.title ?? ctx.lead.stage,
      instrucoes_do_funil: s.instructions,
      criterios: { regioesAtendidas: s.served_regions, regioesNaoAtendidas: s.excluded_regions, servicos: s.services, requisitos: s.qualification_requirements },
      base_comercial: ctx.knowledge, mensagens_de_anuncio: ctx.adMessages,
      mensagens: ctx.messages.map((m) => ({ de: m.fromMe ? "empresa" : "cliente", em: m.sentAt, texto: m.body.slice(0, 1500) })),
    }, s.max_reply_chars);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    const blocked = error instanceof AgentProviderBlocked ? error.message : [402, 403, 404, 429].includes(status ?? 0) ? `IA indisponível (HTTP ${status}); revise créditos/acesso e salve a configuração para reativar.` : null;
    if (blocked) await deps.rpc("block_crm_agent", { p_settings: s.id, p_reason: blocked });
    await finish(deps, run, { reason: "ai_unavailable" }, null, blocked ?? "A IA não respondeu; atendimento humano necessário.");
    return "human";
  }
  const safe = safeAgentResponse(verdict, ctx.knowledge, last.body, s.max_reply_chars, s.handoff_keywords);
  const decision = decideAgentMove({ current: ctx.lead.stage, stages, stageMap: s.stage_map as StageMap, mainFunnel, verdict, messages, criteria, reply: safe.text, moveStages: s.move_stages ?? null });
  const { response: _response, ...analysis } = verdict;
  await finish(deps, run, { ...analysis, decision, qualification: decision.qualification }, safe.text, safe.reason);
  if (!safe.text) return "human";

  try { await deps.verifySender(s.instance, s.sender_phone); }
  catch { await skip(deps, run, "WhatsApp indisponível antes do envio."); return "skipped"; }
  if (await deps.rpc("begin_crm_agent_send", { p_run: run.id }) !== true) return "skipped";
  let providerId: string | null = null, acceptedAt: string | null = null, error: string | null = null;
  try {
    const response = await deps.send(run.instance, run.phone, safe.text);
    if (!response.ok) error = `Evolution recusou o envio (HTTP ${response.status}); resultado não confirmado, sem reenvio.`;
    else {
      const receipt = normalizeAcceptedMessage(await (deps.readReceipt ?? ((r: Response) => r.json()))(response), { instance: run.instance, number: run.phone, body: safe.text, acceptedAt: new Date().toISOString() });
      if (!receipt) error = "Resposta do WhatsApp sem identidade verificável; não reenviar.";
      else { providerId = receipt.messageId; acceptedAt = receipt.acceptedAt; }
    }
  } catch { error = "Resultado do envio indeterminado; não reenviar."; }
  await deps.rpc("record_crm_agent_send", { p_run: run.id, p_provider: providerId, p_accepted: acceptedAt, p_error: error });
  if (!providerId || error) return "unknown";
  try { await deps.rpc("sync_crm_agent_send", { p_run: run.id }); }
  catch { console.error("commercial_agent_sync_deferred"); return "accepted"; } // Recovered on later traffic; never resent.
  try { await deps.rpc("apply_crm_agent_decision", { p_run: run.id }); } catch { console.error("commercial_agent_decision_failed"); }
  return "completed";
}

/**
 * Called after the webhook stored the messages. Each inbound message is claimed at most once; an agent only
 * acts on cards of its own funnel. Failures never affect message reception and never resend.
 */
export async function processCommercialAgent(deps: AgentDeps, instance: string, rows: { message_id: string; from_me: boolean }[]) {
  const inbound = rows.filter((r) => !r.from_me);
  if (!inbound.length) return [];
  await recoverAccepted(deps);
  const outcomes: string[] = [];
  for (const row of inbound) {
    let claim = claimSchema.parse(await deps.rpc("claim_crm_agent", { p_instance: instance, p_inbound: row.message_id }));
    for (let i = 0; i < 3 && claim.status === "claimed" && claim.run; i++) {
      const run = claim.run;
      try { outcomes.push(await answerRun(deps, run)); }
      catch (e) { console.error("commercial_agent_run_failed", e instanceof Error ? e.message.slice(0, 80) : "unknown"); outcomes.push("error"); break; }
      claim = claimSchema.parse(await deps.rpc("claim_next_crm_agent_run", { p_contact: run.contact_key }));
    }
  }
  return outcomes;
}

/** Live Evolution check: the instance must be connected with exactly the configured sender number. */
export async function verifyLiveSender(name: string, sender: string) {
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  if (!evolutionKey) throw new Error("evolution_not_configured");
  const { EVOLUTION_BASE_URL } = await import("./evolution.functions");
  const { fetchWithoutRedirects } = await import("./no-redirect-fetch.server");
  const { boundedJson } = await import("./gravon-portal.server");
  const response = await fetchWithoutRedirects(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, { headers: { apikey: evolutionKey }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("evolution_unavailable");
  const live = openInstances(await boundedJson(response, 1024 * 1024)).filter((i) => i.name === name);
  if (live.length !== 1 || !sameWhatsAppNumber(live[0]!.number, sender)) throw new Error("sender_mismatch");
}

/** Production wiring: Supabase service role, Lovable AI Gateway and the existing Evolution server. */
export async function runCommercialAgent(request: Request, instance: string, rows: { message_id: string; from_me: boolean }[]) {
  if (!rows.some((r) => !r.from_me)) return;
  try { await runCommercialAgentNow(request, instance, rows); }
  catch (error) {
    const { isMissingSchema } = await import("./crm-agent-access");
    if (isMissingSchema(error as { code?: string; message?: string })) return; // Migration 0084 not applied: agent not installed.
    throw error;
  }
}

async function runCommercialAgentNow(request: Request, instance: string, rows: { message_id: string; from_me: boolean }[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { boundedJson } = await import("./gravon-portal.server");
  const { evolutionSendText } = await import("./evolution-text.server");
  const { generateCommercialReply } = await import("./ai/commercial-agent-ai.server");
  const db = supabaseAdmin as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  await processCommercialAgent({
    rpc: async (name, args) => {
      const { data, error } = await db.rpc(name, args);
      if (error) throw Object.assign(new Error(`${name}: ${error.message.slice(0, 120)}`), { code: (error as { code?: string }).code });
      return data;
    },
    generate: async (input, maxChars) => {
      const key = process.env.LOVABLE_API_KEY;
      if (!key) throw new AgentProviderBlocked("IA não configurada no servidor.");
      return generateCommercialReply(request, key, input, maxChars);
    },
    verifySender: verifyLiveSender,
    send: (name, number, text) => { if (!evolutionKey) throw new Error("evolution_not_configured"); return evolutionSendText(evolutionKey, name, number, text); },
    readReceipt: (response) => boundedJson(response, 128 * 1024),
  }, instance, rows);
}
