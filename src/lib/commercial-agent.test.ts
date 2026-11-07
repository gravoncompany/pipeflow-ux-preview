import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAgentMove, humanRisk, resolveStageRoles, safeAgentResponse, withinBusinessHours, agentSettingsInput } from "./commercial-agent";
import { verdict } from "./crm-agent-test-db";
import { EMPTY_CRITERIA } from "./pipeline-ai";
import { matchReference, normalizeReference } from "./reference-messages";

const KB = [{ title: "Plano CRM", text: "Plano mensal R$ 297. Implantação em 7 dias." }];
const STAGES = [{ id: "n", title: "Novo" }, { id: "a", title: "Em atendimento" }, { id: "q", title: "Qualificado" }, { id: "f", title: "Fechado" }];

test("human handoff: discounts, complaints, explicit requests and funnel keywords", () => {
  assert.match(humanRisk("Consegue um desconto?")!, /Desconto/);
  assert.match(humanRisk("Quero cancelar e pedir reembolso")!, /Reclamação/);
  assert.match(humanRisk("Posso falar com um atendente?")!, /humano/);
  assert.match(humanRisk("Preciso de nota fiscal", ["nota fiscal"])!, /nota fiscal/);
  assert.equal(humanRisk("Quanto custa o plano?"), null);
});

test("grounding: numbers and commercial claims must come from cited Commercial Knowledge", () => {
  assert.equal(safeAgentResponse(verdict({ response: "O plano é R$ 297 e a implantação leva 7 dias.", knowledgeTitles: ["Plano CRM"] }), KB, "preço?").text, "O plano é R$ 297 e a implantação leva 7 dias.");
  assert.match(safeAgentResponse(verdict({ response: "Custa R$ 199.", knowledgeTitles: ["Plano CRM"] }), KB, "preço?").reason!, /numérica/);
  assert.match(safeAgentResponse(verdict({ response: "O plano custa pouco.", knowledgeTitles: [] }), KB, "preço?").reason!, /base comercial/);
  assert.match(safeAgentResponse(verdict({ knowledgeTitles: ["Inventado"] }), KB, "oi").reason!, /inexistente/);
  assert.equal(safeAgentResponse(verdict({ response: "Olá! Qual é o seu segmento?" }), KB, "oi").text, "Olá! Qual é o seu segmento?");
  assert.match(safeAgentResponse(verdict({ response: "x".repeat(700) }), KB, "oi", 600).reason!, /limite/);
  assert.match(safeAgentResponse(verdict({ response: "Veja **aqui** https://x.com" }), KB, "oi").reason!, /formatação/);
  assert.match(safeAgentResponse(verdict({ humanRequired: true, humanReason: "Sem preço cadastrado" }), KB, "oi").reason!, /Sem preço/);
  assert.match(safeAgentResponse(verdict(), KB, "quero desconto").reason!, /Desconto/);
});

test("stage roles: explicit funnel mapping first; heuristics never on the main funnel", () => {
  assert.deepEqual(resolveStageRoles(STAGES, {}, false), { novo: "n", atendimento: "a", qualificado: "q" });
  assert.deepEqual(resolveStageRoles(STAGES, { qualificado: "f" }, false), { novo: "n", atendimento: "a", qualificado: "f" });
  assert.deepEqual(resolveStageRoles(STAGES, {}, true), {});
  assert.deepEqual(resolveStageRoles(STAGES, { novo: "n" }, true), { novo: "n" });
});

test("moves forward only: attendance after the reply, qualification with literal client intent", () => {
  const msgs = [{ from_me: false, body: "Quero contratar o CRM para minha loja em Porto Alegre" }];
  const base = { stages: STAGES, stageMap: {}, mainFunnel: false, messages: msgs, criteria: EMPTY_CRITERIA, reply: "Olá! Posso ajudar com o CRM." };
  const q = decideAgentMove({ ...base, current: "n", verdict: verdict({ intencaoComercial: true, evidenciaIntencao: "Quero contratar o CRM" }) });
  assert.deepEqual([q.kind, q.target, q.side], ["move", "q", "cliente"]);
  const a = decideAgentMove({ ...base, current: "n", verdict: verdict() });
  assert.deepEqual([a.kind, a.target, a.side, a.evidence], ["move", "a", "empresa", "Olá! Posso ajudar com o CRM."]);
  assert.equal(decideAgentMove({ ...base, current: "a", verdict: verdict() }).kind, "none");
  assert.equal(decideAgentMove({ ...base, current: "q", verdict: verdict({ intencaoComercial: true, evidenciaIntencao: "Quero contratar o CRM" }) }).kind, "none");
  assert.equal(decideAgentMove({ ...base, current: "n", verdict: verdict({ intencaoComercial: true, evidenciaIntencao: "frase que não existe" }) }).target, "a");
  // Region criteria from the funnel block qualification until the client confirms a served location.
  const regional = decideAgentMove({ ...base, current: "a", criteria: { ...EMPTY_CRITERIA, servedRegions: ["Curitiba"] }, verdict: verdict({ intencaoComercial: true, evidenciaIntencao: "Quero contratar o CRM", localizacao: "Porto Alegre", evidenciaLocalizacao: "Porto Alegre" }) });
  assert.equal(regional.kind, "none");
  assert.equal(regional.qualification.status, "desqualificado");
  const closing = decideAgentMove({ ...base, current: "f", verdict: verdict({ fechamento: true, evidenciaFechamento: "fechado" }) });
  assert.equal(closing.kind, "suggest");
  assert.equal(decideAgentMove({ ...base, mainFunnel: true, current: "n", verdict: verdict() }).kind, "none");
});

