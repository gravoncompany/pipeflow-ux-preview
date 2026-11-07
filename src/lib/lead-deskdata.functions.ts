import { createServerFn } from "@tanstack/react-start";
import { deskLeadInput, deskBindInput, deskQuoteInput, deskSendInput, deskRecoverInput } from "./lead-deskdata";

export const getLeadDeskData = createServerFn({ method: "POST" }).inputValidator(v => deskLeadInput.parse(v)).handler(async ({ data }) => {
  const { leadDeskOverview } = await import("./lead-deskdata.server");
  return leadDeskOverview(data.leadId);
});
export const bindLeadDeskData = createServerFn({ method: "POST" }).inputValidator(v => deskBindInput.parse(v)).handler(async ({ data }) => {
  const { bindLeadDesk } = await import("./lead-deskdata.server");
  return bindLeadDesk(data);
});
export const quoteLeadDeskData = createServerFn({ method: "POST" }).inputValidator(v => deskQuoteInput.parse(v)).handler(async ({ data }) => {
  const { quoteLeadDesk } = await import("./lead-deskdata.server");
  return quoteLeadDesk(data);
});
export const sendLeadDeskData = createServerFn({ method: "POST" }).inputValidator(v => deskSendInput.parse(v)).handler(async ({ data }) => {
  const { sendLeadDesk } = await import("./lead-deskdata.server");
  return sendLeadDesk(data.leadId, data.quote);
});
export const recoverLeadDeskData = createServerFn({ method: "POST" }).inputValidator(v => deskRecoverInput.parse(v)).handler(async ({ data }) => {
  const { recoverLeadDesk } = await import("./lead-deskdata.server");
  return recoverLeadDesk(data.leadId, data.historyId);
});