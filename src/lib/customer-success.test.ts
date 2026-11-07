import { test } from "node:test";
import assert from "node:assert/strict";
import { CS_STAGES, CS_HEALTH, csUpdateSchema, filterCsClients, gravonCsInstances, isCsClientMessage, riskForHealth, validateDiagnosis, type CsMessage } from "./customer-success";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const m: CsMessage = { id, body: "Estou insatisfeito com o atendimento", from_me: false, sent_at: "2026-11-05T00:00:00Z", instance: "gravon" };
const d = { health: "em_risco", reasons: ["Insatisfação expressa"], evidence: [{ messageId: id, quote: "Estou insatisfeito" }], actions: ["Revisar atendimento com o cliente"] };
test("six stages and three independent health classes", () => {
  assert.deepEqual(Object.values(CS_STAGES), ["Novo Cliente", "Onboarding", "Implementação", "Acompanhamento", "Renovação", "Encerrado"]);
  assert.deepEqual(Object.values(CS_HEALTH), ["Saudável", "Atenção", "Em risco"]);
  const input = csUpdateSchema.parse({ clientId: id, eventId: other, revision: 0, stage: "encerrado" });
  assert.equal(input.health, undefined);
  assert.equal(riskForHealth("em_risco"), "alto");
});
test("manual satisfaction requires reason, not a funnel move", () => {
  assert.throws(() => csUpdateSchema.parse({ clientId: id, eventId: other, revision: 0, health: "saudavel" }));
  const v = csUpdateSchema.parse({ clientId: id, eventId: other, revision: 0, health: "atencao", note: "Reclamação revisada" });
  assert.equal(v.stage, undefined);
});
test("diagnosis requires literal inbound evidence from the exact client", () => {
  assert.equal(validateDiagnosis(d, [m]).health, "em_risco");
  assert.throws(() => validateDiagnosis(d, [{ ...m, id: other }]));
  assert.throws(() => validateDiagnosis(d, [{ ...m, from_me: true }]));
  assert.throws(() => validateDiagnosis({ ...d, evidence: [{ messageId: id, quote: "quero cancelar" }] }, [m]));
  assert.throws(() => validateDiagnosis({ ...d, evidence: [] }, [m]));
});
test("only exclusive Gravon instances, exact contact and direct messages", () => {
  const instances = gravonCsInstances([{ instance: "gravon", company_key: "crm:1" }, { instance: "shared", company_key: "crm:1" }, { instance: "shared", company_key: "another" }, { instance: "third", company_key: "another" }]);
  assert.deepEqual(instances, ["gravon"]);
  const row = { phone: "5541998765432", instance: "gravon", remote_jid: "5541998765432@s.whatsapp.net", body: "Olá" };
  assert.equal(isCsClientMessage(row, "554198765432", instances), true);
  assert.equal(isCsClientMessage({ ...row, instance: "third" }, row.phone, instances), false);
  assert.equal(isCsClientMessage({ ...row, phone: "141998765432" }, row.phone, instances), false);
  assert.equal(isCsClientMessage({ ...row, remote_jid: "123@g.us" }, row.phone, instances), false);
  assert.equal(isCsClientMessage({ ...row, remote_jid: "123@lid" }, row.phone, instances), false);
});
test("central filters situation, health, risk, responsible and follow-up", () => {
  const base = { trade_name: "Ótica", status: "ativo", internal_responsible: "Ana", stage: "onboarding", health: "em_risco", last_followup_at: "2026-09-01T00:00:00Z" };
  const rows = [base, { ...base, trade_name: "Clínica", health: null, internal_responsible: "", last_followup_at: null }];
  const all = { search: "", status: "todos", risk: "todos", health: "todos", responsible: "todos", followup: "todos" };
  assert.equal(filterCsClients(rows, { ...all, risk: "alto", responsible: "Ana" }).length, 1);
  assert.equal(filterCsClients(rows, { ...all, health: "sem_avaliacao", followup: "nunca" }).length, 1);
  assert.equal(filterCsClients(rows, { ...all, status: "pausado" }).length, 0);
  assert.equal(filterCsClients(rows, { ...all, followup: "recente" }, Date.parse("2026-11-05")).length, 0);
  assert.equal(filterCsClients(rows, { ...all, followup: "atrasado" }, Date.parse("2026-11-05")).length, 2);
});