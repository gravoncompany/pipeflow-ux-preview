import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignClients, clientLeadIds, conversationCampaignLeads, filterConversations } from "./campaign-recipients";

const client = (over: Record<string, unknown>) => ({ id: "c1", lead_id: null, trade_name: "Ótica Mello", contact_name: "Maria", whatsapp: "", phone: "", status: "ativo", ...over }) as Parameters<typeof campaignClients>[0][number];

test("a client uses its linked card first", () => {
  const [c] = campaignClients([client({ lead_id: "L1", whatsapp: "5541999990000" })], [{ id: "L2", whatsapp: "5541999990000" }]);
  assert.equal(c.leadId, "L1");
});

test("a client without link uses the single card with the same WhatsApp (ninth digit tolerant)", () => {
  const [c] = campaignClients([client({ whatsapp: "(41) 99999-0000" })], [{ id: "L2", whatsapp: "554199990000" }]);
  assert.equal(c.leadId, "L2");
});

test("ambiguous or missing card leaves the client out instead of creating records", () => {
  const [amb] = campaignClients([client({ whatsapp: "5541999990000" })], [{ id: "A", whatsapp: "5541999990000" }, { id: "B", whatsapp: "41999990000" }]);
  assert.equal(amb.leadId, null);
  const [none] = campaignClients([client({ whatsapp: "5541988887777" })], []);
  assert.equal(none.leadId, null);
  assert.deepEqual(clientLeadIds([amb, none]), []);
});

test("ended clients are not offered and duplicate cards are counted once", () => {
  const list = campaignClients([client({ id: "a", lead_id: "L1" }), client({ id: "b", lead_id: "L1" }), client({ id: "c", lead_id: "L3", status: "encerrado" })], []);
  assert.equal(list.length, 2);
  assert.deepEqual(clientLeadIds(list), ["L1"]);
});

const convs = [
  { phoneKey: "1", leadId: "L1", clientId: "c1" },
  { phoneKey: "2", leadId: "L2", clientId: null },
  { phoneKey: "3", leadId: null, clientId: null },
];

test("conversation filters separate clients, leads and outside contacts and match tags", () => {
  const tags = new Map([["L2", ["quente"]]]);
  assert.deepEqual(filterConversations(convs, "clientes", "all", tags).map((c) => c.phoneKey), ["1"]);
  assert.deepEqual(filterConversations(convs, "leads", "all", tags).map((c) => c.phoneKey), ["2"]);
  assert.deepEqual(filterConversations(convs, "fora", "all", tags).map((c) => c.phoneKey), ["3"]);
  assert.deepEqual(filterConversations(convs, "all", "quente", tags).map((c) => c.phoneKey), ["2"]);
});

test("selected conversations become unique lead ids; contacts outside the CRM are counted, not added", () => {
  const r = conversationCampaignLeads([...convs, { phoneKey: "4", leadId: "L1", clientId: null }], new Set(["1", "3", "4"]));
  assert.deepEqual(r.leadIds, ["L1"]);
  assert.equal(r.outside, 1);
});
