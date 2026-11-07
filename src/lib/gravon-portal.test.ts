import { it } from "node:test";
import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { fetchWithoutRedirects, UpstreamRedirectError } from "./no-redirect-fetch.server";
import { PortalIdentityError, safePortalIdentityDiagnostic } from "./portal-identity-diagnostics";
import { portalInput, PORTAL_ENDPOINT, PORTAL_PATH } from "./gravon-portal";
import {
  signPortalRequest,
  queryPortal,
  boundedJson,
  createPortalTools,
} from "./gravon-portal.server";
import {
  portalSubject,
  canonicalPortalNumber,
  verifyProviderRecord,
  portalMessageQuery,
  evolutionConnectionDiagnostic,
} from "./gravon-portal-identity.server";

it("model arguments exclude identity, roles, secrets, URL and unknown operations", () => {
  for (const key of ["subject", "phone", "email", "role", "token", "url"])
    assert.equal(
      portalInput.safeParse({ operation: "projects", [key]: "arbitrary" }).success,
      false,
    );
  assert.equal(portalInput.safeParse({ operation: "write" }).success, false);
  assert.equal(portalInput.safeParse({ operation: "social_media" }).success, false);
  assert.deepEqual(portalInput.parse({ operation: "projects", search: "  Acme  " }), {
    operation: "projects",
    search: "Acme",
    limit: 20,
    offset: 0,
  });
});
it("pagination enforces limit 1..50 and offset 0..1000", () => {
  for (const limit of [0, 51, 1.5])
    assert.equal(portalInput.safeParse({ operation: "projects", limit }).success, false);
  for (const offset of [-1, 1001, 0.5])
    assert.equal(portalInput.safeParse({ operation: "projects", offset }).success, false);
  assert.equal(portalInput.parse({ operation: "projects", limit: 50, offset: 1000 }).offset, 1000);
});
it("search is trimmed 1..100 and project id must be UUID", () => {
  for (const search of [" ", "x".repeat(101)])
    assert.equal(portalInput.safeParse({ operation: "projects", search }).success, false);
  assert.equal(
    portalInput.safeParse({ operation: "project", project_id: "not-uuid" }).success,
    false,
  );
});
it("dates are real, periods strict and range difference at most 366 days", () => {
  const valid = (period: unknown) =>
    portalInput.safeParse({ operation: "dashboard", period }).success;
  assert.equal(valid({ mode: "month", month: "2026-09" }), true);
  assert.equal(valid({ mode: "month", month: "2026-13" }), false);
  assert.equal(valid({ mode: "portal_30_days", start: "2026-09-15" }), true);
  assert.equal(valid({ mode: "portal_30_days", start: "2026-02-30" }), false);
  assert.equal(valid({ mode: "month", month: "2026-09", subject: "fake" }), false);
  assert.equal(valid({ mode: "range", start: "2026-09-30", end: "2026-09-01" }), false);
  assert.equal(valid({ mode: "range", start: "2026-01-01", end: "2027-01-02" }), true);
  assert.equal(valid({ mode: "range", start: "2026-01-01", end: "2027-01-03" }), false);
});
it("signature uses UTF-8 literal key and exact JSON LF path message", async () => {
  const args = portalInput.parse({ operation: "dashboard", search: "Empresa ç" });
  const timestamp = "1792973820000";
  const id = "00000000-0000-4000-8000-000000000001";
  const signed = await signPortalRequest(
    args,
    "crm:fictitious",
    "test-only",
    "utf8-fictícia",
    timestamp,
    id,
  );
  const expected = createHmac("sha256", "utf8-fictícia")
    .update(`${timestamp}\n${id}\nPOST\n${PORTAL_PATH}\n${signed.body}`)
    .digest("hex");
  assert.equal(signed.headers["X-Gravon-Signature"], expected);
  assert.equal(JSON.parse(signed.body).subject, "crm:fictitious");
  assert.equal(signed.body.endsWith("\n"), false);
});
it("subject includes channel and canonical full sender; ninth digit only equivalent", async () => {
  const one = await portalSubject("fake-instance", "5511998765432@s.whatsapp.net");
  assert.equal(one, await portalSubject("fake-instance", "551198765432@s.whatsapp.net"));
  assert.notEqual(one, await portalSubject("another-instance", "551198765432@s.whatsapp.net"));
  assert.notEqual(one, await portalSubject("fake-instance", "552198765432@s.whatsapp.net"));
  assert.equal(canonicalPortalNumber("5511998765432@s.whatsapp.net"), "551198765432");
  assert.ok(one.length <= 160);
});
it("provider corroboration requires exact message/JID and strict self direction", () => {
  const ref = {
    instance: "fake",
    inboundId: "message-one",
    remoteJid: "551198765432@s.whatsapp.net",
  };
  const row = {
    key: { id: ref.inboundId, remoteJid: ref.remoteJid, fromMe: true },
    messageTimestamp: 1792973820,
  };
  assert.equal(
    verifyProviderRecord({ messages: { records: [row] } }, ref),
    "2026-10-26T00:17:00.000Z",
  );
  for (const key of [
    { ...row.key, fromMe: false },
    { ...row.key, id: "other" },
    { ...row.key, remoteJid: "552198765432@s.whatsapp.net" },
  ])
    assert.throws(() => verifyProviderRecord({ messages: { records: [{ ...row, key }] } }, ref));
  assert.throws(() => verifyProviderRecord({ messages: { records: [row, row] } }, ref));
});
it("Evolution lookup uses the exact provider message ID without excluding LID records", () => {
  assert.deepEqual(portalMessageQuery({ instance: "fake", inboundId: "message-one", remoteJid: "551198765432@s.whatsapp.net" }), {
    where: { key: { id: "message-one" } }, page: 1, offset: 20,
  });
});
it("LID corroboration requires exact authenticated phone alias and self direction", () => {
  const ref = { instance: "fake", inboundId: "message-one", remoteJid: "551198765432@s.whatsapp.net" };
  const key = { id: "message-one", remoteJid: "194356178874479@lid", remoteJidAlt: ref.remoteJid, addressingMode: "lid", fromMe: true };
  const check = (override: Record<string, unknown>) => verifyProviderRecord({ messages: { records: [{ key: { ...key, ...override }, messageTimestamp: 1792973820 }] } }, ref);
  assert.equal(check({}), "2026-10-26T00:17:00.000Z");
  for (const override of [{ id: "other" }, { fromMe: false }, { addressingMode: "pn" }, { remoteJid: "552198765432@s.whatsapp.net" }, { remoteJidAlt: undefined }, { remoteJidAlt: "552198765432@s.whatsapp.net" }]) {
    assert.throws(() => check(override));
  }
  const row = { key, messageTimestamp: 1792973820 };
  assert.throws(() => verifyProviderRecord({ messages: { records: [row, row] } }, ref));
});
it("diagnostics distinguish missing message and mismatched LID without releasing identity", () => {
  const ref = { instance: "fake", inboundId: "message-one", remoteJid: "551198765432@s.whatsapp.net" };
  try { verifyProviderRecord({ messages: { records: [] } }, ref); assert.fail("Must reject missing message"); }
  catch (error) {
    assert.ok(error instanceof PortalIdentityError);
    const diagnostic = safePortalIdentityDiagnostic(error);
    assert.equal(diagnostic.code, "message_not_found");
    assert.equal(diagnostic.messageId, "message-one");
    assert.equal(diagnostic.records, 0);
  }
  try { verifyProviderRecord({ messages: { records: [{ key: { id: "message-one", remoteJid: "194356178874479@lid", fromMe: true, addressingMode: "lid" }, messageTimestamp: 1792973820 }] } }, ref); assert.fail("Must reject missing alias"); }
  catch (error) {
    const diagnostic = safePortalIdentityDiagnostic(error);
    assert.equal(diagnostic.code, "phone_identity_mismatch");
    assert.equal(diagnostic.checks?.alternativePhonePresent, false);
  }
  const safe = safePortalIdentityDiagnostic(new Error("private credential must not escape"));
  assert.equal(safe.code, "verification_unavailable");
  assert.equal(JSON.stringify(safe).includes("private credential"), false);
});
it("Evolution timeout is confirmed by timeout name or aborted deadline, never assumed from a network error", () => {
  const timedOut = evolutionConnectionDiagnostic(new DOMException("private details", "TimeoutError"), false, 10001);
  assert.equal(timedOut.code, "evolution_timeout");
  assert.equal(timedOut.checks.timeoutConfirmed, true);
  assert.equal(evolutionConnectionDiagnostic(new Error("private"), true, 10002).code, "evolution_timeout");
  const network = evolutionConnectionDiagnostic(new TypeError("private credential and network response"), false, 40);
  assert.equal(network.code, "evolution_connection_failed");
  assert.equal(network.checks.timeoutConfirmed, false);
  assert.equal(network.checks.configuredOrigin, "https://api.gravoncompany.online");
  assert.equal(network.checks.redirectsAllowed, false);
  assert.equal(network.checks.timeoutSeconds, "10");
  assert.equal(JSON.stringify(network).includes("private credential"), false);
  assert.equal("subject" in network, false);
});
it("blocked identity performs no HTTP call", async () => {
  let calls = 0;
  await assert.rejects(() =>
    queryPortal(
      { operation: "projects" },
      {
        subject: "fake",
        authorize: async () => {
          throw new Error("denied");
        },
      },
      { serviceToken: "fake", signingSecret: "fake" },
      async () => {
        calls++;
        return Response.json({});
      },
    ),
  );
  assert.equal(calls, 0);
});
it("403 is distinct from 200 not_found; no automatic retry, fixed endpoint", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, PORTAL_ENDPOINT);
    assert.equal(init?.redirect, "manual");
    return Response.json({ error: "unlinked_contact" }, { status: 403 });
  };
  const outcome = await queryPortal(
    { operation: "project" },
    { subject: "fake", authorize: async () => {} },
    { serviceToken: "fake", signingSecret: "fake" },
    transport,
  );
  assert.equal(outcome.status, 403);
  assert.equal(outcome.error, "unlinked_contact");
  assert.equal(calls, 1);
});
it("success preserves null, missing fields, coverage and pagination", async () => {
  const result = {
    version: "1",
    operation: "dashboard",
    result: "ok",
    queried_at: "2026-10-26T00:17:00.000Z",
    content_policy: "untrusted",
    requested_period: { mode: "month", month: "2026-09" },
    project: { id: "fake" },
    data: {
      advertising: null,
      client_reported: { revenue: 0, incomplete_qualification: true },
      records_has_more: true,
    },
    sources: ["traffic_reports"],
    source_updated_at: null,
    missing_fields: ["advertising"],
    limitations: ["partial"],
    effective_coverage: { advertising: [], client_reported: [] },
  };
  const outcome = await queryPortal(
    { operation: "dashboard" },
    { subject: "fake", authorize: async () => {} },
    { serviceToken: "fake", signingSecret: "fake" },
    async () => Response.json(result),
  );
  assert.deepEqual(outcome.result, result);
});
it("redirect responses are rejected without following, reading Location or returning identity", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    await assert.rejects(() => fetchWithoutRedirects("https://example.invalid", {}, async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, "manual");
      return new Response(null, { status, headers: { Location: "https://untrusted.invalid" } });
    }), (error: unknown) => error instanceof UpstreamRedirectError && error.status === status);
    assert.equal(calls, 1);
    const outcome = await queryPortal({ operation: "projects" }, { subject: "fake", authorize: async () => {} },
      { serviceToken: "fake", signingSecret: "fake" }, async () => new Response(null, { status }));
    assert.equal(outcome.error, "integration_unavailable");
    assert.equal(outcome.result, undefined);
  }
});
it("real transport never reaches a redirect destination or forwards credentials to it", async () => {
  let destinationRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === "/target") { destinationRequests++; res.end("should not be reached"); }
    else { res.writeHead(302, { Location: "/target" }); res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    await assert.rejects(() => fetchWithoutRedirects(`http://127.0.0.1:${address.port}/source`, { headers: { apikey: "test-only" } }), UpstreamRedirectError);
    assert.equal(destinationRequests, 0);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
it("429 respects Retry-After and 422 remains incomplete rather than partial success", async () => {
  for (const [status, error] of [
    [429, "rate_limited"],
    [422, "narrow_period_required"],
  ] as const) {
    const outcome = await queryPortal(
      { operation: "dashboard" },
      { subject: "fake", authorize: async () => {} },
      { serviceToken: "fake", signingSecret: "fake" },
      async () => Response.json({ error }, { status, headers: { "Retry-After": "60" } }),
    );
    assert.equal(outcome.error, error);
    assert.equal(outcome.status, status);
    if (status === 429) assert.equal(outcome.retryAfter, 60);
  }
});
it("oversized response is rejected without truncated totals", async () => {
  await assert.rejects(
    () => boundedJson(Response.json({ data: "x".repeat(50000) })),
    /response_too_large/,
  );
});
it("tool resolves only trusted identity and stops after failure", async () => {
  let resolutions = 0;
  const tools = createPortalTools(async () => {
    resolutions++;
    throw new Error("unverified");
  });
  const execute = tools.tools.consultar_portal_gravon.execute;
  assert.ok(execute);
  if (!execute) return;
  const result = await execute(portalInput.parse({ operation: "projects" }), {
    toolCallId: "fake",
    messages: [],
    context: {},
  });
  assert.ok(result);
  await execute(portalInput.parse({ operation: "projects" }), {
    toolCallId: "fake2",
    messages: [],
    context: {},
  });
  assert.equal(resolutions, 1);
  assert.ok(tools.finalFailure());
});

it("projects list requires authorized UUID options and explicit pagination without inventing coverage", async () => {
  const list = { version: "1", operation: "projects", result: "list", queried_at: "2026-10-26T00:17:00.000Z",
    content_policy: "untrusted", requested_period: { mode: "month", month: "2026-10" }, project: null,
    data: [{ id: "00000000-0000-4000-8000-000000000001", company_name: "Test only", status: "ativo" }],
    pagination: { offset: 0, limit: 20, has_more: false }, sources: ["projects"], source_updated_at: null,
    missing_fields: [], limitations: ["Only authorized real projects"] };
  const query = (result: unknown) => queryPortal({ operation: "projects" }, { subject: "test", authorize: async () => {} },
    { serviceToken: "test", signingSecret: "test" }, async () => Response.json(result));
  assert.deepEqual((await query(list)).result, list);
  assert.equal("effective_coverage" in ((await query(list)).result ?? {}), false);
  for (const malformed of [{ ...list, pagination: undefined }, { ...list, data: [{ id: "not-uuid", company_name: "test", status: "ativo" }] }]) {
    const outcome = await query(malformed);
    assert.equal(outcome.error, "integration_unavailable");
    assert.equal(outcome.result, undefined);
  }
});

it("tool rejects injected subject before resolving identity even when execute is called directly", async () => {
  let resolutions = 0;
  const portal = createPortalTools(async () => { resolutions++; throw new Error("must not resolve"); });
  const execute = portal.tools.consultar_portal_gravon.execute;
  assert.ok(execute);
  if (!execute) return;
  const result = await execute({ ...portalInput.parse({ operation: "projects" }), subject: "injected" } as ReturnType<typeof portalInput.parse>,
    { toolCallId: "test", messages: [], context: {} });
  assert.equal((result as { error: string }).error, "invalid_input");
  assert.equal(resolutions, 0);
});

it("missing server credentials is configuration failure, not identity failure", async () => {
  const saved = process.env.GRAVON_IA_SERVICE_TOKEN;
  delete process.env.GRAVON_IA_SERVICE_TOKEN;
  try {
    const portal = createPortalTools(async () => ({ subject: "test", authorize: async () => {} }));
    const execute = portal.tools.consultar_portal_gravon.execute;
    assert.ok(execute);
    if (!execute) return;
    const result = await execute(portalInput.parse({ operation: "projects" }), { toolCallId: "test", messages: [], context: {} });
    assert.equal((result as { error: string }).error, "integration_not_configured");
  } finally {
    if (saved === undefined) delete process.env.GRAVON_IA_SERVICE_TOKEN;
    else process.env.GRAVON_IA_SERVICE_TOKEN = saved;
  }
});
