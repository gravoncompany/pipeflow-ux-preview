import {
  campaignKey,
  pipelineAds,
  adsPartial,
  adsCost,
  type AdsPayload,
  type AdsLink,
} from "@/lib/portal-ads";

/** Presentation of the existing Portal snapshot; never add manual spend or infer links. */
export function funnelSpendValues(
  payload: AdsPayload | null,
  links: AdsLink[],
  pipeline: string,
  from: string,
  to: string,
) {
  const selected = new Set(links.filter((l) => l.pipeline_key === pipeline).map(campaignKey));
  const scoped = payload
    ? { ...payload, rows: payload.rows.filter((r) => r.date >= from && r.date <= to) }
    : null;
  const totals = pipelineAds(scoped, links, pipeline);
  const currencies = [...new Set(totals.map((t) => t.currency))].map((currency) => {
    const own = totals.filter((t) => t.currency === currency);
    const known = own.filter((t) => t.amount !== null);
    return {
      currency,
      amount: known.length ? known.reduce((sum, t) => sum + (t.amount ?? 0), 0) : null,
    };
  });
  return {
    currencies,
    hasLinks: selected.size > 0,
    partial: scoped ? adsPartial(scoped, from, to) : false,
  };
}

export function acquisitionValue(
  amount: number | null,
  denominator: number | null,
  opts?: { cac?: boolean; pending?: number },
) {
  if (amount === null) return { state: "missing" as const, value: null };
  // Closings still pending classification block the CAC until reviewed.
  if (opts?.cac && (opts.pending ?? 0) > 0) return { state: "pending" as const, value: null };
  // A won opportunity is not evidence of a newly acquired customer.
  if (denominator === null) return { state: "unverified" as const, value: null };
  if (denominator <= 0)
    return opts?.cac
      ? { state: "no-new" as const, value: null }
      : { state: "zero-denominator" as const, value: null };
  return { state: "known" as const, value: adsCost(amount, denominator) };
}
