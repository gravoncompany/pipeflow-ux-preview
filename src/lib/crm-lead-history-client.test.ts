import { test } from "node:test";
import assert from "node:assert/strict";
import { crmLeadInput } from "./crm-leads-access";

const historyShape = crmLeadInput.shape.history.element;
const clientId = "00000000-0000-4000-8000-000000000001";
test("history entries created from a registered client keep the client link", () => {
  const entry = { id: `client:${clientId}:card`, date: "2026-11-05T12:00:00Z", text: "Card criado a partir do cadastro de cliente.", kind: "client_card_created", source: "clients", client: clientId, responsible: "admin" };
  assert.deepEqual(historyShape.parse(entry), entry);
});
test("unknown history keys are still rejected", () => {
  assert.equal(historyShape.safeParse({ id: "x", date: "", text: "", role: "admin" }).success, false);
});
