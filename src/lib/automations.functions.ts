import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { saveAutomationInput } from "./automations";

const id = z.string().uuid();
export const getAutomations = createServerFn({ method: "POST" }).handler(async () => {
  const { automationsOverview } = await import("./automations.server");
  return automationsOverview();
});
export const getAutomation = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ id }).strict().parse(v))
  .handler(async ({ data }) => { const { automationDetail } = await import("./automations.server"); return automationDetail(data.id); });
export const saveAutomation = createServerFn({ method: "POST" })
  .inputValidator((v) => saveAutomationInput.parse(v))
  .handler(async ({ data }) => { const { saveAutomation: save } = await import("./automations.server"); return save(data); });
export const setAutomationState = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ id, revision: z.number().int().positive(), state: z.enum(["test", "active", "paused", "archived"]), approveAi: z.boolean() }).strict().parse(v))
  .handler(async ({ data }) => { const { setAutomationState: set } = await import("./automations.server"); return set(data); });
export const startAutomationRun = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ automationId: id, leadId: id, source: z.enum(["manual", "test"]) }).strict().parse(v))
  .handler(async ({ data }) => { const { startAutomationRun: start } = await import("./automations.server"); return start(data); });
export const automationRunAction = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ runId: id, action: z.enum(["pause", "resume", "cancel", "send_now"]) }).strict().parse(v))
  .handler(async ({ data }) => { const { automationRunAction: act } = await import("./automations.server"); return act(data); });
export const getAutomationCandidates = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ automationId: id, query: z.string().max(80) }).strict().parse(v))
  .handler(async ({ data }) => { const { automationCandidates } = await import("./automations.server"); return automationCandidates(data); });
export const getLeadAutomations = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ leadId: id }).strict().parse(v))
  .handler(async ({ data }) => { const { leadAutomations } = await import("./automations.server"); return leadAutomations(data.leadId); });
export const getManualAutomations = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ pipelineId: id.nullable() }).strict().parse(v))
  .handler(async ({ data }) => { const { manualAutomations } = await import("./automations.server"); return manualAutomations(data); });
export const startSelectedAutomationRuns = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ automationId: id, leadIds: z.array(id).min(1).max(50) }).strict().parse(v))
  .handler(async ({ data }) => { const { startSelectedRuns } = await import("./automations.server"); return startSelectedRuns(data); });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const getOutboundEmailMetrics = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ pipelineId: id, from: day, to: day, automationId: id.nullable(), mode: z.enum(["all", "manual", "trigger"]) }).strict().parse(v))
  .handler(async ({ data }) => { const { outboundEmailMetrics } = await import("./automations.server"); return outboundEmailMetrics(data); });
