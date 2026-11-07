import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { nextMessageInput, approveMessageInput } from "./analysis-next-message";

export const prepareAnalysisMessage = createServerFn({ method: "POST" }).inputValidator(i => nextMessageInput.parse(i)).handler(async ({ data }) => {
  const { prepareNextMessage } = await import("./analysis-next-message.server");
  return prepareNextMessage(data);
});
export const approveAnalysisMessage = createServerFn({ method: "POST" }).inputValidator(i => approveMessageInput.parse(i)).handler(async ({ data }) => {
  const { approveNextMessage } = await import("./analysis-next-message.server");
  return approveNextMessage(data);
});
export const analysisMessageStatus = createServerFn({ method: "POST" }).inputValidator(i => z.object({ id: z.string().uuid() }).strict().parse(i)).handler(async ({ data }) => {
  const { getNextMessageStatus } = await import("./analysis-next-message.server");
  return getNextMessageStatus(data.id);
});
export const latestAnalysisMessage = createServerFn({ method: "POST" }).inputValidator(i => nextMessageInput.parse(i)).handler(async ({ data }) => {
  const { latestNextMessage } = await import("./analysis-next-message.server");
  return latestNextMessage(data);
});