import { PRIORITY_ORDER } from "./client-tasks";

export type TaskSort = "custom" | "priority" | "due" | "created" | "responsible";
type T = { id: string; priority: string; due_date: string | null; created_at: string; responsible: string };

const prio = (p: string) => PRIORITY_ORDER[p as keyof typeof PRIORITY_ORDER] ?? 9;

/** Custom order: new (unsaved) tasks on top newest first, then saved positions ascending. Never depends on status. */
export function sortTasks<X extends T>(tasks: X[], sort: TaskSort, positions: Record<string, number>): X[] {
  const list = [...tasks];
  switch (sort) {
    case "priority": return list.sort((a, b) => prio(a.priority) - prio(b.priority) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    case "due": return list.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || prio(a.priority) - prio(b.priority));
    case "created": return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "responsible": return list.sort((a, b) => (a.responsible || "\uffff").localeCompare(b.responsible || "\uffff", "pt-BR") || prio(a.priority) - prio(b.priority));
    default: return list.sort((a, b) => {
      const pa = positions[a.id], pb = positions[b.id];
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return 1;
      if (pb !== undefined) return -1;
      return b.created_at.localeCompare(a.created_at);
    });
  }
}
