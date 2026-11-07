import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupeKey, isOverdue, validateSuggestions } from "./client-tasks";

const msgs = [
  { id: "m1", body: "Preciso trocar o criativo da campanha até sexta 07/11" },
  { id: "m2", body: "A campanha parou de rodar ontem" },
  { id: "m3", body: "Pode ajustar a landing?" },
];
const base = { description: "", priority: "alta", dueDate: null, dueEvidence: null, status: "pendente", kind: "solicitacao", resolved: false };

describe("validação das tarefas sugeridas", () => {
  it("identifica pendências com citação literal", () => {
    const r = validateSuggestions([{ ...base, title: "Trocar criativo da campanha", sourceMessageId: "m1", quote: "trocar o criativo" }], msgs, []);
    assert.equal((r.suggestions).length, 1);
  });
  it("descarta citação inventada e solicitações resolvidas", () => {
    const r = validateSuggestions([
      { ...base, title: "Inventada", sourceMessageId: "m2", quote: "texto que não existe" },
      { ...base, title: "Ajustar landing", sourceMessageId: "m3", quote: "ajustar a landing", resolved: true },
    ], msgs, []);
    assert.equal((r.suggestions).length, 0);
    assert.equal(r.resolved, 1);
    assert.equal(r.invalid, 1);
  });
  it("remove prazo sem evidência literal", () => {
    const r = validateSuggestions([{ ...base, title: "Reativar campanha", sourceMessageId: "m2", quote: "parou de rodar", dueDate: "2026-11-10", dueEvidence: "dia 10" }], msgs, []);
    assert.equal(r.suggestions[0].dueDate, null);
    const ok = validateSuggestions([{ ...base, title: "Trocar criativo", sourceMessageId: "m1", quote: "trocar o criativo", dueDate: "2026-11-07", dueEvidence: "até sexta 07/11" }], msgs, []);
    assert.equal(ok.suggestions[0].dueDate, "2026-11-07");
  });
  it("não duplica tarefas existentes, concluídas ou repetidas", () => {
    const s = { ...base, title: "Trocar criativo da campanha", sourceMessageId: "m1", quote: "trocar o criativo" };
    assert.equal(validateSuggestions([s], msgs, [{ title: "Trocar Criativo da Campanha" }]).duplicates, 1);
    assert.equal(validateSuggestions([s], msgs, [{ title: "x", dedupe_key: dedupeKey("m1", s.title) }]).duplicates, 1);
    assert.equal((validateSuggestions([s, { ...s }], msgs, []).suggestions).length, 1);
  });
  it("marca atrasadas só se não concluídas", () => {
    assert.equal(isOverdue({ due_date: "2026-11-01", status: "pendente" }, "2026-11-05"), true);
    assert.equal(isOverdue({ due_date: "2026-11-01", status: "concluida" }, "2026-11-05"), false);
  });
});
