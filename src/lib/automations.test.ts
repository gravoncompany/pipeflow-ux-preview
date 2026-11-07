import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleBody, automationGraph, runBlocker, compileAutomation, defaultAutomationGraph, fillCompanyVars, isRunToken, landingWithUtms, safeLandingUrl,
  type AutomationGraph,
} from "./automations";
import { flowInput, stepOffsetHours } from "./email-flows";

const PIPE = "96b8487f-0d7a-40cc-850b-6ae0965db0b8";
const compile = (g: AutomationGraph) => {
  const r = compileAutomation(g);
  if (!r.ok) throw new Error(r.errors.join(" | "));
  return r.compiled;
};

describe("modelo padrão", () => {
  const c = compile(defaultAutomationGraph(PIPE));
  it("tem cinco e-mails nos dias 1, 3, 7, 12 e 18", () => {
    assert.deepEqual(c.steps.map((s) => s.day), [1, 3, 7, 12, 18]);
    assert.equal(c.steps.every((s) => s.hours === 0), true);
  });
  it("primeiro e-mail é o texto padrão da Gravon; os seguintes passam pela Gravon IA", () => {
    assert.deepEqual(c.steps.map((s) => s.ai), [false, true, true, true, true]);
  });
  it("todos os e-mails levam ao diagnóstico", () => { assert.equal(c.steps.every((s) => s.cta), true); assert.equal(c.usesLink, true); });
  it("ações: resposta avança para Contato Realizado; formulário vai para Qualificação com etiqueta quente", () => {
    assert.equal(c.onReply?.stage, "contato-realizado");
    assert.equal(c.onForm?.stage, "qualificacao"); assert.equal(c.onForm?.tag, "quente");
    assert.match(c.onFinish?.status ?? "", /concluída/);
    assert.equal(c.finishAfterHours, 72);
  });
  it("primeiro e-mail aceito move para Tentando Contato e a cadência continua", () => {
    assert.deepEqual(c.stepActions, [{ step: 0, actions: { stage: "tentando-contato", tag: "", status: "" } }]);
    assert.equal(c.steps.length, 5);
  });
  it("o desenho passa na validação de entrada e as etapas cabem no fluxo de e-mail", () => {
    assert.equal(automationGraph.safeParse(defaultAutomationGraph(PIPE)).success, true);
    assert.equal(flowInput.safeParse({ id: null, revision: 0, name: "Teste", steps: c.steps, aiEnabled: true, approveAi: false }).success, true);
  });
});

const n = (id: string, kind: string, data: object = {}) => ({ id, kind, x: 0, y: 0, data }) as AutomationGraph["nodes"][number];
const e = (s: string, t: string, branch: "yes" | "no" | null = null) => ({ id: `${s}-${t}`, source: s, target: t, branch });
const email = (id: string) => n(id, "email", { subject: "Oi {{empresa}}", body: "Olá {{nome}}", cta: "" });

describe("intervalos", () => {
  it("aguardar em horas vira dia + hora da etapa", () => {
    const c = compile({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), n("w", "wait", { amount: 30, unit: "hours" }), email("b"), n("f", "end")],
      edges: [e("t", "a"), e("a", "w"), e("w", "b"), e("b", "f")] });
    assert.deepEqual(c.steps.map((s) => [s.day, s.hours]), [[1, 0], [2, 6]]);
    assert.equal(stepOffsetHours(c.steps[1]), 30);
  });
  it("dois e-mails sem espera entre eles são recusados", () => {
    const r = compileAutomation({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), email("b"), n("f", "end")], edges: [e("t", "a"), e("a", "b"), e("b", "f")] });
    assert.equal(r.ok, false);
  });
});

describe("estrutura", () => {
  it("exige terminar em Encerrar", () => {
    const r = compileAutomation({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a")], edges: [e("t", "a")] });
    assert.equal(r.ok, false);
  });
  it("condição sem caminho Não é recusada", () => {
    const r = compileAutomation({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), n("c", "if_reply"), n("f", "end")], edges: [e("t", "a"), e("a", "c"), e("c", "f", "yes")] });
    assert.equal(r.ok, false);
  });
  it("caminho Sim só aceita Atualizar card e Encerrar", () => {
    const r = compileAutomation({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), n("c", "if_form"), email("x"), n("f", "end"), n("g", "end")],
      edges: [e("t", "a"), e("a", "c"), e("c", "x", "yes"), e("x", "g"), e("c", "f", "no")] });
    assert.equal(r.ok, false);
  });
  it("blocos soltos e ciclos são recusados", () => {
    assert.equal(compileAutomation({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), n("f", "end"), n("w", "wait", { amount: 1, unit: "days" })], edges: [e("t", "a"), e("a", "f")] }).ok, false);
    assert.equal(compileAutomation({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), n("w", "wait", { amount: 1, unit: "days" })], edges: [e("t", "a"), e("a", "w"), e("w", "a")] }).ok, false);
  });
  it("Gravon IA precisa vir antes de um e-mail", () => {
    assert.equal(compileAutomation({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), n("i", "ai"), n("f", "end")], edges: [e("t", "a"), e("a", "i"), e("i", "f")] }).ok, false);
  });
});

