import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adsDate, adsRange, type AdsView } from "./portal-ads";
import { metaRowsToAdsPayload, type MetaSpendAccount, type MetaSpendDaily } from "./meta-funnel-ads";

async function authorize() {
  const { hasFullCrmSession } = await import("./crm-session.server");
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret || !(await hasFullCrmSession(secret)))
    throw new Error("Entre com acesso completo para consultar o investimento da Meta.");
}

const range = (i: unknown) =>
  z
    .object({ from: adsDate, to: adsDate, refresh: z.boolean().default(false) })
    .strict()
    .refine((v) => adsRange.safeParse({ from: v.from, to: v.to }).success)
    .parse(i);

/** Funnel spend read straight from the Gravon ad accounts connected through the Meta API (never the Portal). */
async function readMetaFunnelAds(from: string, to: string, refresh: boolean): Promise<AdsView> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const accountsQuery = () =>
    db
      .from("meta_ads_spend_accounts")
      .select("ad_account_id,account_name,currency,timezone,synced_from,last_sync_at,last_sync_status,last_sync_code,last_test_ok,sync_enabled")
      .eq("owner_kind", "gravon")
      .is("client_id", null)
      .eq("active", true);
  let { data: accounts, error } = await accountsQuery();
  if (error) throw new Error("Não foi possível ler as contas da Meta.");
  let refreshError: string | null = null;
  if (refresh) {
    const { importAccount, daysAgo } = await import("./meta-ads-spend.server");
    const { saoPauloToday } = await import("./meta-ads-spend");
    for (const a of accounts ?? []) {
      if (!a.sync_enabled || !a.last_test_ok) continue;
      const r = await importAccount(db as never, a.ad_account_id, daysAgo(29), saoPauloToday());
      if (!r.ok) refreshError = r.failure;
    }
    ({ data: accounts, error } = await accountsQuery());
    if (error) throw new Error("Não foi possível ler as contas da Meta.");
  }
  const list = (accounts ?? []) as (MetaSpendAccount & { last_sync_status: string | null; last_sync_code: string | null })[];
  const ids = list.map((a) => a.ad_account_id);
  const rows: MetaSpendDaily[] = [];
  for (let offset = 0; ids.length && offset < 50_000; offset += 1000) {
    const { data: page, error: e } = await db
      .from("meta_ads_spend_daily")
      .select("ad_account_id,spend_date,campaign_id,campaign_name,adset_id,spend_cents,currency,synced_at")
      .in("ad_account_id", ids)
      .gte("spend_date", from)
      .lte("spend_date", to)
      .order("spend_date")
      .order("adset_id")
      .range(offset, offset + 999);
    if (e) throw new Error("Não foi possível ler o investimento da Meta.");
    rows.push(...(page ?? []));
    if ((page?.length ?? 0) < 1000) break;
  }
  const { data: links, error: le } = await db
    .from("portal_ads_campaign_links")
    .select("platform,account_id,campaign_id,pipeline_key")
    .eq("company_key", "crm:1")
    .eq("platform", "meta_ads");
  if (le) throw new Error("Não foi possível ler os vínculos das campanhas.");
  const { spendFailureText } = await import("./meta-ads-spend.server");
  const lastOk = list.map((a) => a.last_sync_at).filter(Boolean).sort().at(-1) ?? null;
  const failed = list.find((a) => a.last_sync_status === "failed");
  const error2 = !list.length
    ? "Nenhuma conta de anúncios da Gravon está conectada pela Meta. Vincule-a em Financeiro → Tráfego pago."
    : refreshError ?? (failed ? `Última importação da Meta falhou: ${spendFailureText(failed.last_sync_code)}` : null);
  return {
    payload: list.length ? metaRowsToAdsPayload(list, rows) : null,
    links: links ?? [],
    succeededAt: lastOk,
    attemptedAt: new Date().toISOString(),
    stale: false,
    error: error2,
    schedule: "Importação diária dos últimos 30 dias pela API da Meta",
  };
}

export const getMetaFunnelAds = createServerFn({ method: "POST" })
  .inputValidator(range)
  .handler(async ({ data }) => {
    await authorize();
    const result = await readMetaFunnelAds(data.from, data.to, data.refresh);
    await authorize();
    return result;
  });

/** Links a Meta campaign already imported for a Gravon account to one funnel (exact IDs only). */
export const linkMetaFunnelCampaign = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        account_id: z.string().regex(/^act_\d{5,25}$/),
        campaign_id: z.string().regex(/^\d{1,40}$/),
        pipeline: z.union([z.literal("main"), z.string().uuid()]).nullable(),
      })
      .strict()
      .parse(i),
  )
  .handler(async ({ data }) => {
    await authorize();
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const acc = await db
      .from("meta_ads_spend_accounts")
      .select("ad_account_id")
      .eq("ad_account_id", data.account_id)
      .eq("owner_kind", "gravon")
      .is("client_id", null)
      .maybeSingle();
    const row = await db
      .from("meta_ads_spend_daily")
      .select("campaign_id")
      .eq("ad_account_id", data.account_id)
      .eq("campaign_id", data.campaign_id)
      .limit(1)
      .maybeSingle();
    if (acc.error || row.error || !acc.data || !row.data)
      throw new Error("Essa campanha não foi importada de uma conta da Gravon na Meta.");
    if (data.pipeline !== null && data.pipeline !== "main") {
      const p = await db.from("sales_pipelines").select("id").eq("id", data.pipeline).eq("archived", false).maybeSingle();
      if (p.error || !p.data) throw new Error("Funil não encontrado.");
    }
    await authorize();
    const key = { company_key: "crm:1", platform: "meta_ads", account_id: data.account_id, campaign_id: data.campaign_id };
    const result =
      data.pipeline === null
        ? await db.from("portal_ads_campaign_links").delete().match(key)
        : await db
            .from("portal_ads_campaign_links")
            .upsert({ ...key, pipeline_key: data.pipeline, updated_at: new Date().toISOString() }, { onConflict: "company_key,platform,account_id,campaign_id" });
    if (result.error) throw new Error("Não foi possível salvar o vínculo.");
    return { ok: true };
  });
