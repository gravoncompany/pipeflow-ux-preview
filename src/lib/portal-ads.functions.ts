import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adsDate, adsRange, campaignKey } from "./portal-ads";

async function authorize() {
  const { hasFullCrmSession } = await import("./crm-session.server");
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret || !(await hasFullCrmSession(secret)))
    throw new Error("Entre com acesso completo para consultar os gastos do Portal.");
}
export const getPortalAds = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({ from: adsDate, to: adsDate, refresh: z.boolean().default(false) })
      .strict()
      .refine((v) => adsRange.safeParse({ from: v.from, to: v.to }).success)
      .parse(i),
  )
  .handler(async ({ data }) => {
    await authorize();
    const { readAgencyAds } = await import("./portal-ads.server");
    const result = await readAgencyAds(data.from, data.to, data.refresh);
    await authorize();
    return result;
  });

export const linkPortalCampaign = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        from: adsDate,
        to: adsDate,
        platform: z.enum(["meta_ads", "google_ads"]),
        account_id: z.string().min(1).max(200),
        campaign_id: z.string().min(1).max(200),
        pipeline: z.union([z.literal("main"), z.string().uuid()]).nullable(),
      })
      .strict()
      .refine((v) => adsRange.safeParse({ from: v.from, to: v.to }).success)
      .parse(i),
  )
  .handler(async ({ data }) => {
    await authorize();
    const { readAgencyAds } = await import("./portal-ads.server");
    const view = await readAgencyAds(data.from, data.to);
    if (!view.payload?.rows.some((r) => campaignKey(r) === campaignKey(data)) || view.stale)
      throw new Error("Atualize os dados válidos do Portal antes de associar a campanha.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.pipeline !== null && data.pipeline !== "main") {
      const p = await supabaseAdmin
        .from("sales_pipelines")
        .select("id")
        .eq("id", data.pipeline)
        .eq("archived", false)
        .maybeSingle();
      if (p.error || !p.data) throw new Error("Funil não encontrado.");
    }
    await authorize();
    const key = {
      company_key: "crm:1",
      platform: data.platform,
      account_id: data.account_id,
      campaign_id: data.campaign_id,
    };
    const result =
      data.pipeline === null
        ? await supabaseAdmin.from("portal_ads_campaign_links").delete().match(key)
        : await supabaseAdmin
            .from("portal_ads_campaign_links")
            .upsert(
              { ...key, pipeline_key: data.pipeline, updated_at: new Date().toISOString() },
              { onConflict: "company_key,platform,account_id,campaign_id" },
            );
    if (result.error) throw new Error("Não foi possível salvar o vínculo.");
    return { ok: true };
  });
