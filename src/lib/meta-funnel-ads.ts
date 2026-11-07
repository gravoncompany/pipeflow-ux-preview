import type { AdsPayload, AdsRow } from "./portal-ads";

export type MetaSpendAccount = {
  ad_account_id: string;
  account_name: string;
  currency: string;
  timezone: string;
  synced_from: string | null;
  last_sync_at: string | null;
};
export type MetaSpendDaily = {
  ad_account_id: string;
  spend_date: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  spend_cents: number;
  currency: string;
  synced_at: string;
};

const saoPauloDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/**
 * Converts imported Meta ad-set rows into the funnel's campaign/day shape.
 * Ad sets of the same campaign and day are summed once; coverage runs from the first
 * imported day to the day of the last successful import (days without spend inside it are real zeros).
 */
export function metaRowsToAdsPayload(accounts: MetaSpendAccount[], rows: MetaSpendDaily[]): AdsPayload {
  const byDay = new Map<string, AdsRow & { cents: number }>();
  const tz = new Map(accounts.map((a) => [a.ad_account_id, a.timezone || "America/Sao_Paulo"]));
  for (const r of rows) {
    const key = JSON.stringify([r.ad_account_id, r.campaign_id, r.spend_date, r.currency]);
    const prev = byDay.get(key);
    if (prev) {
      prev.cents += r.spend_cents;
      prev.spend = prev.cents / 100;
      if (r.synced_at > prev.synced_at) prev.synced_at = r.synced_at;
    } else {
      byDay.set(key, {
        platform: "meta_ads",
        account_id: r.ad_account_id,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        date: r.spend_date,
        spend: r.spend_cents / 100,
        cents: r.spend_cents,
        currency: r.currency,
        timezone_name: tz.get(r.ad_account_id) ?? "America/Sao_Paulo",
        synced_at: r.synced_at,
      });
    }
  }
  return {
    rows: [...byDay.values()].map(({ cents: _c, ...row }) => row),
    accounts: accounts.map((a) => {
      const last = a.last_sync_at ? saoPauloDate(a.last_sync_at) : null;
      const covered = Boolean(a.synced_from && last);
      return {
        platform: "meta_ads" as const,
        account_id: a.ad_account_id,
        account_name: a.account_name,
        currency: /^[A-Z]{3}$/.test(a.currency) ? a.currency : "BRL",
        timezone_name: a.timezone || "America/Sao_Paulo",
        first_date: covered ? a.synced_from : null,
        last_date: covered ? last : null,
        last_synced_at: a.last_sync_at,
        status: covered ? ("available" as const) : ("coverage_unavailable" as const),
      };
    }),
    monthly_totals: null,
    limitations: [],
  };
}
