import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
export const getOutboundClickHistory = createServerFn({ method: 'POST' }).inputValidator((v: unknown) => z.object({ leadId: z.string().uuid() }).strict().parse(v)).handler(async ({ data }) => {
  const { outboundClickHistory } = await import('./outbound-clicks.server');
  return outboundClickHistory(data.leadId);
});
export const sendOutboundClickTest = createServerFn({ method: 'POST' }).inputValidator((v: unknown) => z.object({ email: z.string().email().max(254), confirmed: z.literal(true) }).strict().parse(v)).handler(async ({ data }) => {
  const { sendOutboundTrackingTest } = await import('./outbound-clicks.server');
  return sendOutboundTrackingTest(data.email.toLowerCase());
});