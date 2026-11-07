import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rowToLead } from "./lead-mapper";
import { leadNotifications, latestLeadUpdate, updateKind } from "./lead-notifications";
describe("atualizações dos cards", () => {
  it("mostra a anotação mais recente e não inventa aviso sem histórico", () => {
    const lead = rowToLead({ id: "a", history: [{ id: "old", date: "2026-10-24", text: "Etapa alterada" }, { id: "new", date: "2026-10-25T05:12:00Z", text: "Anotações internas atualizadas", kind: "note" }] });
    assert.equal(latestLeadUpdate(lead)?.id, "new"); assert.equal(updateKind(latestLeadUpdate(lead) ?? lead.history[0]), "Anotação");
    assert.equal(latestLeadUpdate(rowToLead({ id: "empty" })), null);
  });
  it("distingue eventos de leads diferentes e ordena atualizações", () => {
    const a = rowToLead({ id: "a", history: [{ id: "same", date: "2026-10-24", text: "Atualizado" }] });
    const b = rowToLead({ id: "b", history: [{ id: "same", date: "2026-10-25", text: "Atualizado" }] });
    assert.deepEqual(leadNotifications([a,b]).map((n) => n.id), ["b:same", "a:same"]);
  });
});