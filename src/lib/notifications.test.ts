import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  automationNotification, automationReplyEventKey, cleanSnippet, defaultPrefs, enabledChannels,
  replyEventKey, replyNotification, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS,
} from "./notifications";
import { compileAutomation, type AutomationGraph, type GraphNode, type GraphEdge } from "./automations";

describe("preferências de notificação", () => {
  it("nasce tudo desligado (3 canais por evento)", () => {
    const prefs = defaultPrefs();
    assert.equal(prefs.length, NOTIFICATION_EVENTS.length * NOTIFICATION_CHANNELS.length);
    assert.ok(prefs.every((p) => !p.enabled));
  });

  it("mantém ligadas apenas as preferências salvas", () => {
    const prefs = defaultPrefs([{ event: "email_reply", channel: "push", enabled: true }]);
    assert.deepEqual(enabledChannels(prefs, "email_reply"), ["push"]);
  });

  it("push do diagnóstico exige sua própria preferência, sem reutilizar e-mail", () => {
    assert.deepEqual(enabledChannels(defaultPrefs([{event:"email_reply",channel:"push",enabled:true}]),"diagnosis_received"),[]);
    assert.deepEqual(enabledChannels(defaultPrefs([{event:"diagnosis_received",channel:"push",enabled:true}]),"diagnosis_received"),["push"]);
  });

  it("ordem dos canais é push, e-mail, WhatsApp", () => {
    const prefs = defaultPrefs([
      { event: "email_reply", channel: "whatsapp", enabled: true },
      { event: "email_reply", channel: "push", enabled: true },
    ]);
    assert.deepEqual(enabledChannels(prefs, "email_reply"), ["push", "whatsapp"]);
  });
});

describe("mensagem de resposta de e-mail", () => {
  it("tocar abre o card do contato", () => {
    const m = replyNotification({ contact: "ana@empresa.com", company: "Empresa Ana", subject: "Quero saber mais", leadId: "abc-123" });
    assert.equal(m.title, "Resposta de e-mail — Empresa Ana");
    assert.equal(m.url, "/?lead=abc-123");
    assert.match(m.body, /Quero saber mais/);
  });

  it("sem card, abre as conversas; sem empresa, usa o e-mail", () => {
    const m = replyNotification({ contact: "ana@empresa.com", company: "", subject: "", leadId: null });
    assert.equal(m.url, "/conversas");
    assert.match(m.title, /ana@empresa\.com/);
  });

  it("limpa HTML e quebras de linha do texto", () => {
    assert.equal(cleanSnippet("<b>Olá</b>\n\n  tudo <i>bem</i>?"), "Olá tudo bem ?");
  });
});

describe("deduplicação", () => {
  it("a chave da resposta é por mensagem do Gmail", () => {
    assert.equal(replyEventKey("gmail-1"), "email-reply:gmail-1");
    assert.notEqual(replyEventKey("gmail-1"), replyEventKey("gmail-2"));
  });

  it("a notificação da automação tem chave própria (não colide com o aviso geral)", () => {
    assert.notEqual(automationReplyEventKey("gmail-1"), replyEventKey("gmail-1"));
  });
});

describe("mensagem personalizada da automação", () => {
  it("preenche nome e empresa", () => {
    assert.equal(
      automationNotification("{{empresa}} respondeu! Falar com {{nome}}.", { contact: "ana@empresa.com", company: "Empresa Ana" }),
      "Empresa Ana respondeu! Falar com ana@empresa.com.",
    );
  });

  it("mensagem vazia vira texto padrão", () => {
    assert.equal(automationNotification("   ", { contact: "a@b.com", company: "" }), "Resposta recebida na automação.");
  });
});

describe('bloco "Enviar notificação" no construtor', () => {
  const base = (): { nodes: GraphNode[]; edges: GraphEdge[] } => ({
    nodes: [
      { id: "t", kind: "trigger", x: 0, y: 0, data: { pipelineId: null, mode: "entry" } },
      { id: "e1", kind: "email", x: 0, y: 1, data: { subject: "Oi", body: "Olá, {{nome}}!", cta: "" } },
      { id: "w", kind: "wait", x: 0, y: 2, data: { amount: 1, unit: "days" } },
      { id: "r", kind: "if_reply", x: 0, y: 3, data: {} as Record<string, never> },
      { id: "n", kind: "notify", x: 1, y: 3, data: { channel: "push", message: "{{empresa}} respondeu!" } },
      { id: "f", kind: "end", x: 1, y: 4, data: {} as Record<string, never> },
      { id: "fim", kind: "end", x: 0, y: 5, data: {} as Record<string, never> },
    ],
    edges: [
      { id: "1", source: "t", target: "e1", branch: null },
      { id: "2", source: "e1", target: "w", branch: null },
      { id: "3", source: "w", target: "r", branch: null },
      { id: "4", source: "r", target: "n", branch: "yes" },
      { id: "5", source: "n", target: "f", branch: null },
      { id: "6", source: "r", target: "fim", branch: "no" },
    ],
  });

  it("compila a notificação no caminho Sim de Respondeu?", () => {
    const r = compileAutomation(base() as AutomationGraph);
    assert.ok(r.ok, r.ok ? "" : r.errors.join("; "));
    if (r.ok) assert.deepEqual(r.compiled.onReplyNotify, { channel: "push", message: "{{empresa}} respondeu!" });
  });

  it("exige mensagem no bloco de notificação", () => {
    const g = base();
    (g.nodes.find((n) => n.id === "n") as { data: { message: string } }).data.message = "  ";
    const r = compileAutomation(g as AutomationGraph);
    assert.ok(!r.ok);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("Enviar notificação")));
  });

  it("bloco de notificação fora do caminho Sim não é aceito no fluxo principal", () => {
    const g = base();
    g.edges = g.edges.filter((e) => e.id !== "4" && e.id !== "5");
    g.edges.push({ id: "4", source: "r", target: "fim", branch: "yes" });
    g.edges.push({ id: "5", source: "r", target: "n", branch: "no" });
    g.edges.push({ id: "7", source: "n", target: "fim", branch: null });
    const r = compileAutomation(g as AutomationGraph);
    assert.ok(!r.ok);
  });
});
