import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicCompanyLookup, parsePublicCompany, publicRetryAfterSeconds } from "./b2b-public.server";
import { B2bProviderError } from "./b2b-providers.server";
import { b2bLookupResult } from "./b2b-lookup-result";

const cnpj = "50621449000145";
const fixture = { cnpj, razao_social: "Empresa fictícia", email: "contato@example.test", ddd_telefone_1: "4130000001" };

test("429 comes from BrasilAPI response, pauses requests and never calls paid providers", async () => {
  let time = 1793562960000, calls = 0;
  const logs: Record<string, string | number>[] = [];
  const lookup = createPublicCompanyLookup({ now: () => time, log: e => logs.push(e), transport: (async (url, init) => {
    calls++;
    assert.equal(url, `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    assert.equal(init?.redirect, "manual");
    return calls === 1 ? new Response("private provider body", { status: 429, headers: { "Retry-After": "120" } }) : Response.json(fixture);
  }) as typeof fetch });
  await assert.rejects(lookup(cnpj), e => e instanceof B2bProviderError && e.code === "public_http_429");
  await assert.rejects(lookup("11222333000181"), /429/);
  assert.equal(calls, 1);
  assert.deepEqual(logs, [{ provider: "brasilapi", outcome: "rate_limited", httpStatus: 429, retryAfterSeconds: 120 }]);
  time += 120000;
  assert.equal((await lookup(cnpj)).legalName, "Empresa fictícia");
  assert.equal(calls, 2); // Only explicit later call retries.
});

test("simultaneous requests for the same CNPJ share one public request", async () => {
  let calls = 0;
  const lookup = createPublicCompanyLookup({ transport: (async () => { calls++; return Response.json(fixture); }) as typeof fetch });
  const [a, b] = await Promise.all([lookup(cnpj), lookup("50.621.449/0001-45")]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
});

test("429 handled result cannot replace existing company data", async () => {
  const current = parsePublicCompany(fixture, cnpj);
  const before = JSON.stringify(current);
  const lookup = createPublicCompanyLookup({ log: () => {}, transport: (async () => new Response("untrusted", { status: 429 })) as typeof fetch });
  const result = await b2bLookupResult(() => lookup(cnpj), e => e instanceof B2bProviderError ? { code: e.code, message: e.message } : null);
  assert.equal(result.ok, false);
  assert.equal("company" in result, false);
  assert.equal(JSON.stringify(current), before);
  assert.deepEqual(current.emails, ["contato@example.test"]);
  assert.deepEqual(current.phones, ["554130000001"]);
});

test("Retry-After accepts seconds and date with bounded fallback", () => {
  const now = Date.parse("2026-11-01T20:00:00Z");
  assert.equal(publicRetryAfterSeconds("120", now), 120);
  assert.equal(publicRetryAfterSeconds("Sun, 01 Nov 2026 20:02:00 GMT", now), 120);
  assert.equal(publicRetryAfterSeconds(null, now), 60);
  assert.equal(publicRetryAfterSeconds("private prose", now), 60);
  assert.equal(publicRetryAfterSeconds("999999999", now), 86400);
});