import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeadTimeline } from "./lead-timeline";

test("activity merges history, WhatsApp and e-mail newest first; audited entries are not removable", () => {
  const items = buildLeadTimeline({
    history: [{ id: "h1", date: "2026-11-01T10:00:00Z", text: "Ligação", kind: "whatsapp_call" }, { id: "h2", date: "2026-11-03T10:00:00Z", text: "Nota" }],
    messages: [{ id: "m1", fromMe: false, body: "Oi", sentAt: "2026-11-02T10:00:00Z" }],
    emails: [{ id: "e1", direction: "out", subject: "Proposta", body: "…", date: "2026-11-04T10:00:00Z" }],
  });
  assert.deepEqual(items.map((i) => i.key), ["e:e1", "h:h2", "w:m1", "h:h1"]);
  assert.equal(items.find((i) => i.key === "h:h1")!.removableId, undefined);
  assert.equal(items.find((i) => i.key === "h:h2")!.removableId, "h2");
});
