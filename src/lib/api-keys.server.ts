import { b2bDb, requireB2bAccess } from "./b2b-prospecting.server";
import { API_KEY_MAX_ACTIVE, apiKeyNameSchema, apiKeyPrefix, hashApiKey, newApiKey } from "./api-keys";

async function db() { await requireB2bAccess(); return b2bDb(); }

export async function apiIntegrationsOverview() {
  const d = await db();
  const [keys, subs] = await Promise.all([
    d.from("crm_api_keys").select("id,name,prefix,scope,use_count,last_used_at,revoked_at,created_at").order("created_at", { ascending: false }).limit(100),
    d.from("crm_diagnosis_submissions").select("id,event_id,name,company,outcome,lead_id,paused_count,received_at").order("received_at", { ascending: false }).limit(30),
  ]);
  if (keys.error || subs.error) throw new Error("Não foi possível carregar as integrações.");
  return {
    keys: (keys.data ?? []) as { id: string; name: string; prefix: string; scope: string; use_count: number; last_used_at: string | null; revoked_at: string | null; created_at: string }[],
    submissions: (subs.data ?? []) as { id: string; event_id: string; name: string; company: string; outcome: string; lead_id: string | null; paused_count: number; received_at: string }[],
  };
}

/** Cria a chave; devolve o valor completo uma única vez (só o hash fica guardado). */
export async function createApiKey(rawName: string) {
  const name = apiKeyNameSchema.parse(rawName);
  const d = await db();
  const active = await d.from("crm_api_keys").select("id", { count: "exact", head: true }).is("revoked_at", null);
  if (active.error) throw new Error("Não foi possível criar a chave.");
  if ((active.count ?? 0) >= API_KEY_MAX_ACTIVE) throw new Error(`Limite de ${API_KEY_MAX_ACTIVE} chaves ativas. Revogue uma antes de criar outra.`);
  const key = newApiKey();
  const { data, error } = await d.from("crm_api_keys").insert({ name, prefix: apiKeyPrefix(key), key_hash: await hashApiKey(key) }).select("id,name,prefix").single();
  if (error || !data) throw new Error("Não foi possível criar a chave.");
  return { id: data.id as string, name: data.name as string, prefix: data.prefix as string, key };
}

export async function renameApiKey(id: string, rawName: string) {
  const name = apiKeyNameSchema.parse(rawName);
  const d = await db();
  const { data, error } = await d.from("crm_api_keys").update({ name }).eq("id", id).is("revoked_at", null).select("id").maybeSingle();
  if (error || !data) throw new Error("Chave não encontrada ou já revogada.");
  return { ok: true };
}

export async function revokeApiKey(id: string) {
  const d = await db();
  const { data, error } = await d.from("crm_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null).select("id").maybeSingle();
  if (error) throw new Error("Não foi possível revogar a chave.");
  return { ok: Boolean(data) };
}
