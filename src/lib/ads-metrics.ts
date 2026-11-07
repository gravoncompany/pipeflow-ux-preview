/** Normalized read-only campaign metrics shared by Meta Ads and Google Ads. null = the platform does not provide it. */
export type AdsMetrics = {
  spend: number; currency: string; impressions: number; reach: number | null; clicks: number;
  cpc: number | null; ctr: number | null; results: number; resultLabel: string; costPerResult: number | null; activeCampaigns: number | null;
};
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "leadgen_grouped"];

/** Meta insights (account level). Leads = first lead action Meta reports (never summed across overlapping types). */
export function parseMetaMetrics(row: Record<string, unknown> | undefined, currency: string, activeCampaigns: number | null): AdsMetrics {
  const r = row ?? {};
  const spend = num(r.spend), clicks = num(r.clicks), impressions = num(r.impressions);
  const actions = Array.isArray(r.actions) ? (r.actions as { action_type?: string; value?: string }[]) : [];
  const lead = LEAD_ACTIONS.map(t => actions.find(a => a.action_type === t)).find(Boolean);
  const results = lead ? num(lead.value) : 0;
  return {
    spend, currency, impressions, reach: r.reach === undefined ? null : num(r.reach), clicks,
    cpc: clicks ? spend / clicks : null, ctr: impressions ? (clicks / impressions) * 100 : null,
    results, resultLabel: "Leads", costPerResult: results ? spend / results : null, activeCampaigns,
  };
}

/** Google Ads GAQL customer-level row. cost_micros / 1e6; Google has no reach in this report. */
export function parseGoogleMetrics(row: { metrics?: Record<string, unknown> } | undefined, currency: string, activeCampaigns: number | null): AdsMetrics {
  const m = row?.metrics ?? {};
  const spend = num(m.costMicros) / 1_000_000, clicks = num(m.clicks), impressions = num(m.impressions), results = num(m.conversions);
  return {
    spend, currency, impressions, reach: null, clicks,
    cpc: clicks ? spend / clicks : null, ctr: impressions ? (clicks / impressions) * 100 : null,
    results, resultLabel: "Conversões", costPerResult: results ? spend / results : null, activeCampaigns,
  };
}
export const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
