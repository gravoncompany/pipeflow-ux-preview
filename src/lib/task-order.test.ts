import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortTasks } from "./task-order";

const t = (id: string, priority: string, due: string | null, created: string, responsible = "", status = "pendente") => ({ id, priority, due_date: due, created_at: created, responsible, status });
const list = [t("a", "baixa", "2026-11-10", "2026-11-01"), t("b", "urgente", null, "2026-11-02", "Ana", "concluida"), t("c", "alta", "2026-11-06", "2026-11-03", "Bruno")];

describe("sortTasks", () => {
  it("custom order follows saved positions regardless of status", () => {
    assert.deepEqual(sortTasks(list, "custom", { c: 1, b: 2, a: 3 }).map(x => x.id), ["c", "b", "a"]);
  });
  it("tasks without a saved position appear first, newest first", () => {
    assert.deepEqual(sortTasks(list, "custom", { a: 1 }).map(x => x.id), ["c", "b", "a"]);
  });
  it("sorts by priority, due date, creation and responsible", () => {
    assert.deepEqual(sortTasks(list, "priority", {}).map(x => x.id), ["b", "c", "a"]);
    assert.deepEqual(sortTasks(list, "due", {}).map(x => x.id), ["c", "a", "b"]);
    assert.deepEqual(sortTasks(list, "created", {}).map(x => x.id), ["c", "b", "a"]);
    assert.deepEqual(sortTasks(list, "responsible", {}).map(x => x.id), ["b", "c", "a"]);
  });
});
