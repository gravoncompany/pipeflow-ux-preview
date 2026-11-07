import { parseInsights, saoPauloToday, type SpendRow } from "./meta-ads-spend";

const GATEWAY = "https://connector-gateway.lovable.dev/meta_ads/v26.0";
type Db = Awaited<ReturnType<typeof import("./finance-management.server")["financeAccess"]>>["db"];

async function adminDb() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }

/** Gateway read: 15s timeout, no redirects, only bounded status/code logged (never bodies or keys). */
async function meta(path: string, params: Record<string, string>): Promise<{ ok: true; body: unknown } | { ok: false; http: number | null; code: string }> {
  const lovable = process.env["LOVABLE_API_KEY"], key = process.env["META_ADS_API_KEY"];
  if (!lovable || !key) return { ok: false, http: null, code: "not_connected" };
  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": key }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    const name = e instanceof Error ? e.name : "unknown";
    return { ok: false, http: null, code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  if (res.status >= 300 && res.status < 400) { await res.body?.cancel().catch(() => undefined); return { ok: false, http: res.status, code: "redirect" }; }
  let body: unknown = null;
  try { body = JSON.parse((await res.text()).slice(0, 2_000_000)); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = (body as { error?: { code?: unknown; error_subcode?: unknown } } | null)?.error;
    const code = typeof err?.code === "number" ? (typeof err.error_subcode === "number" ? `${err.code}:${err.error_subcode}` : String(err.code)) : "unknown";
    console.error(`Meta Ads spend request failed [${res.status}] code=${code} path=${path.replace(/\d+/g, "{id}")}`);
    return { ok: false, http: res.status, code };
  }
  return { ok: true, body };
}

export function spendFailureText(code: string | null) {
  if (!code) return "";
  if (code === "not_connected") return "A conexão com a Meta não está disponível no servidor.";
  if (code === "timeout" || code === "network") return "A Meta não respondeu. Tente de novo em instantes.";
  if (code.startsWith("190")) return "A autorização da Meta expirou. Reconecte a Meta nas integrações.";
  if (["10", "200", "294", "272"].some((p) => code === p || code.startsWith(`${p}:`))) return "A conexão não tem permissão para ler essa conta de anúncios.";
  if (code === "100" || code.startsWith("100:")) return "A Meta não encontrou essa conta de anúncios para a conexão.";
  if (["4", "17", "32", "613"].includes(code.split(":")[0]) || code.startsWith("80")) return "A Meta limitou as consultas por enquanto. Aguarde alguns minutos.";
  return "A Meta recusou a consulta. Nada foi importado.";
}

/** Ad accounts visible to the workspace connection, minus none — linking decides the company. */
export async function discoverAdAccounts() {
  const r = await meta("me/adaccounts", { fields: "id,name,currency,timezone_name,account_status", limit: "100" });
  if (!r.ok) return { accounts: [], failure: r.code };
  const data = (r.body as { data?: { id: string; name?: string; currency?: string; timezone_name?: string; account_status?: number }[] })?.data ?? [];
  return { accounts: data.filter((a) => /^act_\d{5,25}$/.test(a.id)).map((a) => ({ id: a.id, name: (a.name ?? "").slice(0, 200), currency: a.currency ?? "", timezone: a.timezone_name ?? "", active: a.account_status === 1 })), failure: null };
}

async function fetchInsights(adAccountId: string, since: string, until: string) {
  const rows: unknown[] = [];
  let after: string | undefined;
  for (let page = 0; page < 30; page++) {
    const r = await meta(`${adAccountId}/insights`, { level: "adset", time_increment: "1", limit: "500",
      fields: "campaign_id,campaign_name,adset_id,adset_name,spend,account_currency,date_start",
      time_range: JSON.stringify({ since, until }), ...(after ? { after } : {}) });
    if (!r.ok) return { ok: false as const, code: r.code };
    const body = r.body as { data?: unknown[]; paging?: { cursors?: { after?: string }; next?: string } };
    rows.push(...(body.data ?? []));
    after = body.paging?.next ? body.paging.cursors?.after : undefined;
    if (!after) return { ok: true as const, rows };
  }
  return { ok: false as const, code: "too_many_pages" };
}

/** Read-only test: the account itself and the last 7 days, nothing saved except the test result. */
export async function testAccount(db: Db, id: string) {
  const { data: acc } = await db.from("meta_ads_spend_accounts").select("ad_account_id").eq("id", id).eq("active", true).maybeSingle();
  if (!acc) throw new Error("Conta não encontrada.");
  const info = await meta(acc.ad_account_id, { fields: "id,name,currency,timezone_name,account_status" });
  const today = saoPauloToday();
  const since = new Date(`${today}T12:00:00Z`); since.setUTCDate(since.getUTCDate() - 6);
  const sample = info.ok ? await fetchInsights(acc.ad_account_id, since.toISOString().slice(0, 10), today) : null;
  const ok = info.ok && sample?.ok === true;
  const code = !info.ok ? info.code : sample && !sample.ok ? sample.code : null;
  const a = info.ok ? info.body as { name?: string; currency?: string; timezone_name?: string } : {};
  await db.from("meta_ads_spend_accounts").update({ last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_code: code?.slice(0, 80) ?? null,
    ...(info.ok ? { account_name: (a.name ?? "").slice(0, 200), currency: /^[A-Z]{3}$/.test(a.currency ?? "") ? a.currency : "", timezone: (a.timezone_name ?? "").slice(0, 80) } : {}), updated_at: new Date().toISOString() }).eq("id", id);
  const parsed = sample?.ok ? parseInsights(sample.rows) : null;
  return { ok, failure: code ? spendFailureText(code) : null, last7Cents: parsed ? parsed.rows.reduce((s, r) => s + r.spend_cents, 0) : null, currency: a.currency ?? null };
}

/** Imports [since, until] and upserts one row per day+adset; re-import replaces values, never adds. */
export async function importAccount(db: Db, adAccountId: string, since: string, until: string) {
  const r = await fetchInsights(adAccountId, since, until);
  const now = new Date().toISOString();
  if (!r.ok) {
    await db.from("meta_ads_spend_accounts").update({ last_sync_at: now, last_sync_status: "failed", last_sync_code: r.code.slice(0, 80), updated_at: now }).eq("ad_account_id", adAccountId);
    return { ok: false as const, failure: spendFailureText(r.code), imported: 0 };
  }
  const { rows, rejected } = parseInsights(r.rows);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((x: SpendRow) => ({ ...x, ad_account_id: adAccountId, synced_at: now }));
    const { error } = await db.from("meta_ads_spend_daily").upsert(chunk, { onConflict: "ad_account_id,spend_date,adset_id" });
    if (error) {
      await db.from("meta_ads_spend_accounts").update({ last_sync_at: now, last_sync_status: "failed", last_sync_code: "save", updated_at: now }).eq("ad_account_id", adAccountId);
      return { ok: false as const, failure: "A leitura funcionou, mas não foi possível salvar. Tente de novo.", imported: i };
    }
  }
  const { data: acc } = await db.from("meta_ads_spend_accounts").select("synced_from").eq("ad_account_id", adAccountId).maybeSingle();
  await db.from("meta_ads_spend_accounts").update({ last_sync_at: now, last_sync_status: "ok", last_sync_code: rejected ? `rejected:${rejected}` : null,
    synced_from: !acc?.synced_from || since < acc.synced_from ? since : acc.synced_from, updated_at: now }).eq("ad_account_id", adAccountId);
  return { ok: true as const, failure: null, imported: rows.length };
}

const shift = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const daysAgo = (n: number) => shift(saoPauloToday(), -n);

/** Daily job: refreshes the last 30 days (Meta adjusts recent spend) for active, enabled accounts only. */
export async function runMetaAdsSpendScheduled(bearer: string) {
  const db = await adminDb();
  const { data: runner } = await db.from("meta_ads_spend_runner").select("token").eq("id", true).single();
  const expected = runner?.token ?? "";
  if (!expected || expected.length !== bearer.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ bearer.charCodeAt(i);
  if (diff !== 0) return null;
  const { data: accounts } = await db.from("meta_ads_spend_accounts").select("ad_account_id,last_test_ok").eq("active", true).eq("sync_enabled", true);
  const result = { accounts: 0, ok: 0, failed: 0 };
  for (const a of accounts ?? []) {
    if (!a.last_test_ok) continue;
    result.accounts++;
    const r = await importAccount(db as unknown as Db, a.ad_account_id, daysAgo(29), saoPauloToday());
    if (r.ok) result.ok++; else result.failed++;
  }
  await db.from("meta_ads_spend_runner").update({ last_run_at: new Date().toISOString(), last_result: result }).eq("id", true);
  return result;
}
