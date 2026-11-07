import { test } from "node:test";
import assert from "node:assert/strict";
import { outboundAutoTags } from "./outbound-auto-tags";

const run = (over: Partial<Parameters<typeof outboundAutoTags>[0]["runs"][number]>) => ({
  leadId: "a", source: "manual", finishedAt: null, cancelledAt: null, automationState: "active", enrollmentStatus: "active", formAt: null, ...over,
});

test("Automação ativa only while an active, unfinished, non-test run exists", () => {
  assert.deepEqual(outboundAutoTags({ leadIds: ["a"], runs: [run({})], emailed: [], formLeads: [] }), { a: ["auto:automacao-ativa"] });
  for (const over of [{ automationState: "paused" }, { finishedAt: "2026-11-01" }, { cancelledAt: "2026-11-01" }, { source: "test" }, { enrollmentStatus: "paused" }])
    assert.deepEqual(outboundAutoTags({ leadIds: ["a"], runs: [run(over)], emailed: [], formLeads: [] }), {});
});

test("E-mail enviado and Formulário preenchido come from recorded events, only for Outbound cards", () => {
  const tags = outboundAutoTags({ leadIds: ["a", "b"], runs: [run({ leadId: "b", automationState: "paused", formAt: "2026-11-02" })], emailed: ["a", "a", "x"], formLeads: ["a"] });
  assert.deepEqual(tags, { a: ["auto:email-enviado", "auto:formulario-preenchido"], b: ["auto:formulario-preenchido"] });
});