describe("Atualizar card no caminho principal", () => {
  const wait = (id: string, d = 2) => n(id, "wait", { amount: d, unit: "days" });
  it("e-mail → Atualizar card → Aguardar 2 dias → Respondeu? continua a cadência", () => {
    const c = compile({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), n("u", "update_card", { stage: "tentando-contato", tag: "", status: "" }), wait("w"),
      n("r", "if_reply"), n("ru", "update_card", { stage: "contato-realizado", tag: "", status: "" }), n("rf", "end"), email("b"), n("f", "end")],
      edges: [e("t", "a"), e("a", "u"), e("u", "w"), e("w", "r"), e("r", "ru", "yes"), e("ru", "rf"), e("r", "b", "no"), e("b", "f")] });
    assert.deepEqual(c.steps.map((s) => s.day), [1, 3]);
    assert.deepEqual(c.stepActions, [{ step: 0, actions: { stage: "tentando-contato", tag: "", status: "" } }]);
    assert.equal(c.onReply?.stage, "contato-realizado");
    assert.equal(c.onFinish, null);
  });
  it("Atualizar card antes de qualquer e-mail é recusado", () => {
    const r = compileAutomation({ nodes: [n("t", "trigger", { pipelineId: PIPE }), n("u", "update_card", { stage: "tentando-contato", tag: "", status: "" }), email("a"), n("f", "end")],
      edges: [e("t", "u"), e("u", "a"), e("a", "f")] });
    assert.equal(r.ok, false);
  });
  it("Atualizar card depois de uma espera e antes de outro e-mail é recusado", () => {
    const r = compileAutomation({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), wait("w"), n("u", "update_card", { stage: "", tag: "x", status: "" }), email("b"), n("f", "end")],
      edges: [e("t", "a"), e("a", "w"), e("w", "u"), e("u", "b"), e("b", "f")] });
    assert.equal(r.ok, false);
  });
  it("no fim, depois da espera, continua sendo a conclusão da cadência", () => {
    const c = compile({ nodes: [n("t", "trigger", { pipelineId: PIPE }), email("a"), wait("w", 3), n("u", "update_card", { stage: "", tag: "", status: "Sem resposta" }), n("f", "end")],
      edges: [e("t", "a"), e("a", "w"), e("w", "u"), e("u", "f")] });
    assert.equal(c.onFinish?.status, "Sem resposta"); assert.equal(c.finishAfterHours, 72); assert.deepEqual(c.stepActions, []);
  });
});

describe("links", () => {
  it("só aceita landing https", () => {
    assert.equal(safeLandingUrl("http://gravoncompany.com"), null);
    assert.equal(safeLandingUrl("https://gravoncompany.com/diagnostico"), "https://gravoncompany.com/diagnostico");
  });
  it("destino do clique leva UTMs com o identificador do card", () => {
    const u = new URL(landingWithUtms("https://gravoncompany.com/diagnostico?x=1", "outbound", "a".repeat(32)));
    assert.equal(u.searchParams.get("utm_content"), `pf-${"a".repeat(32)}`);
    assert.equal(u.searchParams.get("utm_medium"), "email");
    assert.equal(u.searchParams.get("x"), "1");
  });
  it("token do link tem 32 caracteres hexadecimais", () => { assert.equal(isRunToken("0".repeat(32)), true); assert.equal(isRunToken("../x"), false); });
  it("monta o botão com o link rastreado e substitui a variável", () => {
    assert.equal(assembleBody("Veja {{link_diagnostico}}", "Quero", "https://crm/r/1"), "Veja https://crm/r/1\n\n[botão: Quero | https://crm/r/1]");
  });
  it("sem segmento/cidade usa termos neutros", () => {
    assert.equal(fillCompanyVars("{{segmento}} em {{cidade}}", { segment: "", city: "Porto Alegre" }), "seu segmento em Porto Alegre");
  });
});

describe("motivo de espera do envio", () => {
  const base = { automationState: "active", flowState: "active", agentEnabled: true, status: "active", nextSendAt: new Date().toISOString() };
  it("automação pausada explica por que o e-mail não saiu", () => { assert.match(runBlocker({ ...base, automationState: "paused" }) ?? "", /pausada/); });
  it("Agente Comercial desligado", () => { assert.match(runBlocker({ ...base, agentEnabled: false }) ?? "", /desligado/); });
  it("atrasado mais de 20 minutos", () => { assert.match(runBlocker({ ...base, nextSendAt: new Date(Date.now() - 3600e3).toISOString() }) ?? "", /atrasado/); });
  it("tudo certo ou card já parado: sem aviso", () => {
    assert.equal(runBlocker(base), null);
    assert.equal(runBlocker({ ...base, automationState: "paused", status: "stopped" }), null);
  });
});
