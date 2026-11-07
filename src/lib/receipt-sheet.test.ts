import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReceiptRoster, matchReceiptClient } from "./receipt-sheet";
test("green monthly roster includes unpaid clients without treating due values as receipts", () => {
 const rows = parseReceiptRoster([{ values: [{ formattedValue: "Nome do Cliente" }] }, { values: [{ formattedValue: "Servpress", effectiveFormat: { backgroundColor: { red: .57, green: .76, blue: .49 } } }, { formattedValue: "Gestão de Tráfego" }, { effectiveValue: { numberValue: 800 } }] }]);
 assert.equal(rows.length, 1); assert.equal(rows[0].frequency, "mensal"); assert.equal(rows[0].amount, 80000); assert.equal("received" in rows[0], false);
});
test("client match is exact unique, never fuzzy or ambiguous", () => {
 const clients = [{ id: "1", trade_name: "Tecfrio" }, { id: "2", trade_name: "Santa Catarina Refrigeração" }];
 assert.equal(matchReceiptClient("Tecfrio ", clients)?.id, "1"); assert.equal(matchReceiptClient("Santa Catarina", clients), null); assert.equal(matchReceiptClient("Tecfrio", [...clients, { id: "3", trade_name: "Tecfrio" }]), null);
});
test("roster ends at weekly total, other sheet sections are not clients", () => {
 const result = parseReceiptRoster([{ values: [{ formattedValue: "Nome do Cliente" }] }, { values: [{ formattedValue: "Nome do Cliente" }] }, { values: [{ formattedValue: "Duarte Refrigeração" }] }, { values: [{}, {}, { effectiveValue: { numberValue: 3402 } }] }, { values: [{ formattedValue: "Despesas" }] }]);
 assert.deepEqual(result.map(r => r.name), ["Duarte Refrigeração"]);
});