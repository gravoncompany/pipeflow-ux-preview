import { test } from "node:test";
import assert from "node:assert/strict";
import { pipeflowCrmTemplate } from "./commercial-agent-templates";

const stages = [
  { id: "lead-novo", title: "Lead Novo" }, { id: "tentando", title: "Tentando Contato" }, { id: "contato", title: "Contato Realizado" },
  { id: "qualificacao", title: "Qualificação" }, { id: "fechado", title: "Fechado" }, { id: "perda", title: "Perda" },
];

test("Pipeflow CRM template only allows early stages of the funnel and never closing stages", () => {
  const t = pipeflowCrmTemplate(stages);
  assert.deepEqual(t.allowedStages, ["lead-novo", "tentando", "contato", "qualificacao"]);
  assert.deepEqual(t.stageMap, { novo: "lead-novo", atendimento: "contato", qualificado: "qualificacao" });
});

test("Pipeflow CRM template covers the four product features and defers the promotion to registered knowledge", () => {
  const t = pipeflowCrmTemplate(stages);
  assert.deepEqual(t.services, ["CRM com IA", "Atendimento pelo WhatsApp", "Funil de vendas", "Prospecção B2B"]);
  assert.match(t.instructions, /75% OFF no primeiro mês: informe somente as condições cadastradas no Conhecimento Comercial/);
});

test("Pipeflow CRM template ignores stages missing from a different funnel", () => {
  const t = pipeflowCrmTemplate([{ id: "a", title: "Entrada" }]);
  assert.deepEqual(t.allowedStages, []);
  assert.deepEqual(t.stageMap, { novo: undefined, atendimento: undefined, qualificado: undefined });
});
