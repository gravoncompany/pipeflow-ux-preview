import { z } from "zod";

export const adsDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
  );
export const adsRange = z
  .object({ from: adsDate, to: adsDate })
  .strict()
  .refine(
    (v) => v.to >= v.from && Date.parse(v.to) - Date.parse(v.from) <= 365 * 86400000,
    "Selecione até 366 dias.",
  );
const platform = z.enum(["meta_ads", "google_ads"]);
const id = z.string().min(1).max(200);
const money = z.number().finite().min(0).nullable();
// Portal database timestamps may use an explicit UTC offset instead of Z.
// Require a timezone in either form; never interpret a timezone-less date locally.
const adsTimestamp = z.string().datetime({ offset: true });
export const adsRow = z.object({
  platform,
  account_id: id,
  campaign_id: id,
  campaign_name: z.string().max(500),
  date: adsDate,
  spend: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone_name: z.string().min(1).max(100),
  synced_at: adsTimestamp,
});
const account = z.object({
  platform,
  account_id: id,
  account_name: z.string().max(500),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone_name: z.string().min(1).max(100),
  first_date: adsDate.nullable(),
  last_date: adsDate.nullable(),
  last_synced_at: adsTimestamp.nullable(),
  status: z.enum(["available", "no_rows_in_period", "coverage_unavailable"]),
});
const monthly = z.object({
  platform,
  account_id: id,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  spend: money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  unknown_days: z.number().int().min(0),
});
export const adsPage = z.object({
  version: z.literal("1"),
  operation: z.literal("agency_ads_spend"),
  result: z.literal("ok"),
  queried_at: adsTimestamp,
  requested_period: z.object({ start: adsDate, end: adsDate }),
  data: z.object({
    rows: z.array(adsRow).max(500),
    accounts: z.array(account).max(200),
    monthly_totals: z.array(monthly).nullable(),
  }),
  pagination: z.object({
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(500),
    has_more: z.boolean(),
  }),
  limitations: z.array(z.string().max(1000)).max(50),
});
export type AdsRow = z.infer<typeof adsRow>;
export type AdsAccount = z.infer<typeof account>;
export type AdsLink = {
  platform: string;
  account_id: string;
  campaign_id: string;
  pipeline_key: string;
};
export type AdsPayload = {
  rows: AdsRow[];
  accounts: AdsAccount[];
  monthly_totals: z.infer<typeof monthly>[] | null;
  limitations: string[];
};
export type AdsView = {
  payload: AdsPayload | null;
  links: AdsLink[];
  succeededAt: string | null;
  attemptedAt: string | null;
  stale: boolean;
  error: string | null;
  schedule: string;
};
export const campaignKey = (r: Pick<AdsRow, "platform" | "account_id" | "campaign_id"> | AdsLink) =>
  JSON.stringify([r.platform, r.account_id, r.campaign_id]);
export const dailyKey = (r: AdsRow) =>
  JSON.stringify([r.platform, r.account_id, r.campaign_id, r.date]);

export function uniqueAdsRows(rows: AdsRow[]) {
  const map = new Map<string, AdsRow>();
  for (const row of rows) {
    const prev = map.get(dailyKey(row));
    // Identical repeated rows are harmless. A changing source mid-pagination is not a complete snapshot.
    if (prev && JSON.stringify(prev) !== JSON.stringify(row))
      throw new Error("source_changed_during_pagination");
    map.set(dailyKey(row), row);
  }
  return [...map.values()];
}

export function aggregateAds(rows: AdsRow[]) {
  const totals = new Map<
    string,
    { platform: string; currency: string; month: string; amount: number | null; unknown: number }
  >();
  for (const r of uniqueAdsRows(rows)) {
    const month = r.date.slice(0, 7),
      key = JSON.stringify([r.platform, r.currency, month]);
    const t = totals.get(key) ?? {
      platform: r.platform,
      currency: r.currency,
      month,
      amount: null,
      unknown: 0,
    };
    if (r.spend === null) t.unknown++;
    else t.amount = (t.amount ?? 0) + r.spend;
    totals.set(key, t);
  }
  return [...totals.values()];
}

export function pipelineAds(payload: AdsPayload | null, links: AdsLink[], pipeline: string) {
  if (!payload) return [];
  const keys = new Set(links.filter((l) => l.pipeline_key === pipeline).map(campaignKey));
  return aggregateAds(payload.rows.filter((r) => keys.has(campaignKey(r))));
}

export function adsCost(amount: number | null, denominator: number): number | null {
  return amount === null || denominator <= 0 ? null : amount / denominator;
}

export function adsPartial(payload: AdsPayload, from: string, to: string) {
  return (
    !payload.accounts.length ||
    payload.rows.some((r) => r.spend === null) ||
    payload.accounts.some(
      (a) =>
        a.status !== "available" ||
        !a.first_date ||
        !a.last_date ||
        a.first_date > from ||
        a.last_date < to,
    )
  );
}

export const adsErrors: Record<string, string> = {
  no_agency_accounts:
    "O Portal não tem contas da própria Gravon configuradas. Selecione-as nas Integrações do Portal e sincronize o histórico.",
  integration_not_configured: "As credenciais da integração Portal não estão disponíveis.",
  invalid_credential: "O Portal recusou a credencial de serviço.",
  invalid_assertion: "O Portal recusou a assinatura da consulta.",
  invalid_input:
    "A operação ou o período não foi aceito pelo Portal. Confira a publicação do Portal.",
  source_unavailable: "A fonte de gastos do Portal está indisponível.",
  integration_unavailable:
    "Não foi possível atualizar os gastos do Portal. Os últimos dados válidos foram preservados.",
  source_changed_during_pagination:
    "A fonte mudou durante a consulta. Os últimos dados válidos foram preservados.",
  incomplete_response:
    "O Portal devolveu dados incompletos ou inconsistentes. Os últimos dados válidos foram preservados.",
};
