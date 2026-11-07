import { test } from "node:test";
import assert from "node:assert/strict";
import { chargeInput, clientInput, paymentInput, recurrenceStepDays, taskInput } from "./crm-clients";

const validClient = {
  id: null, leadId: null, tradeName: "Ótica Exemplo", legalName: "", cnpj: "", contactName: "", phone: "",
  whatsapp: "", email: "", address: "", website: "", relationshipStart: null, services: ["Tráfego pago"],
  status: "implantacao", internalResponsible: "", reminderDays: 5, notes: "", revision: 0,
};

test("cadastro de cliente exige nome fantasia e situação válida", () => {
  assert.ok(clientInput.safeParse(validClient).success);
  assert.equal(clientInput.safeParse({ ...validClient, tradeName: "A" }).success, false);
  assert.equal(clientInput.safeParse({ ...validClient, status: "qualquer" }).success, false);
  assert.equal(clientInput.safeParse({ ...validClient, reminderDays: 61 }).success, false);
});

test("CNPJ aceita vazio ou 14 dígitos; rejeita formatos inválidos", () => {
  assert.ok(clientInput.safeParse({ ...validClient, cnpj: "" }).success);
  assert.ok(clientInput.safeParse({ ...validClient, cnpj: "50621449000145" }).success);
  assert.equal(clientInput.safeParse({ ...validClient, cnpj: "50.621.449/0001-45" }).success, false);
  assert.equal(clientInput.safeParse({ ...validClient, cnpj: "123" }).success, false);
});

test("cobrança exige descrição, vencimento e recorrência conhecida", () => {
  const base = { id: null, clientId: "00000000-0000-4000-8000-000000000001", description: "Mensalidade", amount: 1500, dueDate: "2026-11-10", recurrence: "mensal", recurrenceInterval: 0, paymentMethod: "Pix", revision: 0 };
  assert.ok(chargeInput.safeParse(base).success);
  assert.ok(chargeInput.safeParse({ ...base, recurrence: "personalizada", recurrenceInterval: 21 }).success);
  assert.equal(chargeInput.safeParse({ ...base, recurrence: "diaria" }).success, false);
  assert.equal(chargeInput.safeParse({ ...base, dueDate: "10/11/2026" }).success, false);
  assert.equal(chargeInput.safeParse({ ...base, amount: -1 }).success, false);
});

test("pagamento exige confirmação literal e valor positivo", () => {
  const base = { chargeId: "00000000-0000-4000-8000-000000000001", amount: 1500, method: "Pix", note: "", confirmed: true as const };
  assert.ok(paymentInput.safeParse(base).success);
  assert.equal(paymentInput.safeParse({ ...base, confirmed: false }).success, false);
  assert.equal(paymentInput.safeParse({ ...base, amount: 0 }).success, false);
});

test("tarefa usa apenas status e prioridades conhecidos", () => {
  const base = { id: null, clientId: "00000000-0000-4000-8000-000000000001", title: "Ligar para o cliente", description: "", responsible: "", priority: "media", dueDate: null, status: "pendente", revision: 0 };
  assert.ok(taskInput.safeParse(base).success);
  assert.equal(taskInput.safeParse({ ...base, status: "feita" }).success, false);
  assert.ok(taskInput.safeParse({ ...base, priority: "urgente" }).success);
  assert.equal(taskInput.safeParse({ ...base, priority: "critica" }).success, false);
});

test("passos de recorrência seguem a regra da RPC", () => {
  assert.equal(recurrenceStepDays("semanal", 0), 7);
  assert.equal(recurrenceStepDays("quinzenal", 0), 14);
  assert.equal(recurrenceStepDays("mensal", 0), "month");
  assert.equal(recurrenceStepDays("personalizada", 21), 21);
  assert.equal(recurrenceStepDays("personalizada", 0), null);
  assert.equal(recurrenceStepDays("unica", 0), null);
});
