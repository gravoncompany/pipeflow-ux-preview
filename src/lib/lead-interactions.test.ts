import { describe, it } from "node:test";
import assert from "node:assert/strict";
function expect(value: unknown) { return { toBe: (expected: unknown) => assert.equal(value, expected), toBeNull: () => assert.equal(value, null) }; }
import { interactionSchema, manualEntry, parseEvolutionCall, interactionDate } from "./lead-interactions";

describe("WhatsApp call evidence", () => {
  it("termination is not evidence of no answer", () => { expect(parseEvolutionCall({ id: "test", from: "5511999999999@s.whatsapp.net", status: "terminate" })?.result).toBe("unknown"); });
  it("accept is evidence of answering", () => { expect(parseEvolutionCall({ id: "test", from: "5511999999999@s.whatsapp.net", status: "accept" })?.result).toBe("answered"); });
  it("reject does not prove busy or unanswered", () => { expect(parseEvolutionCall({ id: "test", from: "5511999999999@s.whatsapp.net", status: "reject" })?.result).toBe("unknown"); });
  it("unknown direction and caller are not invented", () => { expect(parseEvolutionCall({ id: "test", from: "5511999999999@s.whatsapp.net", status: "offer", fromMe: true })?.direction).toBe("unknown"); });
  it("missing timestamps are not replaced with reception time", () => { expect(parseEvolutionCall({ id: "test", from: "5511999999999@s.whatsapp.net", status: "offer" })?.date).toBe(""); });
  it("groups are excluded", () => { expect(parseEvolutionCall({ id: "test", from: "group@g.us", status: "offer" })?.group).toBe(true); });
  it("raw websocket packets cannot be interpreted as calls", () => { expect(parseEvolutionCall({ event: "CB:call", packet: {} })).toBeNull(); });
});
describe("Manual interactions", () => {
  it("keeps entered Brasília time consistent with displayed history", () => { expect(interactionDate("2026-10-26T14:10").toISOString()).toBe("2026-10-26T17:10:00.000Z"); });
  const input = { leadId: "00000000-0000-4000-8000-000000000001", id: "00000000-0000-4000-8000-000000000002", type: "whatsapp_call" as const, date: "2026-10-26T17:00:00.000Z", result: "unknown" as const, note: "Teste", responsible: "" };
  it("accepts all four requested results", () => { for (const result of ["answered", "unanswered", "busy", "unknown"]) expect(interactionSchema.safeParse({ ...input, result }).success).toBe(true); });
  it("preserves provided time and optional responsible", () => { const entry = manualEntry({ ...input, responsible: "Atendente de teste" }); expect(entry.date).toBe("2026-10-26T17:00:00.000Z"); expect(entry.responsible).toBe("Atendente de teste"); });
  it("has no automatic responsible", () => { expect(manualEntry(input).responsible).toBe(""); });
  it("rejects injected company or instance", () => { expect(interactionSchema.safeParse({ ...input, company: "other" }).success).toBe(false); expect(interactionSchema.safeParse({ ...input, instance: "other" }).success).toBe(false); });
});