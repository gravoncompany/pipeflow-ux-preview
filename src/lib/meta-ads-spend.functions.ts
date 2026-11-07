import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adAccountIdSchema } from "./meta-ads-spend";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const owner = z.union([z.object({ kind: z.literal("gravon") }).strict(), z.object({ kind: z.literal("client"), clientId: z.string().uuid() }).strict()]);

async function access(admin: boolean) {
  const { financeAccess } = await import("./finance-management.server");
  const a = await financeAccess(false);
  if (admin && !a.personalAllowed) throw new Error("Entre com sua conta administrativa verificada para gerenciar as contas da Meta.");
  return a;
}

/** Linked accounts (by company), discoverable accounts and clients. Admin-only discovery. */
export const getMetaAdsSetup = createServerFn({ method: "POST" }).handler(async () => {
  const a = await access(false);
  const [{ data: accounts, error }, { data: clients }] = await Promise.all([
    a.db.from("meta_ads_spend_accounts").select("id,owner_kind,client_id,ad_account_id,account_name,currency,timezone,sync_enabled,last_test_at,last_test_ok,last_test_code,last_sync_at,last_sync_status,last_sync_code,synced_from,revision").eq("active", true).order("created_at"),
    a.db.from("crm_clients").select("id,trade_name").order("trade_name"),
  ]);
  if (error) throw new Error("Não foi possível ler as contas da Meta.");
  let discovered: { id: string; name: string; currency: string; active: boolean }[] = [];
  let discoveryFailure: string | null = null;
  if (a.personalAllowed) {
    const { discoverAdAccounts, spendFailureText } = await import("./meta-ads-spend.server");
    const d = await discoverAdAccounts();
    discovered = d.accounts; discoveryFailure = d.failure ? spendFailureText(d.failure) : null;
  }
  const { spendFailureText } = await import("./meta-ads-spend.server");
  return { admin: a.personalAllowed, clients: clients ?? [], discovered, discoveryFailure,
    accounts: (accounts ?? []).map((x) => ({ ...x, testFailure: x.last_test_ok === false ? spendFailureText(x.last_test_code) : null, syncFailure: x.last_sync_status === "failed" ? spendFailureText(x.last_sync_code) : null })) };
});

/** Binds an ad account to exactly one company; an account already bound elsewhere is refused. */
export const linkMetaAdAccount = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ adAccountId: adAccountIdSchema, owner }).strict().parse(i)).handler(async ({ data }) => {
  const a = await access(true);
  const { discoverAdAccounts } = await import("./meta-ads-spend.server");
  const found = (await discoverAdAccounts()).accounts.find((x) => x.id === data.adAccountId);
  if (!found) throw new Error("Essa conta de anúncios não está liberada na conexão com a Meta.");
  if (data.owner.kind === "client") {
    const { data: c } = await a.db.from("crm_clients").select("id").eq("id", data.owner.clientId).maybeSingle();
    if (!c) throw new Error("Cliente não encontrado.");
  }
  const { data: existing } = await a.db.from("meta_ads_spend_accounts").select("id,active,owner_kind,client_id").eq("ad_account_id", data.adAccountId).maybeSingle();
  const ownerFields = { owner_kind: data.owner.kind, client_id: data.owner.kind === "client" ? data.owner.clientId : null };
  if (existing?.active) throw new Error("Essa conta de anúncios já está vinculada a uma empresa. Desvincule antes de trocar.");
  if (existing && (existing.owner_kind !== ownerFields.owner_kind || existing.client_id !== ownerFields.client_id)) {
    throw new Error("Essa conta já teve gastos importados para outra empresa. Vincule-a à mesma empresa para não misturar os dados.");
  }
  const fields = { ...ownerFields, account_name: found.name, currency: /^[A-Z]{3}$/.test(found.currency) ? found.currency : "", timezone: "", active: true, sync_enabled: false, last_test_ok: null, created_by: a.actor, updated_at: new Date().toISOString() };
  const { error } = existing ? await a.db.from("meta_ads_spend_accounts").update(fields).eq("id", existing.id) : await a.db.from("meta_ads_spend_accounts").insert({ ad_account_id: data.adAccountId, ...fields });
  if (error) throw new Error("Não foi possível vincular a conta.");
  return { linked: true };
});

