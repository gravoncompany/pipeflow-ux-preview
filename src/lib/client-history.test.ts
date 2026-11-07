import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClientHistory } from "./client-history";
import { parseClientListSearch } from "./client-list-state";

test("Histórico do cliente vem da atividade mais recente para a mais antiga", () => {
  const items = buildClientHistory({
    client: { id: "c1", created_at: "2026-01-01T10:00:00Z" },
    records: [{ id: "r1", created_at: "2026-03-01T10:00:00Z", kind: "observacao", description: "Reunião de alinhamento" }],
    tasks: [{ id: "t1", created_at: "2026-05-01T10:00:00Z", title: "Enviar relatório" }],
    documents: [{ id: "d1", created_at: "2026-02-01T10:00:00Z", name: "contrato.pdf" }],
  }, {}, new Date("2026-11-04T12:00:00Z"));
  assert.deepEqual(items.map((i) => i.id), ["task-t1", "rec-r1", "doc-d1", "client-c1"]);
});

test("Reuniões futuras não entram no histórico", () => {
  const items = buildClientHistory({
    client: { id: "c1", created_at: "2026-01-01T10:00:00Z" },
    appointments: [
      { id: "a1", starts_at: "2026-10-01T10:00:00Z", summary: "Passada" },
      { id: "a2", starts_at: "2026-12-01T10:00:00Z", summary: "Futura" },
    ],
  }, {}, new Date("2026-11-04T12:00:00Z"));
  assert.deepEqual(items.map((i) => i.id), ["appt-a1", "client-c1"]);
});

test("Busca e situação da lista de clientes ficam na URL; 'todos' não é guardado", () => {
  assert.deepEqual(parseClientListSearch({ q: "odonto", situacao: "ativo" }), { q: "odonto", situacao: "ativo" });
  assert.deepEqual(parseClientListSearch({ q: "  ", situacao: "todos" }), { q: undefined, situacao: undefined });
});
