import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToday, type TodayLeadRow } from "./dashboard-today";

const lead = (over: Partial<TodayLeadRow>): TodayLeadRow => ({ id: "x", name: "Lead", company: "", stage: "lead-novo", pipelineId: null, whatsapp: "", nextAction: "", nextActionDate: null, ...over });
const today = "2026-11-04";

test("aguardando resposta: só quando a última mensagem do contato é do cliente", () => {
  const r = buildToday({ today, pipelineNames: {}, appointments: [], leads: [
    lead({ id: "a", whatsapp: "+55 11 98888-1111" }),
    lead({ id: "b", whatsapp: "+55 11 98888-2222" }),
  ], messages: [
    { phoneKey: "1188881111", fromMe: true, sentAt: "2026-11-04T10:00:00Z" },
    { phoneKey: "1188881111", fromMe: false, sentAt: "2026-11-04T11:00:00Z" },
    { phoneKey: "1188882222", fromMe: false, sentAt: "2026-11-04T09:00:00Z" },
    { phoneKey: "1188882222", fromMe: true, sentAt: "2026-11-04T09:30:00Z" },
  ] });
  assert.deepEqual(r.awaiting.map((l) => l.id), ["a"]);
});

test("retornos: hoje e atrasados ficam separados; fechados e perdidos não entram", () => {
  const r = buildToday({ today, pipelineNames: {}, appointments: [], messages: [], leads: [
    lead({ id: "hoje", nextActionDate: "2026-11-04" }),
    lead({ id: "atrasado", nextActionDate: "2026-11-01" }),
    lead({ id: "futuro", nextActionDate: "2026-11-05" }),
    lead({ id: "fechado", nextActionDate: "2026-11-01", stage: "fechado" }),
    lead({ id: "perda", nextActionDate: "2026-11-04", stage: "perda" }),
  ] });
  assert.deepEqual(r.returnsToday.map((l) => l.id), ["hoje"]);
  assert.deepEqual(r.overdue.map((l) => [l.id, l.daysLate]), [["atrasado", 3]]);
});

test("reuniões de hoje pelo dia de São Paulo, em ordem de horário, sem canceladas", () => {
  const r = buildToday({ today, pipelineNames: {}, messages: [], leads: [lead({ id: "l1", name: "Ana" })], appointments: [
    { id: "tarde", leadId: "l1", summary: "B", startsAt: "2026-11-04T18:00:00Z", endsAt: "2026-11-04T18:30:00Z", status: "scheduled" },
    { id: "manha", leadId: "l1", summary: "A", startsAt: "2026-11-04T12:00:00Z", endsAt: "2026-11-04T12:30:00Z", status: "scheduled" },
    // 01:00 UTC do dia 5 ainda é dia 4 em São Paulo (22:00).
    { id: "noite", leadId: "l1", summary: "C", startsAt: "2026-11-05T01:00:00Z", endsAt: "2026-11-05T01:30:00Z", status: "scheduled" },
    { id: "cancelada", leadId: "l1", summary: "D", startsAt: "2026-11-04T13:00:00Z", endsAt: "2026-11-04T13:30:00Z", status: "cancelled" },
    { id: "amanha", leadId: "l1", summary: "E", startsAt: "2026-11-05T12:00:00Z", endsAt: "2026-11-05T12:30:00Z", status: "scheduled" },
  ] });
  assert.deepEqual(r.meetings.map((m) => m.id), ["manha", "tarde", "noite"]);
  assert.equal(r.meetings[0].leadName, "Ana");
});
