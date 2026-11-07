import { test } from "node:test";
import assert from "node:assert/strict";
import { itemDays, mergeAgendaItems, spClock, weekBounds, weekStartOf } from "./agenda-week";

test("horário exibido no fuso de São Paulo, inclusive perto da meia-noite", () => {
  assert.deepEqual(spClock("2026-11-04T13:30:00Z"), { day: "2026-11-04", minutes: 10 * 60 + 30 });
  assert.deepEqual(spClock("2026-11-05T01:15:00Z"), { day: "2026-11-04", minutes: 22 * 60 + 15 });
});

test("semana começa na segunda e cobre 00:00 a 00:00 de São Paulo", () => {
  assert.equal(weekStartOf("2026-11-04"), "2026-11-02");
  assert.equal(weekStartOf("2026-11-08"), "2026-11-02");
  assert.deepEqual(weekBounds("2026-11-02"), { from: "2026-11-02T03:00:00.000Z", to: "2026-11-09T03:00:00.000Z" });
});

test("reunião do CRM aparece uma vez mesmo vindo também do Google Agenda", () => {
  const items = mergeAgendaItems(
    [{ id: "a1", event_id: "g1", summary: "Reunião com Ana", starts_at: "2026-11-04T13:00:00Z", ends_at: "2026-11-04T13:30:00Z", status: "scheduled", lead_id: "l1" },
     { id: "a2", event_id: "g9", summary: "Cancelada", starts_at: "2026-11-04T15:00:00Z", ends_at: "2026-11-04T15:30:00Z", status: "cancelled", lead_id: "l1" }],
    [{ id: "g1", summary: "Reunião com Ana", start: "2026-11-04T13:00:00.000Z", end: "2026-11-04T13:30:00.000Z", allDay: false },
     { id: "g2", summary: "Dentista", start: "2026-11-04T18:00:00.000Z", end: "2026-11-04T19:00:00.000Z", allDay: false }],
    { l1: "Ana" },
  );
  assert.deepEqual(items.map((i) => [i.kind, i.id, i.subtitle]), [["crm", "a1", "Ana"], ["google", "g2", "Google Agenda"]]);
});

test("evento de dia inteiro usa a data final exclusiva do Google", () => {
  assert.deepEqual(itemDays({ key: "k", kind: "google", id: "x", summary: "Feriado", subtitle: "", start: "2026-11-02", end: "2026-11-04", allDay: true }), ["2026-11-02", "2026-11-03"]);
});
