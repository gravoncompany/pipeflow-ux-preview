import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  instagramAuthorizationUrl,
  INSTAGRAM_OAUTH_CALLBACK,
  INSTAGRAM_OAUTH_SCOPES,
  instagramOAuthQuery,
} from "./instagram-oauth";
import { exchangeInstagramCode } from "./instagram-oauth-api.server";
import { instagramOAuthPermissions, parseInstagramOAuthResponse } from "./instagram-oauth-response";
import { InstagramOAuthError, instagramOAuthDiagnostic } from "./instagram-oauth-diagnostics";
import {
  encryptInstagramToken,
  decryptInstagramToken,
  oauthNonce,
  oauthHash,
} from "./instagram-oauth-crypto.server";

test("Business Login requests the two required scopes and exact canonical callback", () => {
  const url = new URL(instagramAuthorizationUrl("123", "state-test"));
  assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://crm.gravoncompany.com/api/public/instagram/oauth/callback",
  );
  assert.deepEqual(url.searchParams.get("scope")?.split(","), [
    "instagram_business_basic",
    "instagram_business_manage_messages",
  ]);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.throws(() => instagramAuthorizationUrl("invalid", "test"));
});
test("OAuth state requires a strong bounded nonce and rejects malformed callbacks", async () => {
  const nonce = oauthNonce();
  assert.equal(nonce.length, 64);
  assert.notEqual(nonce, oauthNonce());
  assert.equal((await oauthHash(nonce)).length, 64);
  assert.equal(instagramOAuthQuery.safeParse({ state: nonce, code: "code" }).success, true);
  assert.equal(instagramOAuthQuery.safeParse({ state: "guess", code: "code" }).success, false);
  assert.equal(
    instagramOAuthQuery.safeParse({ state: nonce, code: "x".repeat(2049) }).success,
    false,
  );
});
test("stored token is encrypted and cannot be decrypted across companies or with another key", async () => {
  const key = "test-only-key".repeat(8);
  const context = "test:a:111";
  const ciphertext = await encryptInstagramToken("test-only-private-token", key, context);
  assert.equal(ciphertext.includes("test-only-private-token"), false);
  assert.equal(await decryptInstagramToken(ciphertext, key, context), "test-only-private-token");
  await assert.rejects(decryptInstagramToken(ciphertext, key, "test:b:111"));
  await assert.rejects(decryptInstagramToken(ciphertext, "wrong-key".repeat(10), context));
});
function metaTransport(
  options: {
    permissions?: string[];
    identity?: string;
    authorizedIdentity?: string;
    accountType?: string;
    redirect?: boolean;
    omitPermissions?: boolean;
    wrapped?: boolean;
    numericIdentity?: boolean;
    multiple?: boolean;
    exactLargeIdentity?: boolean;
    stringPermissions?: boolean;
  } = {},
) {
  let calls = 0;
  const transport = (async (url, init) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    if (options.redirect)
      return new Response(null, {
        status: 302,
        headers: { Location: "https://untrusted.invalid" },
      });
    if (calls === 1) {
      assert.equal(String(url), "https://api.instagram.com/oauth/access_token");
      assert.equal(init?.method, "POST");
      assert.equal(
        new Headers(init?.headers).get("Content-Type"),
        "application/x-www-form-urlencoded",
      );
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("client_id"), "123");
      assert.ok(body.get("client_secret"));
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("redirect_uri"), INSTAGRAM_OAUTH_CALLBACK);
      assert.equal(body.get("code"), "test-code");
      const payload = {
        access_token: "test-short",
        user_id: options.numericIdentity ? 111 : "111",
        ...(options.omitPermissions
          ? {}
          : {
              permissions: options.stringPermissions
                ? INSTAGRAM_OAUTH_SCOPES.join(",")
                : (options.permissions ?? [...INSTAGRAM_OAUTH_SCOPES]),
            }),
      };
      if (options.exactLargeIdentity)
        return new Response(
          '{"data":[{"access_token":"test-short","user_id":9007199254740993,"permissions":["instagram_business_basic","instagram_business_manage_messages"]}]}',
        );
      return Response.json(
        options.wrapped ? { data: options.multiple ? [payload, payload] : [payload] } : payload,
      );
    }
    if (calls === 2) {
      assert.equal(new URL(String(url)).origin, "https://graph.instagram.com");
      return Response.json({
        access_token: "test-long",
        token_type: "bearer",
        expires_in: 5184000,
      });
    }
    if (calls === 5) {
      assert.equal(String(url), "https://graph.instagram.com/v25.0/me/permissions");
      return Response.json({
        data: (options.permissions ?? [...INSTAGRAM_OAUTH_SCOPES]).map((permission) => ({
          permission,
          status: "granted",
        })),
      });
    }
    assert.equal(
      String(url),
      "https://graph.instagram.com/v25.0/me?fields=user_id,username,account_type",
    );
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      calls === 4 ? "Bearer test-short" : "Bearer test-long",
    );
    return Response.json({
      user_id: options.exactLargeIdentity
        ? "9007199254740993"
        : options.numericIdentity
          ? 111
          : calls === 4
            ? (options.authorizedIdentity ?? "111")
            : (options.identity ?? "111"),
      username: "test-account",
      account_type: options.accountType ?? "BUSINESS",
    });
  }) as typeof fetch;
  return { transport, count: () => calls };
}
test("code and long-lived token exchanges validate professional identity without sending messages", async () => {
  const meta = metaTransport();
  const result = await exchangeInstagramCode("123", "test-secret", "test-code", meta.transport);
  assert.equal(meta.count(), 4);
  assert.equal(result.token, "test-long");
  assert.equal(result.instagramId, "111");
  assert.ok(Date.parse(result.expiresAt) > Date.now());
});
test("missing manage_messages permission prevents token storage and further calls", async () => {
  const meta = metaTransport({ permissions: ["instagram_business_basic"] });
  await assert.rejects(
    exchangeInstagramCode("123", "test", "test-code", meta.transport),
    /instagram_oauth_permissions_missing/,
  );
  assert.equal(meta.count(), 1);
});
test("standard code response without permissions uses the official granted-permissions read", async () => {
  const meta = metaTransport({ omitPermissions: true });
  assert.equal(
    (await exchangeInstagramCode("123", "test", "test-code", meta.transport)).instagramId,
    "111",
  );
  assert.equal(meta.count(), 5);
  const declined = metaTransport({
    omitPermissions: true,
    permissions: ["instagram_business_basic"],
  });
  await assert.rejects(
    exchangeInstagramCode("123", "test", "test-code", declined.transport),
    /instagram_oauth_permissions_missing/,
  );
});
test("another account cannot replace the authorized identity", async () => {
  const meta = metaTransport({ identity: "222" });
  await assert.rejects(
    exchangeInstagramCode("123", "test", "test-code", meta.transport),
    /instagram_oauth_identity_mismatch/,
  );
});
test("exchange user ID is not confused with app ID or canonical professional account ID", async () => {
  const meta = metaTransport({ identity: "222", authorizedIdentity: "222" });
  const result = await exchangeInstagramCode("123", "test", "test-code", meta.transport);
  assert.equal(result.instagramId, "222");
  assert.equal(meta.count(), 4);
});
test("personal accounts are refused", async () => {
  const meta = metaTransport({ accountType: "PERSONAL" });
  await assert.rejects(
    exchangeInstagramCode("123", "test", "test-code", meta.transport),
    (error) =>
      error instanceof InstagramOAuthError &&
      error.stage === "identity" &&
      error.reason === "response_invalid",
  );
});
test("wrapped code exchange and exact safe numeric identities are accepted without rebinding another account", async () => {
  const meta = metaTransport({ wrapped: true, numericIdentity: true });
  const result = await exchangeInstagramCode("123", "test", "test-code", meta.transport);
  assert.equal(result.instagramId, "111");
  assert.equal(meta.count(), 4);
});
test("ambiguous token envelopes are refused before any long-token request", async () => {
  const meta = metaTransport({ wrapped: true, multiple: true });
  await assert.rejects(
    exchangeInstagramCode("123", "test", "test-code", meta.transport),
    (error) =>
      error instanceof InstagramOAuthError &&
      error.stage === "code_exchange" &&
      error.reason === "response_invalid",
  );
  assert.equal(meta.count(), 1);
});
test("exact large JSON numeric identity survives exchange without rounding", async () => {
  const meta = metaTransport({ exactLargeIdentity: true });
  const result = await exchangeInstagramCode("123", "test", "test-code", meta.transport);
  assert.equal(result.instagramId, "9007199254740993");
  assert.equal(meta.count(), 4);
});
test("comma-delimited permissions retain both mandatory scopes", async () => {
  const meta = metaTransport({ stringPermissions: true });
  assert.equal(
    (await exchangeInstagramCode("123", "test", "test-code", meta.transport)).instagramId,
    "111",
  );
  assert.deepEqual(instagramOAuthPermissions.parse(INSTAGRAM_OAUTH_SCOPES.join(",")), [
    ...INSTAGRAM_OAUTH_SCOPES,
  ]);
  assert.equal(
    instagramOAuthPermissions.safeParse(
      "instagram_business_basic,,instagram_business_manage_messages",
    ).success,
    false,
  );
});
test("lossless reader rejects duplicate keys and never converts tokens into numbers", () => {
  assert.throws(() => parseInstagramOAuthResponse('{"user_id":111,"user_id":222}'));
  assert.deepEqual(
    parseInstagramOAuthResponse(
      '{"user_id":9007199254740993,"access_token":"9007199254740993","expires_in":5184000}',
    ),
    {
      user_id: "9007199254740993",
      access_token: "9007199254740993",
      expires_in: 5184000,
    },
  );
});
test("non-decimal numeric identities never silently round into an account binding", async () => {
  const transport = (async () =>
    new Response('{"access_token":"test","user_id":9.007199254740993e15}')) as typeof fetch;
  await assert.rejects(
    exchangeInstagramCode("123", "test", "test-code", transport),
    (error) => error instanceof InstagramOAuthError && error.reason === "response_invalid",
  );
});
test("provider client errors expose only fixed diagnostic enums, stage and HTTP status", async () => {
  const transport = (async () =>
    Response.json(
      {
        error_type: "OAuthException",
        error_message: "Invalid client secret; untrusted-sensitive-value",
      },
      { status: 400 },
    )) as typeof fetch;
  await assert.rejects(exchangeInstagramCode("123", "test", "test-code", transport), (error) => {
    assert.deepEqual(instagramOAuthDiagnostic(error), {
      stage: "code_exchange",
      code: "invalid_client",
      httpStatus: 400,
    });
    assert.equal(
      error instanceof Error && error.message.includes("untrusted-sensitive-value"),
      false,
    );
    return true;
  });
});
test("redirect URL and consumed authorization code errors remain distinct without exposing provider prose", async () => {
  for (const [message, reason] of [
    ["Invalid redirect_uri", "redirect_uri_mismatch"],
    ["Authorization code has been used", "invalid_authorization_code"],
  ]) {
    const transport = (async () =>
      Response.json(
        { error_type: "OAuthException", error_message: message },
        { status: 400 },
      )) as typeof fetch;
    await assert.rejects(
      exchangeInstagramCode("123", "test", "test-code", transport),
      (error) =>
        error instanceof InstagramOAuthError &&
        error.reason === reason &&
        error.stage === "code_exchange",
    );
  }
});
test("redirects never forward OAuth credentials or retry", async () => {
  const meta = metaTransport({ redirect: true });
  await assert.rejects(exchangeInstagramCode("123", "test", "test-code", meta.transport));
  assert.equal(meta.count(), 1);
});
test("private OAuth persistence preserves the original account, denies foreign/replayed/expired bindings and ingests new-account directs", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE FUNCTION public.commercial_knowledge_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='00000000-0000-4000-8000-000000000099'::uuid AND $2='test:a' $$;",
    );
    for (const file of [
      "0036_instagram_directs_private.sql",
      "0054_instagram_business_oauth_private.sql",
      "0055_instagram_oauth_app_binding.sql",
      "0057_instagram_oauth_preserved_candidates.sql",
    ])
      await db.exec(
        await readFile(new URL(`../../drizzle/migrations/${file}`, import.meta.url), "utf8"),
      );
    await db.exec(
      "INSERT INTO public.instagram_accounts(company_key,instagram_id,username,token_secret_name,app_secret_name,updated_by) VALUES('test:a','111','original','INSTAGRAM_ACCESS_TOKEN','INSTAGRAM_APP_SECRET','00000000-0000-4000-8000-000000000099');",
    );
    const actor = "00000000-0000-4000-8000-000000000099";
    async function flow(state: string, id: string, expires = "now()+interval '10 minutes'") {
      await db.exec(
        `INSERT INTO public.instagram_oauth_flows(state_hash,binding_hash,author_id,company_key,expires_at,status,instagram_id,username,encrypted_token,token_expires_at) VALUES('${state}','binding','${actor}','test:a',${expires},'ready','${id}','oauth-name','encrypted-test',now()+interval '60 days');`,
      );
    }
    async function finish(state: string, author = actor, company = "test:a", binding = "binding") {
      return db.query<{ result: { preserved: boolean; accountId: string } }>(
        "SELECT public.complete_instagram_oauth($1,$2,$3,$4) AS result",
        [state, binding, author, company],
      );
    }
    await flow("original", "111");
    await db.exec(
      "UPDATE public.instagram_oauth_flows SET app_id='1083977604418008',verified_scopes=ARRAY['instagram_business_basic','instagram_business_manage_messages'] WHERE state_hash='original';",
    );
    const original = await finish("original");
    assert.equal(original.rows[0]?.result.preserved, true);
    assert.equal(
      (
        await db.query<{ username: string }>(
          "SELECT username FROM public.instagram_accounts WHERE instagram_id='111'",
        )
      ).rows[0]?.username,
      "original",
    );
    assert.equal(
      (await db.query("SELECT * FROM public.instagram_oauth_credentials")).rows.length,
      0,
    );
    const candidates = await db.query<{
      app_id: string;
      instagram_id: string;
      encrypted_token: string;
    }>("SELECT app_id,instagram_id,encrypted_token FROM public.instagram_oauth_candidates");
    assert.deepEqual(candidates.rows, [
      { app_id: "1083977604418008", instagram_id: "111", encrypted_token: "encrypted-test" },
    ]);
    assert.equal(
      (
        await db.query<{ exposed: boolean }>(
          "SELECT has_table_privilege('anon','public.instagram_oauth_candidates','SELECT') OR has_table_privilege('authenticated','public.instagram_oauth_candidates','SELECT') AS exposed",
        )
      ).rows[0]?.exposed,
      false,
    );
    await finish("original");
    assert.equal(
      (await db.query("SELECT account_id FROM public.instagram_oauth_candidates")).rows.length,
      1,
    );
    await flow("unverified", "111");
    await db.exec(
      "UPDATE public.instagram_oauth_flows SET app_id='different',verified_scopes=ARRAY['instagram_business_basic'] WHERE state_hash='unverified';",
    );
    await finish("unverified");
    assert.equal(
      (await db.query<{ app_id: string }>("SELECT app_id FROM public.instagram_oauth_candidates"))
        .rows[0]?.app_id,
      "1083977604418008",
    );
    await flow("new", "222");
    await assert.rejects(finish("new", actor, "test:b"));
    await assert.rejects(finish("new", actor, "test:a", "wrong"));
    await assert.rejects(finish("new", "00000000-0000-4000-8000-000000000098"));
    const added = await finish("new");
    assert.equal(added.rows[0]?.result.preserved, false);
    const accountId = added.rows[0]?.result.accountId;
    assert.ok(accountId);
    await finish("new");
    assert.equal(
      (await db.query("SELECT * FROM public.instagram_oauth_credentials")).rows.length,
      1,
    );
    const receipt = await db.query<{ result: { contact_id: string; greet: boolean } }>(
      "SELECT public.ingest_instagram_message($1,'333','oauth-mid','test direct','text',now(),true,now()) AS result",
      [accountId],
    );
    assert.ok(receipt.rows[0]?.result.contact_id);
    assert.equal(receipt.rows[0]?.result.greet, false);
    await flow("expired", "444", "now()-interval '1 minute'");
    await assert.rejects(finish("expired"));
    await db.exec(
      "UPDATE public.instagram_oauth_flows SET status='exchanging' WHERE state_hash='expired'",
    );
    await assert.rejects(finish("expired"));
    const privileges = await db.query<{ exposed: boolean }>(
      "SELECT has_table_privilege('anon','public.instagram_oauth_credentials','SELECT') OR has_table_privilege('authenticated','public.instagram_oauth_flows','SELECT') OR has_function_privilege('authenticated','public.complete_instagram_oauth(text,text,uuid,text)','EXECUTE') AS exposed",
    );
    assert.equal(privileges.rows[0]?.exposed, false);
    assert.equal(
      (
        await db.query<{ encrypted_token: string | null }>(
          "SELECT encrypted_token FROM public.instagram_oauth_flows WHERE state_hash='new'",
        )
      ).rows[0]?.encrypted_token,
      null,
    );
  } finally {
    await db.close();
  }
});
