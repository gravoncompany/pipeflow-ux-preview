import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToday } from "./dashboard-today";
import { pendingIdsFor } from "./pipeline-pending";

test("pipeline shortcuts use the Hoje rules and only the open funnel's cards", () => {
  const lead = (id: string, pipelineId: string | null, over: Record<string, unknown> = {}) => ({ id, name: id, company: "", stage: "lead-novo", pipelineId, whatsapp: "", nextAction: "", nextActionDate: null, ...over });
  const today = buildToday({
    today: "2026-11-04",
    leads: [
      lead("wait-main", null, { whatsapp: "5551988887777" }),
      lead("today-main", null, { nextActionDate: "2026-11-04" }),
      lead("late-main", null, { nextActionDate: "2026-11-01" }),
      lead("late-other", "p2", { nextActionDate: "2026-11-02" }),
      lead("late-closed", null, { nextActionDate: "2026-11-01", stage: "fechado" }),
    ],
    messages: [{ phoneKey: "51988887777", fromMe: false, sentAt: "2026-11-04T10:00:00Z" }],
    appointments: [], pipelineNames: { p2: "Outbound" },
  });
  const main = pendingIdsFor(today, ["wait-main", "today-main", "late-main", "late-closed"]);
  assert.deepEqual([...main.today], ["today-main"]);
  assert.deepEqual([...main.overdue], ["late-main"]);
  const other = pendingIdsFor(today, ["late-other"]);
  assert.deepEqual([...other.overdue], ["late-other"]);
  assert.equal(other.today.size, 0);
  assert.equal(pendingIdsFor(null, ["x"]).awaiting.size, 0);
});
