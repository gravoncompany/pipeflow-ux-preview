import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { flowInput, flowScheduleInput } from "./email-flows";

const id = z.string().uuid();
export const getEmailFlows = createServerFn({ method: "POST" }).handler(async () => {
  const { flowsOverview } = await import("./email-flows.server");
  return flowsOverview();
});
export const getFlowMessages = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ enrollmentId: id }).strict().parse(v))
  .handler(async ({ data }) => { const { flowMessages } = await import("./email-flows.server"); return flowMessages(data.enrollmentId); });
export const saveEmailFlow = createServerFn({ method: "POST" })
  .inputValidator((v) => flowInput.parse(v))
  .handler(async ({ data }) => { const { saveFlow } = await import("./email-flows.server"); return saveFlow(data); });
export const setEmailFlowState = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ id, revision: z.number().int().positive(), state: z.enum(["active", "paused", "archived"]) }).strict().parse(v))
  .handler(async ({ data }) => { const { setFlowState } = await import("./email-flows.server"); return setFlowState(data.id, data.revision, data.state); });
export const enrollEmailFlow = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ flowId: id, leadIds: z.array(id).min(1).max(300) }).strict().parse(v))
  .handler(async ({ data }) => { const { enrollLeads } = await import("./email-flows.server"); return enrollLeads(data.flowId, [...new Set(data.leadIds)]); });
export const emailFlowEnrollmentAction = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ id, action: z.enum(["pause", "resume", "stop"]) }).strict().parse(v))
  .handler(async ({ data }) => { const { enrollmentAction } = await import("./email-flows.server"); return enrollmentAction(data.id, data.action); });
export const approveEmailFlowSuggestion = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ id, revision: z.number().int().positive(), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(8000), confirmed: z.literal(true) }).strict().parse(v))
  .handler(async ({ data }) => { const { approveSuggestion } = await import("./email-flows.server"); return approveSuggestion(data.id, data.revision, data.subject, data.body); });
export const discardEmailFlowSuggestion = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ id, revision: z.number().int().positive() }).strict().parse(v))
  .handler(async ({ data }) => { const { discardSuggestion } = await import("./email-flows.server"); return discardSuggestion(data.id, data.revision); });
export const runEmailFlowsNow = createServerFn({ method: "POST" }).handler(async () => {
  const { runEmailFlowsNow: run } = await import("./email-flows.server");
  return run();
});
export const clearEmailFlowAiBlock = createServerFn({ method: "POST" }).handler(async () => {
  const { clearAiBlock } = await import("./email-flows.server");
  return clearAiBlock();
});
export const getLeadEmailMarketing = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ leadId: id }).strict().parse(v))
  .handler(async ({ data }) => { const { leadEmailMarketing } = await import("./email-flows.server"); return leadEmailMarketing(data.leadId); });

/* Agente Comercial — e-mail */
export const getEmailAgent = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ pipelineId: id.nullable() }).strict().parse(v))
  .handler(async ({ data }) => { const { emailAgentOverview } = await import("./email-flows.server"); return emailAgentOverview(data.pipelineId); });
export const setEmailAgentEnabled = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ enabled: z.boolean(), confirmed: z.literal(true) }).strict().parse(v))
  .handler(async ({ data }) => { const { setEmailAgent } = await import("./email-flows.server"); return setEmailAgent(data.enabled); });
export const saveEmailFlowSchedule = createServerFn({ method: "POST" })
  .inputValidator((v) => flowScheduleInput.parse(v))
  .handler(async ({ data }) => { const { saveFlowSchedule } = await import("./email-flows.server"); return saveFlowSchedule(data); });
export const syncEmails = createServerFn({ method: "POST" }).handler(async () => {
  const { syncEmailsNow } = await import("./email-flows.server");
  return syncEmailsNow();
});
export const getEmailInboxReview = createServerFn({ method: "POST" }).handler(async () => {
  const { reviewInbox } = await import("./email-flows.server");
  return reviewInbox();
});
export const resolveEmailInbox = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({
    id, action: z.enum(["ignore", "link", "create"]), leadId: id.nullable(), pipelineId: id.nullable(),
    name: z.string().trim().max(150), company: z.string().trim().max(150),
  }).strict().parse(v))
  .handler(async ({ data }) => { const { resolveInboxMessage } = await import("./email-flows.server"); return resolveInboxMessage(data); });
