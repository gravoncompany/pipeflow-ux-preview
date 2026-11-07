import { z } from "zod";
import { instagramApi, InstagramApiError, readBounded } from "./instagram-api.server";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import { INSTAGRAM_OAUTH_CALLBACK, INSTAGRAM_OAUTH_SCOPES } from "./instagram-oauth";
import {
  instagramOAuthIdentity,
  instagramOAuthPermissions,
  parseInstagramOAuthResponse,
} from "./instagram-oauth-response";
import { InstagramOAuthError, type InstagramOAuthStage } from "./instagram-oauth-diagnostics";

async function tokenRequest(
  url: string,
  init: RequestInit,
  transport: typeof fetch,
  stage: InstagramOAuthStage,
) {
  let response: Response;
  try {
    response = await fetchWithoutRedirects(
      url,
      { ...init, signal: AbortSignal.timeout(10000) },
      transport,
    );
  } catch {
    throw new InstagramOAuthError(stage, "transport_failed");
  }
  let json: unknown;
  try {
    json = parseInstagramOAuthResponse(
      new TextDecoder().decode(await readBounded(response, 32768)),
    );
  } catch {
    throw new InstagramOAuthError(stage, "response_invalid", response.status);
  }
  const failure = z
    .object({
      error_type: z.string().optional(),
      error_message: z.string().max(8192).optional(),
      error: z
        .union([z.string(), z.object({ message: z.string().max(8192).optional() })])
        .optional(),
    })
    .safeParse(json);
  if (!response.ok || (failure.success && (failure.data.error_type || failure.data.error))) {
    // Provider prose is inspected only to choose a fixed diagnostic enum, never stored or returned.
    const message = failure.success
      ? (failure.data.error_message ??
        (typeof failure.data.error === "string"
          ? failure.data.error
          : failure.data.error?.message) ??
        "")
      : "";
    const reason = /redirect[_ ]?uri|redirect url/i.test(message)
      ? "redirect_uri_mismatch"
      : /client secret|invalid client|client_id|app secret/i.test(message)
        ? "invalid_client"
        : /authorization code|code.*expired|code.*used/i.test(message)
          ? "invalid_authorization_code"
          : "provider_rejected";
    throw new InstagramOAuthError(stage, reason, response.status);
  }
  return { json, httpStatus: response.status };
}
export async function exchangeInstagramCode(
  appId: string,
  appSecret: string,
  code: string,
  transport: typeof fetch = fetch,
) {
  let stage: InstagramOAuthStage = "code_exchange";
  try {
    const short = z.object({
      access_token: z.string().min(1).max(8192),
      user_id: instagramOAuthIdentity,
      permissions: instagramOAuthPermissions.optional(),
    });
    const shortReply = await tokenRequest(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          grant_type: "authorization_code",
          redirect_uri: INSTAGRAM_OAUTH_CALLBACK,
          code,
        }).toString(),
      },
      transport,
      stage,
    );
    const envelope = z
      .union([
        short,
        z.object({ data: z.array(short).length(1) }).transform((reply) => reply.data[0]),
      ])
      .safeParse(shortReply.json);
    if (!envelope.success || !envelope.data)
      throw new InstagramOAuthError(stage, "response_invalid", shortReply.httpStatus);
    const shortToken = envelope.data;
    if (
      shortToken.permissions &&
      !INSTAGRAM_OAUTH_SCOPES.every((scope) => shortToken.permissions?.includes(scope))
    )
      throw new InstagramOAuthError("permissions", "permissions_missing");
    stage = "long_token_exchange";
    const url = new URL("https://graph.instagram.com/access_token");
    url.search = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: shortToken.access_token,
    }).toString();
    const longReply = await tokenRequest(url.toString(), { method: "GET" }, transport, stage);
    const longToken = z
      .object({
        access_token: z.string().min(1).max(8192),
        token_type: z.string(),
        expires_in: z.number().int().positive().max(31536000),
      })
      .safeParse(longReply.json);
    if (!longToken.success)
      throw new InstagramOAuthError(stage, "response_invalid", longReply.httpStatus);
    const token = longToken.data;
    stage = "identity";
    const profile = z.object({
      user_id: instagramOAuthIdentity,
      username: z.string().min(1).max(100),
      account_type: z.enum(["BUSINESS", "MEDIA_CREATOR"]),
    });
    const identity = profile.parse(
      await instagramApi(
        "me?fields=user_id,username,account_type",
        token.access_token,
        "GET",
        undefined,
        transport,
      ),
    );
    // The exchange user_id is not a canonical account binding. Resolve both tokens
    // through the same authenticated /me field before comparing their identities.
    const authorizedIdentity = profile.parse(
      await instagramApi(
        "me?fields=user_id,username,account_type",
        shortToken.access_token,
        "GET",
        undefined,
        transport,
      ),
    );
    if (identity.user_id !== authorizedIdentity.user_id)
      throw new InstagramOAuthError(stage, "identity_mismatch");
    if (!shortToken.permissions) {
      stage = "permissions";
      const grants = z
        .object({
          data: z
            .array(z.object({ permission: z.string().max(100), status: z.string().max(40) }))
            .max(30),
        })
        .parse(
          await instagramApi("me/permissions", token.access_token, "GET", undefined, transport),
        );
      if (
        !INSTAGRAM_OAUTH_SCOPES.every((scope) =>
          grants.data.some((grant) => grant.permission === scope && grant.status === "granted"),
        )
      )
        throw new InstagramOAuthError(stage, "permissions_missing");
    }
    return {
      token: token.access_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      instagramId: identity.user_id,
      username: identity.username,
      verifiedScopes: [...INSTAGRAM_OAUTH_SCOPES],
    };
  } catch (error) {
    if (error instanceof InstagramOAuthError) throw error;
    if (error instanceof InstagramApiError)
      throw new InstagramOAuthError(stage, "provider_rejected", error.status);
    throw new InstagramOAuthError(
      stage,
      error instanceof z.ZodError ? "response_invalid" : "transport_failed",
    );
  }
}
