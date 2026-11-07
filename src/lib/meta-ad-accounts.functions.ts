import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const needsAuth = (e: unknown) => e instanceof Error && /senha de acesso completo/.test(e.message);
async function guarded<T>(fn: (actor: string) => Promise<T>) {
  try {
    const m = await import("./integrations-admin.server");
    const a: unknown = await m.integrationsAdmin("meta-ads");
    const actor = typeof a === "object" && a && "actor" in a ? String((a as { actor: unknown }).actor) : "admin";
    return { needsAuth: false as const, error: null, data: await fn(actor) };
  } catch (e) { if (needsAuth(e)) return { needsAuth: true as const, error: null, data: null }; return { needsAuth: false as const, error: e instanceof Error ? e.message : "Falha.", data: null }; }
}
const db = async () => (await import("./integrations-admin.server")).integrationsDb();
const actId = z.string().regex(/^act_\d{5,25}$/);

/** Contas adicionadas ao Pipeflow com o cliente vinculado. */
export const listMetaRegistry = createServerFn({ method: "POST" }).handler(() => guarded(async () => {
  const d = await db();
  const [acc, links, clients] = await Promise.all([
    d.from("crm_meta_ad_accounts").select("*").order("account_name"),
    d.from("crm_client_ad_accounts").select("account_id,client_id").eq("platform", "meta_ads"),
    d.from("crm_clients").select("id,legal_name,trade_name"),
  ]);
  if (acc.error) throw new Error("Não foi possível ler as contas adicionadas.");
  const cn = new Map((clients.data ?? []).map(c => [c.id as string, String((c as { trade_name?: string | null; legal_name?: string }).trade_name || c.legal_name || "")]));
  const owner = new Map((links.data ?? []).map(l => [l.account_id as string, l.client_id as string]));
  return acc.data.map(a => ({ ...a, client_id: owner.get(a.account_id) ?? null, client_name: owner.has(a.account_id) ? cn.get(owner.get(a.account_id)!) ?? "" : null }));
}));

/** Busca na Meta todas as contas autorizadas (somente leitura). */
export const discoverMetaAccounts = createServerFn({ method: "POST" }).handler(() => guarded(async () => {
  const { metaDiscoverAccounts } = await import("./ads-platforms.server");
  const r = await metaDiscoverAccounts();
  const added = await (await db()).from("crm_meta_ad_accounts").select("account_id");
  const set = new Set((added.data ?? []).map(a => a.account_id));
  return { ...r, accounts: r.accounts.map(a => ({ ...a, added: set.has(a.id) })) };
}));

/** Adiciona as contas selecionadas; os dados vêm de nova leitura na Meta, nunca do navegador. */
export const addMetaAccounts = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ ids: z.array(actId).min(1).max(500) }).strict().parse(i))
  .handler(({ data }) => guarded(async (actor) => {
    const { metaDiscoverAccounts } = await import("./ads-platforms.server");
    const r = await metaDiscoverAccounts();
    if (!r.ok) throw new Error(r.error);
    const want = new Set(data.ids);
    const rows = r.accounts.filter(a => want.has(a.id)).map(a => ({ account_id: a.id, account_name: a.name, business_id: a.businessId, business_name: a.businessName, account_status: a.status, accessible: true, added_by: actor.slice(0, 160), last_synced_at: new Date().toISOString() }));
    if (!rows.length) throw new Error("Nenhuma das contas selecionadas está acessível pela conexão.");
    const w = await (await db()).from("crm_meta_ad_accounts").upsert(rows, { onConflict: "account_id", ignoreDuplicates: false });
    if (w.error) throw new Error("Não foi possível adicionar as contas.");
    return { added: rows.length, missing: data.ids.length - rows.length };
  }));

/** Atualiza nome/portfólio/status das contas adicionadas e marca as que perderam acesso. */
export const syncMetaAccounts = createServerFn({ method: "POST" }).handler(() => guarded(async () => {
  const { metaDiscoverAccounts } = await import("./ads-platforms.server");
  const r = await metaDiscoverAccounts();
  if (!r.ok) throw new Error(r.error);
  const d = await db();
  const cur = await d.from("crm_meta_ad_accounts").select("account_id");
  const seen = new Map(r.accounts.map(a => [a.id, a]));
  const now = new Date().toISOString();
  let lost = 0;
  for (const row of cur.data ?? []) {
    const a = seen.get(row.account_id);
    const u = a ? { account_name: a.name, business_id: a.businessId, business_name: a.businessName, account_status: a.status, accessible: true, last_synced_at: now } : { accessible: false, last_synced_at: now };
    if (!a) lost++;
    await d.from("crm_meta_ad_accounts").update(u).eq("account_id", row.account_id);
  }
  return { total: cur.data?.length ?? 0, lost, available: r.accounts.length, notes: r.notes };
}));

/** Remove do Pipeflow (não exclui nada na Meta). Vínculos com clientes são preservados. */
export const removeMetaAccount = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ id: actId }).strict().parse(i))
  .handler(({ data }) => guarded(async () => {
    const r = await (await db()).from("crm_meta_ad_accounts").delete().eq("account_id", data.id);
    if (r.error) throw new Error("Não foi possível remover a conta.");
    return { removed: true };
  }));
