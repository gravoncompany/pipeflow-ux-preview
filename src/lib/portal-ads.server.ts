import { signPortalBody } from "./portal-signing.server";
import { boundedJson } from "./gravon-portal.server";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import {
  adsPage,
  adsRange,
  uniqueAdsRows,
  adsErrors,
  type AdsPayload,
  type AdsView,
} from "./portal-ads";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const COMPANY = "crm:1";
export const ADS_SCHEDULE =
  "Diária às 06:15 de Brasília (09:15 UTC); Portal: coleta informada às 06:00 de Brasília. Períodos consultados nos últimos 30 dias e ano corrente.";

/** Complete bounded pagination, no identity, independent of either chat. */
export async function fetchAgencyAds(
  from: string,
  to: string,
  secrets: { token: string; key: string },
  transport: typeof fetch = fetch,
): Promise<AdsPayload> {
  adsRange.parse({ from, to });
  let offset = 0;
  const rows: AdsPayload["rows"] = [];
  let metadata: Omit<AdsPayload, "rows"> | null = null;
  for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
    const signed = await signPortalBody(
      JSON.stringify({
        operation: "agency_ads_spend",
        period: { mode: "range", start: from, end: to },
        limit: 500,
        offset,
      }),
      secrets.token,
      secrets.key,
    );
    const response = await fetchWithoutRedirects(
      "https://portalgravon.online/api/public/gravon-ia/query",
      { method: "POST", ...signed, signal: AbortSignal.timeout(20000) },
      transport,
    );
    const raw = await boundedJson(response, 2_000_000);
    if (!response.ok) {
      const code =
        typeof raw === "object" &&
        raw !== null &&
        "error" in raw &&
        typeof raw.error === "string" &&
        adsErrors[raw.error]
          ? raw.error
          : "integration_unavailable";
      throw new Error(code);
    }
    const parsed = adsPage.safeParse(raw);
    if (!parsed.success) {
      // Field paths only: no raw response, financial values or credentials in logs.
      console.warn("portal_ads_validation_failed", {
        stage: "schema",
        page: pageNumber + 1,
        offset,
        issue_count: parsed.error.issues.length,
        issues: parsed.error.issues.slice(0, 10).map((issue) => ({
          field: issue.path.join("."),
          code: issue.code,
        })),
      });
      throw new Error("incomplete_response");
    }
    const page = parsed.data;
    if (
      page.requested_period.start !== from ||
      page.requested_period.end !== to ||
      page.pagination.offset !== offset ||
      page.pagination.limit !== 500 ||
      (page.pagination.has_more && page.data.rows.length !== 500)
    )
      throw new Error("incomplete_response");
    if (!page.data.accounts.length) throw new Error("no_agency_accounts");
    const next = {
      accounts: page.data.accounts,
      monthly_totals: page.data.monthly_totals,
      limitations: page.limitations,
    };
    if (metadata && JSON.stringify(metadata) !== JSON.stringify(next))
      throw new Error("source_changed_during_pagination");
    metadata = next;
    for (const row of page.data.rows) {
      const account = page.data.accounts.find(
        (a) => a.platform === row.platform && a.account_id === row.account_id,
      );
      if (
        !account ||
        row.date < from ||
        row.date > to ||
        row.currency !== account.currency ||
        row.timezone_name !== account.timezone_name
      )
        throw new Error("incomplete_response");
      rows.push(row);
    }
    if (!page.pagination.has_more) {
      const unique = uniqueAdsRows(rows);
      // Compare equivalent representations, never add monthly totals to daily rows.
      if (metadata.monthly_totals !== null) {
        const monthly = new Map<string, { spend: number; unknown: number }>();
        for (const r of unique) {
          const k = JSON.stringify([r.platform, r.account_id, r.date.slice(0, 7), r.currency]);
          const t = monthly.get(k) ?? { spend: 0, unknown: 0 };
          if (r.spend === null) t.unknown++;
          else t.spend += r.spend;
          monthly.set(k, t);
        }
        if (monthly.size !== metadata.monthly_totals.length) throw new Error("incomplete_response");
        const seen = new Set<string>();
        for (const t of metadata.monthly_totals) {
          const k = JSON.stringify([t.platform, t.account_id, t.month, t.currency]),
            total = monthly.get(k);
          if (
            seen.has(k) ||
            !total ||
            t.spend === null ||
            Math.abs(total.spend - t.spend) > 0.011 ||
            total.unknown !== t.unknown_days
          )
            throw new Error("incomplete_response");
          seen.add(k);
        }
      }
      return { ...metadata, rows: unique };
    }
    offset += page.pagination.limit;
  }
  throw new Error("incomplete_response");
}

