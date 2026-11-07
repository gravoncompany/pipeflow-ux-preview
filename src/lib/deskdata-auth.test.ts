import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DeskDataAuthError,
  deskDataCredentialMode,
  deskDataTokenExpiresAt,
  getDeskDataToken,
  resetDeskDataToken,
} from "./deskdata-auth.server";

const okAuth = (token: string, expiresAt?: string) => ({
  status: { code: 2000, message: "Success", details: "" },
  data: { access_token: token, ...(expiresAt ? { expires_at: expiresAt } : {}) },
});
const future = new Date(Date.now() + 24 * 3600_000).toISOString();
const soon = new Date(Date.now() + 5 * 60_000).toISOString();
const env = () => ({
  DESKDATA_USERNAME: "user@example.com",
  DESKDATA_PASSWORD: "secret-password",
});
const okFetch = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
const TOKEN_A = "token-a-0123456789abcdef";
const TOKEN_B = "token-b-0123456789abcdef";
const TOKEN_X = "token-x-0123456789abcdef";

test("requests POST /auth with username, password and requested expiry", async () => {
  resetDeskDataToken();
  let requestedUrl = "";
  let init: RequestInit | undefined;
  const fetcher = (async (url: string, i: RequestInit) => {
    requestedUrl = String(url);
    init = i;
    return new Response(JSON.stringify(okAuth(TOKEN_A, future)), { status: 200 });
  }) as unknown as typeof fetch;
  await getDeskDataToken(env(), fetcher);
  assert.equal(requestedUrl, "https://api.deskdata.com.br/auth");
  assert.equal(init!.method, "POST");
  const body = JSON.parse(String(init!.body));
  assert.equal(body.username, "user@example.com");
  assert.equal(body.password, "secret-password");
  assert.ok(body.expires_in >= 1);
  assert.ok(!(init!.headers as Record<string, unknown>)["Authorization"]);
  resetDeskDataToken();
});

test("caches the token and reuses it without new requests", async () => {
  resetDeskDataToken();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response(JSON.stringify(okAuth(TOKEN_A, future)), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await getDeskDataToken(env(), fetcher), TOKEN_A);
  assert.equal(await getDeskDataToken(env(), fetcher), TOKEN_A);
  assert.equal(calls, 1);
  resetDeskDataToken();
});

test("renews the token when the cached one is close to expiry", async () => {
  resetDeskDataToken();
  const tokens = [TOKEN_A, TOKEN_B];
  const fetcher = (async () =>
    new Response(
      JSON.stringify(okAuth(tokens[calls] ?? TOKEN_B, calls === 0 ? soon : future)),
      { status: 200 },
    )) as unknown as typeof fetch;
  let calls = 0;
  const counting = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify(okAuth(tokens[calls - 1] ?? TOKEN_B, calls === 1 ? soon : future)),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  assert.equal(await getDeskDataToken(env(), counting), TOKEN_A);
  assert.equal(await getDeskDataToken(env(), counting), TOKEN_B);
  assert.equal(calls, 2);
  resetDeskDataToken();
});

test("falls back to a short conservative lifetime when expires_at is unreadable", async () => {
  resetDeskDataToken();
  await getDeskDataToken(env(), okFetch(okAuth(TOKEN_A)));
  const expiresAt = deskDataTokenExpiresAt();
  assert.ok(expiresAt !== null);
  assert.ok(expiresAt - Date.now() < 60 * 60_000);
  resetDeskDataToken();
});

test("fails closed on rejected credentials without exposing them", async () => {
  resetDeskDataToken();
  const fetcher = okFetch({ status: { code: 2001, message: "erro" } }, 401);
  await assert.rejects(
    getDeskDataToken(env(), fetcher),
    (e: unknown) => e instanceof DeskDataAuthError && e.code === "http_401",
  );
  resetDeskDataToken();
});

test("fails closed when the API answers 200 without a token", async () => {
  resetDeskDataToken();
  const error = await getDeskDataToken(env(), okFetch({ status: { code: 4001 } })).catch(
    (e: unknown) => e,
  );
  assert.ok(error instanceof DeskDataAuthError);
  assert.equal(error.code, "auth_rejected");
  assert.ok(!error.message.includes("secret-password"));
  resetDeskDataToken();
});

test("rejects redirects and transport failures without retrying", async () => {
  resetDeskDataToken();
  const redirect = (async () =>
    new Response(null, { status: 302, headers: { Location: "https://other" } })) as unknown as
    typeof fetch;
  await assert.rejects(
    getDeskDataToken(env(), redirect),
    (e: unknown) => e instanceof DeskDataAuthError && e.code === "redirect_rejected",
  );
  const failing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  await assert.rejects(
    getDeskDataToken(env(), failing),
    (e: unknown) => e instanceof DeskDataAuthError && e.code === "transport",
  );
  assert.equal(deskDataTokenExpiresAt(), null);
  resetDeskDataToken();
});

test("uses the static legacy token when present, without authenticating", async () => {
  resetDeskDataToken();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response(JSON.stringify(okAuth(TOKEN_X, future)), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(
    await getDeskDataToken({ B2B_DESKDATA_TOKEN: "legacy-token" }, fetcher),
    "legacy-token",
  );
  assert.equal(calls, 0);
  resetDeskDataToken();
});

test("reports the credential mode for each configuration", () => {
  assert.equal(deskDataCredentialMode({ B2B_DESKDATA_TOKEN: "t" }), "static_token");
  assert.equal(deskDataCredentialMode(env()), "username_password");
  assert.equal(deskDataCredentialMode({}), "none");
});