export const testMetaAdAccount = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i)).handler(async ({ data }) => {
  const a = await access(true);
  const { testAccount } = await import("./meta-ads-spend.server");
  return testAccount(a.db, data.id);
});

/** Turning the daily import on requires a successful test; the first import brings the last 90 days. */
export const setMetaAdSync = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ id: z.string().uuid(), enabled: z.boolean(), revision: z.number().int().positive() }).parse(i)).handler(async ({ data }) => {
  const a = await access(true);
  const { data: acc } = await a.db.from("meta_ads_spend_accounts").select("ad_account_id,last_test_ok,synced_from").eq("id", data.id).eq("active", true).maybeSingle();
  if (!acc) throw new Error("Conta não encontrada.");
  if (data.enabled && !acc.last_test_ok) throw new Error("Teste a conexão desta conta antes de ativar a importação.");
  const { data: upd, error } = await a.db.from("meta_ads_spend_accounts").update({ sync_enabled: data.enabled, revision: data.revision + 1, updated_at: new Date().toISOString() }).eq("id", data.id).eq("revision", data.revision).select("id");
  if (error || !upd?.length) throw new Error("A conta mudou desde que você abriu a página. Atualize e tente de novo.");
  if (!data.enabled) return { enabled: false, imported: 0, failure: null };
  const { importAccount, daysAgo } = await import("./meta-ads-spend.server");
  const { saoPauloToday } = await import("./meta-ads-spend");
  const r = await importAccount(a.db, acc.ad_account_id, acc.synced_from ?? daysAgo(89), saoPauloToday());
  return { enabled: true, imported: r.imported, failure: r.failure };
});

export const importMetaAdSpendNow = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i)).handler(async ({ data }) => {
  const a = await access(true);
  const { data: acc } = await a.db.from("meta_ads_spend_accounts").select("ad_account_id,sync_enabled,last_test_ok").eq("id", data.id).eq("active", true).maybeSingle();
  if (!acc?.sync_enabled || !acc.last_test_ok) throw new Error("Ative a importação desta conta primeiro.");
  const { importAccount, daysAgo } = await import("./meta-ads-spend.server");
  const { saoPauloToday } = await import("./meta-ads-spend");
  return importAccount(a.db, acc.ad_account_id, daysAgo(29), saoPauloToday());
});

/** Unlinking stops imports and hides the account; imported history stays bound to the same company. */
export const unlinkMetaAdAccount = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ id: z.string().uuid(), revision: z.number().int().positive() }).parse(i)).handler(async ({ data }) => {
  const a = await access(true);
  const { data: upd, error } = await a.db.from("meta_ads_spend_accounts").update({ active: false, sync_enabled: false, revision: data.revision + 1, updated_at: new Date().toISOString() }).eq("id", data.id).eq("revision", data.revision).select("id");
  if (error || !upd?.length) throw new Error("A conta mudou desde que você abriu a página. Atualize e tente de novo.");
  return { unlinked: true };
});

/** Spend for ONE company and period; rows of other companies are never read. */
export const getMetaAdSpend = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ owner, from: date, to: date }).refine((d) => d.from <= d.to, "Período inválido.").parse(i)).handler(async ({ data }) => {
  const a = await access(false);
  let q = a.db.from("meta_ads_spend_accounts").select("ad_account_id,account_name,currency,active,sync_enabled,last_sync_at").eq("owner_kind", data.owner.kind);
  q = data.owner.kind === "client" ? q.eq("client_id", data.owner.clientId) : q.is("client_id", null);
  const { data: accounts, error } = await q;
  if (error) throw new Error("Não foi possível ler as contas da Meta.");
  const ids = (accounts ?? []).map((x) => x.ad_account_id);
  const rows: { ad_account_id: string; spend_date: string; campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; spend_cents: number; currency: string }[] = [];
  for (let offset = 0; ids.length && offset < 50_000; offset += 1000) {
    const { data: page, error: e } = await a.db.from("meta_ads_spend_daily").select("ad_account_id,spend_date,campaign_id,campaign_name,adset_id,adset_name,spend_cents,currency")
      .in("ad_account_id", ids).gte("spend_date", data.from).lte("spend_date", data.to).order("spend_date").order("adset_id").range(offset, offset + 999);
    if (e) throw new Error("Não foi possível ler o investimento.");
    rows.push(...(page ?? []));
    if ((page?.length ?? 0) < 1000) break;
  }
  return { accounts: accounts ?? [], rows };
});
