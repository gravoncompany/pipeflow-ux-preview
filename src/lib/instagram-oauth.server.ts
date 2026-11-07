import { getCookie, setCookie, deleteCookie, getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { instagramAdministrator } from "./instagram.server";
import {
  INSTAGRAM_OAUTH_CALLBACK,
  instagramAuthorizationUrl,
  instagramOAuthQuery,
} from "./instagram-oauth";
import { oauthHash, oauthNonce, encryptInstagramToken } from "./instagram-oauth-crypto.server";
import { exchangeInstagramCode } from "./instagram-oauth-api.server";
import {
  InstagramOAuthError,
  instagramOAuthDiagnostic,
  type InstagramOAuthStage,
} from "./instagram-oauth-diagnostics";

const COOKIE = "pipeflow-instagram-oauth";
const SETTINGS = "/configuracoes/integracoes/instagram";
export async function startInstagramOAuth(appId: string) {
  const actor = await instagramAdministrator();
  if (new URL(getRequest().url).origin !== new URL(INSTAGRAM_OAUTH_CALLBACK).origin)
    throw new Error("Abra o CRM em crm.gravoncompany.com para conectar pelo Instagram.");
  if (
    !(process.env["INSTAGRAM_OAUTH_APP_SECRET"] || process.env["INSTAGRAM_APP_SECRET"]) ||
    !process.env["INSTAGRAM_OAUTH_ENCRYPTION_KEY"]
  )
    throw new Error("instagram_oauth_configuration_missing");
  const state = oauthNonce();
  const binding = oauthNonce();
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  await actor.authorize();
  const { error } = await db.from("instagram_oauth_flows").insert({
    state_hash: await oauthHash(state),
    binding_hash: await oauthHash(binding),
    author_id: actor.userId,
    company_key: actor.company,
    app_id: appId,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  });
  if (error) throw new Error("instagram_storage_failed");
  setCookie(COOKIE, `${state}.${binding}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return { url: instagramAuthorizationUrl(appId, state) };
}
export async function instagramOAuthCallback(request: Request) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const url = new URL(request.url);
  const parsed = instagramOAuthQuery.safeParse(Object.fromEntries(url.searchParams));
  const [state, binding] = getCookie(COOKIE)?.split(".") ?? [];
  if (
    !parsed.success ||
    !binding ||
    state !== parsed.data.state ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.getAll("code").length > 1
  )
    return new Response("Invalid OAuth state", { status: 400, headers });
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const stateHash = await oauthHash(state);
  const bindingHash = await oauthHash(binding);
  const { data: flow, error } = await db
    .from("instagram_oauth_flows")
    .update({
      status: "exchanging",
      callback_received_at: new Date().toISOString(),
      diagnostic_stage: "authorization",
      diagnostic_code: null,
      diagnostic_http_status: null,
    })
    .eq("state_hash", stateHash)
    .eq("binding_hash", bindingHash)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("company_key,author_id,app_id")
    .maybeSingle();
  if (error || !flow)
    return new Response("Invalid or expired OAuth state", { status: 400, headers });
  let outcome = "failed";
  let stage: InstagramOAuthStage = "configuration";
  try {
    // Dedicated Instagram Login secret can be supplied without rotating the existing webhook secret.
    const secret = process.env["INSTAGRAM_OAUTH_APP_SECRET"] || process.env["INSTAGRAM_APP_SECRET"];
    const encryption = process.env["INSTAGRAM_OAUTH_ENCRYPTION_KEY"];
    if (!flow.app_id || !secret || !encryption)
      throw new InstagramOAuthError(stage, "configuration_missing");
    stage = "authorization";
    if (parsed.data.error) throw new InstagramOAuthError(stage, "authorization_denied");
    if (!parsed.data.code) throw new InstagramOAuthError(stage, "authorization_code_missing");
    const { data: allowed, error: accessError } = await db.rpc("commercial_knowledge_access", {
      p_author: flow.author_id,
      p_company: flow.company_key,
    });
    if (accessError || !allowed) throw new InstagramOAuthError(stage, "admin_required");
    const result = await exchangeInstagramCode(flow.app_id, secret, parsed.data.code);
    stage = "encryption";
    const encryptedToken = await encryptInstagramToken(
      result.token,
      encryption,
      `${flow.company_key}:${result.instagramId}`,
    );
    stage = "storage";
    const { error: storeError } = await db
      .from("instagram_oauth_flows")
      .update({
        status: "ready",
        instagram_id: result.instagramId,
        username: result.username,
        encrypted_token: encryptedToken,
        token_expires_at: result.expiresAt,
        verified_scopes: result.verifiedScopes,
        diagnostic_stage: "storage",
        diagnostic_code: null,
      })
      .eq("state_hash", stateHash)
      .eq("status", "exchanging");
    if (storeError) throw new InstagramOAuthError(stage, "storage_failed");
    outcome = "ready";
    console.info("instagram_oauth_result", { status: "ready", stage: "storage" });
  } catch (error) {
    const diagnostic = instagramOAuthDiagnostic(error, stage);
    await db
      .from("instagram_oauth_flows")
      .update({
        status: "failed",
        encrypted_token: null,
        diagnostic_stage: diagnostic.stage,
        diagnostic_code: diagnostic.code,
        diagnostic_http_status: diagnostic.httpStatus,
      })
      .eq("state_hash", stateHash);
    console.info("instagram_oauth_result", { status: "failed", ...diagnostic });
  }
  return new Response(null, {
    status: 303,
    headers: { ...headers, Location: `${SETTINGS}?instagram_oauth=${outcome}` },
  });
}
export async function finishInstagramOAuth() {
  const actor = await instagramAdministrator();
  const [state, binding] = getCookie(COOKIE)?.split(".") ?? [];
  if (!state || !binding) throw new Error("instagram_oauth_state_missing");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  await actor.authorize();
  const { data, error } = await db.rpc("complete_instagram_oauth", {
    p_state: await oauthHash(state),
    p_binding: await oauthHash(binding),
    p_author: actor.userId,
    p_company: actor.company,
  });
  if (error) throw new Error("instagram_oauth_finalization_failed");
  const result = z.object({ accountId: z.string().uuid(), preserved: z.boolean() }).parse(data);
  deleteCookie(COOKIE, { path: "/", secure: true, sameSite: "lax" });
  return result;
}