export async function syncAgencyAds(from: string, to: string) {
  adsRange.parse({ from, to });
  const lease = crypto.randomUUID();
  const claim = await supabaseAdmin.rpc("claim_portal_ads_sync", {
    p_from: from,
    p_to: to,
    p_lease: lease,
  });
  if (claim.error) throw new Error("Não foi possível iniciar a atualização.");
  if (!claim.data) return;
  try {
    const token = process.env.GRAVON_IA_SERVICE_TOKEN,
      key = process.env.GRAVON_IA_IDENTITY_SIGNING_SECRET;
    if (!token || !key) throw new Error("integration_not_configured");
    const payload = await fetchAgencyAds(from, to, { token, key });
    const result = await supabaseAdmin
      .from("portal_ads_snapshots")
      .update({
        payload,
        succeeded_at: new Date().toISOString(),
        error_code: null,
        lease_id: null,
        lease_until: null,
      })
      .eq("company_key", COMPANY)
      .eq("from_date", from)
      .eq("to_date", to)
      .eq("lease_id", lease);
    if (result.error) throw new Error("integration_unavailable");
  } catch (e) {
    const code = e instanceof Error && adsErrors[e.message] ? e.message : "integration_unavailable";
    console.warn("portal_ads_sync_failed", { code });
    const result = await supabaseAdmin
      .from("portal_ads_snapshots")
      .update({ error_code: code, lease_id: null, lease_until: null })
      .eq("company_key", COMPANY)
      .eq("from_date", from)
      .eq("to_date", to)
      .eq("lease_id", lease);
    if (result.error) throw new Error("Não foi possível registrar o resultado da consulta.");
  }
}

/** Must be called only after full cookie authorization, even for cached reads. */
export async function readAgencyAds(from: string, to: string, refresh = false): Promise<AdsView> {
  const query = () =>
    supabaseAdmin
      .from("portal_ads_snapshots")
      .select("payload,succeeded_at,attempted_at,error_code")
      .eq("company_key", COMPANY)
      .eq("from_date", from)
      .eq("to_date", to)
      .maybeSingle();
  let result = await query();
  if (result.error) throw new Error("Não foi possível ler os gastos salvos.");
  const recentAttempt =
    result.data?.attempted_at && Date.now() - Date.parse(result.data.attempted_at) < 60_000;
  if (
    !recentAttempt &&
    (refresh ||
      !result.data?.succeeded_at ||
      Date.now() - Date.parse(result.data.succeeded_at) > 86400000)
  ) {
    await syncAgencyAds(from, to);
    result = await query();
    if (result.error) throw new Error("Não foi possível ler os gastos salvos.");
  }
  const links = await supabaseAdmin
    .from("portal_ads_campaign_links")
    .select("platform,account_id,campaign_id,pipeline_key")
    .eq("company_key", COMPANY);
  if (links.error) throw new Error("Não foi possível ler os vínculos das campanhas.");
  const row = result.data;
  return {
    payload: row?.payload ? (row.payload as unknown as AdsPayload) : null,
    links: links.data ?? [],
    succeededAt: row?.succeeded_at ?? null,
    attemptedAt: row?.attempted_at ?? null,
    stale:
      Boolean(row?.error_code) ||
      !row?.succeeded_at ||
      Date.now() - Date.parse(row.succeeded_at) > 86400000,
    error: row?.error_code
      ? (adsErrors[row.error_code] ?? adsErrors.integration_unavailable)
      : null,
    schedule: ADS_SCHEDULE,
  };
}

export async function runScheduledAdsSync() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const recent = await supabaseAdmin
    .from("portal_ads_snapshots")
    .select("from_date,to_date")
    .gte("attempted_at", new Date(Date.now() - 30 * 86400000).toISOString())
    .order("attempted_at", { ascending: false })
    .limit(100);
  if (recent.error) throw new Error("Scheduler storage unavailable");
  const ranges = new Map<string, { from: string; to: string }>();
  ranges.set(`${today.slice(0, 4)}-01-01:${today.slice(0, 4)}-12-31`, {
    from: `${today.slice(0, 4)}-01-01`,
    to: `${today.slice(0, 4)}-12-31`,
  });
  for (const r of recent.data ?? [])
    ranges.set(`${r.from_date}:${r.to_date}`, { from: r.from_date, to: r.to_date });
  for (const r of ranges.values()) await syncAgencyAds(r.from, r.to);
}
