import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EMAIL_BATCH_LIMIT, emailBatchInput, emailItemReviewInput, emailReviewInput, emailSendInput, prospectCampaignSchema } from "./b2b-email-ai";
export const saveProspectEmailItem = createServerFn({method:"POST"}).inputValidator(v => emailItemReviewInput.parse(v)).handler(async ({data}) => (await import("./b2b-email-ai.server")).reviewEmailItem(data));
export const sendProspectEmails = createServerFn({method:"POST"}).inputValidator(v => emailSendInput.parse(v)).handler(async ({data}) => (await import("./b2b-email-ai.server")).sendEmailItems(data));
export const getProspectEmailWorkspace = createServerFn({method:"GET"}).handler(async () => (await import("./b2b-email-ai.server")).readEmailWorkspace());
export const getCampaignProspectCompanies = createServerFn({ method: "POST" })
  .inputValidator(v => z.object({ leadIds: z.array(z.string().uuid()).min(1).max(EMAIL_BATCH_LIMIT) }).strict().parse(v))
  .handler(async ({ data }) => (await import("./b2b-email-ai.server")).campaignProspectCompanies(data.leadIds));
export const getCampaignProspectWorkspace = createServerFn({ method: "GET" })
  .inputValidator(v => z.object({ batchId: z.string().uuid().nullable() }).strict().parse(v))
  .handler(async ({ data }) => (await import("./b2b-email-ai.server")).readEmailWorkspace(data.batchId));
export const sendCampaignProspectEmails = createServerFn({ method: "POST" })
  .inputValidator(v => emailSendInput.parse(v))
  .handler(async ({ data }) => (await import("./b2b-email-ai.server")).sendCampaignEmailItems(data));
export const prepareProspectEmailBatch = createServerFn({method:"POST"}).inputValidator(v => emailBatchInput.parse(v)).handler(async ({data}) => (await import("./b2b-email-ai.server")).createEmailBatch(data));
export const saveProspectEmailReview = createServerFn({method:"POST"}).inputValidator(v => emailReviewInput.parse(v)).handler(async ({data}) => (await import("./b2b-email-ai.server")).reviewEmail(data));
export const saveProspectConfiguration = createServerFn({method:"POST"})
  .inputValidator(v => prospectCampaignSchema.parse(v)).handler(async ({data}) => {
    const {requireEnabled,b2bDb} = await import("./b2b-prospecting.server");
    await requireEnabled();
    const r = await (await b2bDb()).from("b2b_prospect_campaigns").upsert({id:data.id??crypto.randomUUID(),config:data,status:data.status});
    if(r.error) throw new Error("Não foi possível salvar a configuração.");
    return {active:false,sent:false};
  });
export const saveProspectEmailTemplate = createServerFn({method:"POST"})
  .inputValidator(v => z.object({key:z.enum(["odontologia","estetica"]),subject:z.string().trim().min(1).max(200),body:z.string().trim().min(10).max(4000)}).strict().parse(v))
  .handler(async ({data}) => {
    const {requireEnabled,b2bDb} = await import("./b2b-prospecting.server");
    await requireEnabled();
    const r=await (await b2bDb()).from("b2b_ai_email_templates").upsert(data);
    if(r.error) throw new Error("Não foi possível salvar o modelo.");
    return {ok:true};
  });export const recordProspectWhatsapp = createServerFn({method:"POST"}).inputValidator(v => z.object({id:z.string().uuid()}).strict().parse(v)).handler(async ({data}) => (await import("./b2b-email-ai.server")).recordWhatsappManual(data.id));
export const queueOutboundDrafts = createServerFn({method:"POST"}).inputValidator(v => z.object({leadIds:z.array(z.string().uuid()).min(1).max(30)}).strict().parse(v)).handler(async ({data}) => (await import("./b2b-email-ai.server")).queueOutboundExisting(data.leadIds));
export const processPrepQueue = createServerFn({method:"POST"}).handler(async () => {
  const s = await import("./b2b-email-ai.server"); const { requireEnabled, b2bDb } = await import("./b2b-prospecting.server");
  await requireEnabled(); return s.runB2bPrep(await b2bDb(), 5);
});
export const getPrepStatus = createServerFn({method:"GET"}).handler(async () => (await import("./b2b-email-ai.server")).prepQueueStatus());
export const getOutreachIntegrations = createServerFn({method:"GET"}).handler(async () => (await import("./b2b-email-ai.server")).outreachIntegrations());
export const listEmailFlowsForOutreach = createServerFn({method:"GET"}).handler(async () => {
  const { requireEnabled, b2bDb } = await import("./b2b-prospecting.server");
  await requireEnabled();
  const r = await (await b2bDb()).from("crm_email_flows").select("id,name,state").neq("state","archived").order("updated_at",{ascending:false}).limit(30);
  return (r.data ?? []) as { id: string; name: string; state: string }[];
});
