import { encryptInstagramToken as encrypt, decryptInstagramToken as decrypt } from "./instagram-oauth-crypto.server";
import { integrationsAdmin, integrationsDb } from "./integrations-admin.server";
import { customIntegrationInput, safeBaseUrl, integrationTestPath } from "./custom-integrations";
import type { z } from "zod";

const ctx = (id: string) => `external-integration:custom:${id}`;
function key() { const k = process.env["INTEGRATIONS_ENCRYPTION_KEY"]; if (!k) throw new Error("Chave de proteção das credenciais ausente no servidor."); return k; }
const COLS = "id,name,status,base_url,auth_method,auth_header,endpoints,last_check_at,last_check_status,revision,encrypted_credentials";

export async function listCustom() {
  await integrationsAdmin("custom");
  const { data, error } = await (await integrationsDb()).from("crm_external_integrations").select(COLS).eq("provider", "custom").order("created_at");
  if (error) throw new Error("Não foi possível ler as integrações.");
  return (data ?? []).map(({ encrypted_credentials, ...r }) => ({ ...r, credentialSaved: Boolean(encrypted_credentials) }));
}

export async function saveCustom(input: z.infer<typeof customIntegrationInput>) {
  const actor = await integrationsAdmin("custom");
  if (!safeBaseUrl(input.baseUrl)) throw new Error("Use um endereço HTTPS público para a URL da API.");
  if (input.authMethod === "api_key_header" && !input.authHeader) throw new Error("Informe o nome do cabeçalho da chave.");
  const db = await integrationsDb();
  const row = { name: input.name, base_url: input.baseUrl.replace(/\/+$/, ""), auth_method: input.authMethod, auth_header: input.authHeader || null, endpoints: input.endpoints, updated_at: new Date().toISOString() };
  await actor.authorize();
  if (!input.id) {
    const ins = await db.from("crm_external_integrations").insert({ ...row, provider: "custom", status: "desativada" }).select("id").single();
    if (ins.error) throw new Error(ins.error.code === "23505" ? "Já existe uma integração com esse nome." : "Não foi possível cadastrar.");
    if (input.credential) await db.from("crm_external_integrations").update({ encrypted_credentials: await encrypt(input.credential, key(), ctx(ins.data.id)) }).eq("id", ins.data.id);
    return { id: ins.data.id as string };
  }
  const patch: Record<string, unknown> = { ...row, revision: input.revision + 1, last_check_status: null };
  if (input.credential) patch.encrypted_credentials = await encrypt(input.credential, key(), ctx(input.id));
  const up = await db.from("crm_external_integrations").update(patch as never).eq("id", input.id).eq("provider", "custom").eq("revision", input.revision).select("id");
  if (up.error || !up.data?.length) throw new Error(up.error?.code === "23505" ? "Já existe uma integração com esse nome." : "A integração mudou. Atualize a página.");
  return { id: input.id };
}

export async function setCustomActive(id: string, active: boolean) {
  const actor = await integrationsAdmin("custom");
  const db = await integrationsDb();
  const cur = await db.from("crm_external_integrations").select("last_check_status").eq("id", id).eq("provider", "custom").single();
  if (cur.error) throw new Error("Integração não encontrada.");
  if (active && cur.data.last_check_status !== "ok") throw new Error("Teste a integração com sucesso antes de ativar.");
  await actor.authorize();
  const r = await db.from("crm_external_integrations").update({ status: active ? "ativa" : "desativada" }).eq("id", id).eq("provider", "custom");
  if (r.error) throw new Error("Não foi possível alterar.");
  return { ok: true };
}

export async function deleteCustom(id: string) {
  const actor = await integrationsAdmin("custom"); await actor.authorize();
  const r = await (await integrationsDb()).from("crm_external_integrations").delete().eq("id", id).eq("provider", "custom");
  if (r.error) throw new Error("Não foi possível remover.");
  return { ok: true };
}

/** Test = one GET to the first GET endpoint (or base URL). Only the HTTP status is kept; response bodies are never stored or shown. */
export async function testCustom(id: string) {
  const actor = await integrationsAdmin("custom");
  const db = await integrationsDb();
  const { data: it, error } = await db.from("crm_external_integrations").select(COLS).eq("id", id).eq("provider", "custom").single();
  if (error || !it) throw new Error("Integração não encontrada.");
  if (!it.base_url || !safeBaseUrl(it.base_url)) throw new Error("URL da API inválida.");
  // Run/dataset endpoints contain unresolved placeholders and cannot verify an account.
  const testPath = integrationTestPath(it.base_url, it.name, (it.endpoints ?? []) as { method: string; path: string }[]);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (it.auth_method !== "none") {
    if (!it.encrypted_credentials) throw new Error("Cadastre a credencial antes de testar.");
    const cred = await decrypt(it.encrypted_credentials, key(), ctx(id));
    if (it.auth_method === "bearer") headers.Authorization = `Bearer ${cred}`;
    else if (it.auth_method === "basic") headers.Authorization = `Basic ${btoa(cred)}`;
    else headers[it.auth_header || "X-API-Key"] = cred;
  }
  let status = "network";
  try {
    const res = await fetch(`${it.base_url.replace(/\/+$/, '')}${testPath}`, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    await res.body?.cancel().catch(() => undefined);
    status = res.ok ? "ok" : `http_${res.status}`;
  } catch (e) { status = e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network"; }
  await actor.authorize();
  await db.from("crm_external_integrations").update({ last_check_status: status, last_check_at: new Date().toISOString(), status: status === "ok" ? undefined : "desativada" } as never).eq("id", id);
  return { ok: status === "ok", status };
}