test("business hours use São Paulo time", () => {
  const monday10 = new Date("2026-11-02T13:00:00Z"); // 10:00 in São Paulo
  assert.equal(withinBusinessHours(monday10, [1, 2, 3, 4, 5], "08:00", "18:00"), true);
  assert.equal(withinBusinessHours(monday10, [2, 3], "08:00", "18:00"), false);
  assert.equal(withinBusinessHours(new Date("2026-11-02T22:00:00Z"), [1], "08:00", "18:00"), false);
});

test("settings input is strict and bounded", () => {
  const ok = { pipelineId: null, revision: 0, enabled: false, audience: "test", instance: "", recipients: [], allowedStages: [], instructions: "", servedRegions: [], excludedRegions: [], services: [], requirements: "", stageMap: {}, autoMove: true, handoffKeywords: [], pauseOnHumanReply: true, humanPauseHours: 24, businessDays: [1], dayStart: "08:00", dayEnd: "18:00", maxRepliesPerContactDay: 10, maxRepliesPerDay: 100, maxReplyChars: 600, maxMessageAgeMinutes: 10 };
  assert.equal(agentSettingsInput.safeParse(ok).success, true);
  assert.equal(agentSettingsInput.safeParse({ ...ok, dayStart: "19:00" }).success, false);
  assert.equal(agentSettingsInput.safeParse({ ...ok, maxReplyChars: 2000 }).success, false);
  assert.equal(agentSettingsInput.safeParse({ ...ok, recipients: Array(21).fill("5551999990000") }).success, false);
  assert.equal(agentSettingsInput.safeParse({ ...ok, extra: 1 }).success, false);
});

test("reference matching mirrors the database: exact first, longest contains, ambiguity", () => {
  assert.equal(normalizeReference("  Olá,   QUERO  Ação "), "ola, quero acao");
  const refs = [
    { body: "promo crm", match_mode: "contains" as const, active: true, pipeline_id: "a", stage_id: "s", source: "meta_ads" as const },
    { body: "PROMO CRM", match_mode: "exact" as const, active: true, pipeline_id: "b", stage_id: "s", source: "google_ads" as const },
    { body: "crm promo", match_mode: "contains" as const, active: true, pipeline_id: "b", stage_id: "s", source: "meta_ads" as const },
    { body: "desligada", match_mode: "exact" as const, active: false, pipeline_id: null, stage_id: "s", source: "meta_ads" as const },
  ];
  assert.equal((matchReference("promo crm", refs) as any).reference.pipeline_id, "b");
  assert.equal(matchReference("oferta promo crm promo", refs).status, "ambiguous");
  assert.equal((matchReference("vi a PROMO CRM hoje", refs) as any).reference.pipeline_id, "a");
  assert.equal(matchReference("desligada", refs).status, "none");
});

test("move rule: a move outside the allowed move stages becomes a suggestion; null keeps the stage mapping", () => {
  const stages = [{ id: "n", title: "Novo" }, { id: "a", title: "Em atendimento" }, { id: "q", title: "Qualificado" }];
  const input = { current: "n", stages, stageMap: { novo: "n", atendimento: "a", qualificado: "q" }, mainFunnel: false, verdict: verdict(), messages: [{ from_me: false, body: "oi" }], criteria: { servedRegions: [], excludedRegions: [], services: [], requirements: "", adMessages: [] }, reply: "Olá, tudo bem?" };
  assert.equal(decideAgentMove(input).kind, "move");
  assert.equal(decideAgentMove({ ...input, moveStages: null }).target, "a");
  assert.equal(decideAgentMove({ ...input, moveStages: [] }).kind, "suggest");
  assert.equal(decideAgentMove({ ...input, moveStages: ["q"] }).kind, "suggest");
  assert.equal(decideAgentMove({ ...input, moveStages: ["a"] }).target, "a");
});
