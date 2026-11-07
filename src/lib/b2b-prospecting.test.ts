import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyInput,
  importInput,
  searchInput,
  validCnpj,
  safeHttps,
  renderEmail,
  type CompanyInput,
} from "./b2b-prospecting";
import {
  searchPlaces,
  parseDeskCompany,
  lookupDeskCompany,
  deskBalance,
  boundedJson,
  deskErrorMessage,
  instagramFromWebsite,
  PLACES_FIELDS,
} from "./b2b-providers.server";

const cnpj = "50621449000145";
export const reviewedCompany: CompanyInput = {
  placeId: "test_place",
  cnpj,
  legalName: "Empresa de teste isolado",
  tradeName: "",
  registrationStatus: "ATIVA",
  segment: "Facilities",
  city: "Curitiba",
  state: "PR",
  address: "Endereço de teste",
  phones: ["554130001234"],
  emails: ["comercial@example.test"],
  website: "https://example.test",
  source: "manual",
  sourceReference: "Fixture sintética de teste",
  identityConfirmed: true,
  storageAuthorized: true,
};
test("CNPJ checksum, canonical format, malformed values and explicit review", () => {
  assert.ok(validCnpj("50.621.449/0001-45"));
  assert.ok(validCnpj("12.ABC.345/01DE-35"));
  for (const invalid of ["50621449000144", "00000000000000", "50621449000145<script>", "123"])
    assert.equal(validCnpj(invalid), false);
  assert.equal(companyInput.parse({ ...reviewedCompany, cnpj: "50.621.449/0001-45" }).cnpj, cnpj);
  assert.equal(
    companyInput.safeParse({ ...reviewedCompany, identityConfirmed: false }).success,
    false,
  );
  assert.equal(
    companyInput.safeParse({ ...reviewedCompany, storageAuthorized: false }).success,
    false,
  );
  assert.equal(companyInput.safeParse({ ...reviewedCompany, source: "google" }).success, false);
  assert.equal(
    importInput.safeParse({
      pipelineId: null,
      companies: [reviewedCompany, reviewedCompany],
      confirmed: true,
    }).success,
    false,
  );
  assert.equal(
    importInput.safeParse({ pipelineId: null, companies: [reviewedCompany], confirmed: false })
      .success,
    false,
  );
});
test("pending Maps company permits empty legal name without inventing official identity", () => {
  const pending = { ...reviewedCompany, cnpj: "", legalName: "", tradeName: "Loja Exemplo" };
  const parsed = companyInput.parse(pending);
  assert.equal(parsed.legalName, "");
  assert.equal(parsed.tradeName, "Loja Exemplo");
  assert.equal(importInput.safeParse({ pipelineId: null, companies: [pending], confirmed: true }).success, true);
  assert.equal(companyInput.safeParse({ ...pending, tradeName: "" }).success, false);
  assert.equal(companyInput.safeParse({ ...pending, placeId: "" }).success, false);
});
test("identified CNPJ still requires its official legal name", () => {
  assert.equal(companyInput.safeParse({ ...reviewedCompany, legalName: "" }).success, false);
});
test("pending Maps company still requires data review and storage authorization", () => {
  const pending = { ...reviewedCompany, cnpj: "", legalName: "", tradeName: "Loja Exemplo" };
  assert.equal(companyInput.safeParse({ ...pending, identityConfirmed: false }).success, false);
  assert.equal(companyInput.safeParse({ ...pending, storageAuthorized: false }).success, false);
});
test("pending CNPJ requires the Google place identifier and stays deduplicated", () => {
  const pending: CompanyInput = { ...reviewedCompany, cnpj: "" };
  assert.equal(companyInput.safeParse(pending).success, true);
  assert.equal(
    importInput.safeParse({ pipelineId: null, companies: [pending], confirmed: true }).success,
    true,
  );
  assert.equal(
    importInput.safeParse({
      pipelineId: null,
      companies: [{ ...pending, placeId: "" }],
      confirmed: true,
    }).success,
    false,
  );
  assert.equal(
    importInput.safeParse({
      pipelineId: null,
      companies: [pending, { ...pending, legalName: "Outra empresa" }],
      confirmed: true,
    }).success,
    false,
  );
  assert.equal(
    importInput.safeParse({
      pipelineId: null,
      companies: [pending, { ...pending, placeId: "other_place" }],
      confirmed: true,
    }).success,
    true,
  );
  assert.equal(
    importInput.safeParse({
      pipelineId: null,
      companies: [pending, { ...reviewedCompany, placeId: "other_place" }],
      confirmed: true,
    }).success,
    true,
  );
});
test("search input and provider links reject unknown fields and unsafe URLs", () => {
  assert.equal(
    searchInput.safeParse({ segment: "facilities", city: "Curitiba", state: "XX" }).success,
    false,
  );
  assert.equal(
    searchInput.safeParse({
      segment: "facilities",
      city: "Curitiba",
      state: "PR",
      apiKey: "browser-secret",
    }).success,
    false,
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "https://user:password@example.test",
    "http://example.test",
  ])
    assert.equal(safeHttps(url), "");
  assert.equal(safeHttps("https://example.test"), "https://example.test/");
});
test("Places uses fixed endpoint, bounded page size, exact query and enterprise field mask", async () => {
  let calls = 0;
  const transport = (async (url, init) => {
    calls++;
    assert.equal(url, "https://places.googleapis.com/v1/places:searchText");
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("X-Goog-FieldMask"), PLACES_FIELDS);
    assert.deepEqual(JSON.parse(init!.body as string), {
      textQuery: "facilities em Curitiba, PR, Brasil",
      languageCode: "pt-BR",
      regionCode: "BR",
      pageSize: 20,
      pageToken: "page-two",
    });
    return Response.json({
      places: [
        {
          id: "place_1",
          displayName: { text: "Teste" },
          websiteUri: "javascript:bad",
          attributions: [{ provider: "Fonte", providerUri: "https://example.test" }],
        },
      ],
      nextPageToken: "page-three",
    });
  }) as typeof fetch;
  const result = await searchPlaces(
    { segment: "facilities", city: "Curitiba", state: "PR" },
    "test-key",
    "page-two",
    transport,
  );
  assert.equal(calls, 1);
  assert.equal(result.places[0].phone, "");
  assert.equal(result.places[0].website, "");
  assert.equal(result.nextPageToken, "page-three");
  assert.equal(result.places[0].attributions[0].name, "Fonte");
  assert.equal(result.places[0].rating, null);
  assert.equal(result.places[0].userRatingCount, null);
  assert.equal(result.places[0].instagram, "");
});
test("Places parses rating, review count and derives Instagram only from the registered website", async () => {
  assert.ok(PLACES_FIELDS.includes("places.rating"));
  assert.ok(PLACES_FIELDS.includes("places.userRatingCount"));
  const transport = (async () =>
    Response.json({
      places: [
        {
          id: "rated_place",
          displayName: { text: "Avaliada" },
          rating: 4.8,
          userRatingCount: 127,
          websiteUri: "https://www.instagram.com/empresa.teste/",
        },
        {
          id: "site_place",
          displayName: { text: "Com site próprio" },
          rating: 0,
          userRatingCount: 0,
          websiteUri: "https://example.test",
        },
      ],
    })) as typeof fetch;
  const result = await searchPlaces(
    { segment: "facilities", city: "Curitiba", state: "PR" },
    "test-key",
    undefined,
    transport,
  );
  assert.equal(result.places[0].rating, 4.8);
  assert.equal(result.places[0].userRatingCount, 127);
  assert.equal(result.places[0].instagram, "https://www.instagram.com/empresa.teste/");
  assert.equal(result.places[1].rating, 0);
  assert.equal(result.places[1].userRatingCount, 0);
  assert.equal(result.places[1].instagram, "");
});
test("Instagram derivation rejects posts, reels, other hosts and unsafe URLs", () => {
  assert.equal(instagramFromWebsite("https://instagram.com/Gravon.Company"), "https://www.instagram.com/gravon.company/");
  assert.equal(instagramFromWebsite("https://www.instagram.com/p/abc123/"), "");
  assert.equal(instagramFromWebsite("https://www.instagram.com/reel/abc/"), "");
  assert.equal(instagramFromWebsite("https://www.instagram.com/"), "");
  assert.equal(instagramFromWebsite("https://example.test/instagram"), "");
  assert.equal(instagramFromWebsite("http://instagram.com/perfil"), "");
  assert.equal(instagramFromWebsite("javascript:alert(1)"), "");
  assert.equal(instagramFromWebsite(""), "");
});
test("provider errors, redirects and malformed data are not retried or exposed", async () => {
  for (const response of [
    new Response("secret provider prose", { status: 403 }),
    new Response(null, { status: 302, headers: { Location: "https://evil.test" } }),
    new Response("not json"),
    Response.json({ places: [{ displayName: { text: "missing id" } }] }),
  ]) {
    let calls = 0;
    await assert.rejects(
      searchPlaces(
        { segment: "x facilities", city: "Curitiba", state: "PR" },
        "secret",
        undefined,
        (async () => {
          calls++;
          return response;
        }) as typeof fetch,
      ),
      (e) => e instanceof Error && !e.message.includes("secret"),
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(boundedJson(new Response("12345"), 4), /excedeu/);
});
test("DeskData projects only documented business fields and refuses mismatched identity", () => {
  const raw = {
    status: { code: 4000 },
    data: {
      basic: {
        name: { legal_name: "Teste", trade_name: "Teste comercial" },
        tax_id: { number: cnpj, status: "ATIVA" },
      },
      emails: {
        items: [
          { type: "PERSONAL", email: "private@example.test" },
          { type: "CORPORATE", email: "SALES@example.test" },
        ],
      },
      phones: {
        items: [
          { type: "MOBILE", number: "private" },
          { type: "WORK", country_code: "55", area_code: "41", number: "30001234" },
        ],
      },
      addresses: {
        items: [
          { type: "HOME", city: "Private" },
          { type: "WORK", city: "Curitiba", state: "PR", street_name: "Teste", number: "1" },
        ],
      },
    },
  };
  const company = parseDeskCompany(raw, cnpj)!;
  assert.deepEqual(company.emails, ["sales@example.test"]);
  assert.deepEqual(company.phones, ["554130001234"]);
  assert.equal(company.city, "Curitiba");
  assert.equal(company.website, "");
  assert.throws(() => parseDeskCompany(raw, "11222333000181"), /CNPJ/);
  assert.throws(() => parseDeskCompany({ status: { code: 4003 }, data: {} }), /créditos/);
  assert.equal(parseDeskCompany({ status: { code: 4000 }, data: {} }), null);
});
test("DeskData request binds confirmed CNPJ and contracted datasets; balance is provider reported", async () => {
  const transport = (async (url, init) => {
    assert.equal(url, "https://api.deskdata.com.br/queries");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test");
    assert.equal(init?.redirect, "manual");
    assert.deepEqual(JSON.parse(init!.body as string), {
      type: "companies",
      key_type: "cnpj",
      key_value: cnpj,
      datasets: ["basic", "emails"],
    });
    return Response.json({ status: { code: 4000 }, data: { basic: { tax_id: { number: cnpj } } } });
  }) as typeof fetch;
  await lookupDeskCompany("cnpj", cnpj, "test", ["basic", "emails"], transport);
  assert.equal(
    await deskBalance("test", (async () =>
      Response.json({ status: { code: 3000 }, data: { balance: 200 } })) as typeof fetch),
    200,
  );
  await assert.rejects(
    deskBalance("test", (async () =>
      Response.json({ status: { code: 3000 }, data: {} })) as typeof fetch),
  );
});
test("email template preserves user content as literal text", () => {
  assert.equal(
    renderEmail("Olá {{empresa}}, {{segmento}} — {{remetente}}", "Empresa $&", "Facilities", "Ana"),
    "Olá Empresa $&, Facilities — Ana",
  );
});
test("name candidate lookup uses official name key and basic only without a prior CNPJ", async () => {
  let calls = 0;
  const candidate = await lookupDeskCompany(
    "name",
    "Empresa simulada",
    "fake-token",
    ["basic", "addresses", "emails"],
    (async (_url, init) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      assert.deepEqual(request, {
        type: "companies",
        key_type: "name",
        key_value: "Empresa simulada",
        datasets: ["basic"],
      });
      return Response.json({
        status: { code: 4000 },
        data: { basic: { tax_id: { number: cnpj }, name: { legal_name: "Empresa simulada" } } },
      });
    }) as typeof fetch,
  );
  assert.equal(calls, 1);
  assert.equal(candidate?.cnpj, cnpj);
  assert.equal(candidate?.legalName, "Empresa simulada");
});
test("DeskData errors preserve HTTP and safe status codes without provider prose or retry", async () => {
  for (const [http, code] of [
    [400, 4002],
    [403, 4003],
    [403, 4004],
    [500, 4999],
  ]) {
    let calls = 0;
    await assert.rejects(
      lookupDeskCompany("name", "Empresa simulada", "fake-token", ["basic"], (async () => {
        calls++;
        return Response.json(
          { status: { code, message: "secret-provider-prose" } },
          { status: http },
        );
      }) as typeof fetch),
      (error) =>
        error instanceof Error &&
        error.message === deskErrorMessage(code) &&
        !error.message.includes("secret-provider-prose"),
    );
    assert.equal(calls, 1);
  }
});
test("no result remains empty and processing does not trigger new paid queries", async () => {
  assert.equal(
    await lookupDeskCompany("name", "Empresa simulada", "fake-token", ["basic"], (async () =>
      Response.json({ status: { code: 4000 }, data: {} })) as typeof fetch),
    null,
  );
  await assert.rejects(
    lookupDeskCompany("name", "Empresa simulada", "fake-token", ["basic"], (async () =>
      Response.json({ status: { code: 4008 } }, { status: 202 })) as typeof fetch),
    /4008/,
  );
});

test("CNPJ enrichment maps legal name, segment, prioritized corporate contacts and full address", () => {
  const result = parseDeskCompany({ status: { code: 4000 }, data: {
    basic: { tax_id: { number: cnpj }, name: { legal_name: "Empresa sintética" }, activities: [{ is_main: true, subclass: "Facilities" }] },
    phones: { items: [
      { type: "WORK", country_code: "55", area_code: "41", number: "30000001", priority: 5 },
      { type: "WORK", country_code: "55", area_code: "41", number: "30000002", is_main: true },
      { type: "HOME", number: "4130000003" },
    ] },
    emails: { items: [{ type: "CORPORATE", email: "COMERCIAL@example.test" }, { type: "PERSONAL", email: "private@example.test" }] },
    addresses: { items: [{ type: "WORK", street_type: "Rua", street_name: "Sintética", number: "10", neighborhood: "Centro", city: "Curitiba", state: "PR", zip_code: "80000000" }] },
  } }, cnpj);
  assert.equal(result?.legalName, "Empresa sintética");
  assert.equal(result?.segment, "Facilities");
  assert.deepEqual(result?.phones, ["554130000002", "554130000001"]);
  assert.deepEqual(result?.emails, ["comercial@example.test"]);
  assert.equal(result?.address, "Rua Sintética 10 Centro 80000000");
  assert.equal(result?.city, "Curitiba");
  assert.equal(result?.state, "PR");
});
test("no WhatsApp inferred even if upstream supplies an undocumented flag", () => {
  const result = parseDeskCompany({ status: { code: 4000 }, data: {
    basic: { tax_id: { number: cnpj } }, phones: { items: [{ type: "WORK", number: "554130000001", is_whatsapp: true }] },
  } }, cnpj);
  assert.deepEqual(result?.whatsappNumbers, []);
});
test("upstream non-JSON HTTP500 retains bounded HTTP diagnosis and is never retried", async () => {
  let calls = 0;
  await assert.rejects(lookupDeskCompany("cnpj", cnpj, "fake", ["basic"], (async () => {
    calls++;
    return new Response("private upstream HTML", { status: 500 });
  }) as typeof fetch), (error) => error instanceof Error && error.message.includes("HTTP 500") && !error.message.includes("private"));
  assert.equal(calls, 1);
});
test("authorized direct QSA names and phones correlate exact identity without persisting CPF", () => {
  const raw = { status: { code: 4000 }, data: {
    basic: { tax_id: { number: cnpj } },
    relationships: { items: [
      { name: "Sócia sintética", class: "QSA", type: "SOCIO-ADMINISTRADOR", level: "DIRECT", tax_id: { number: "00000000001" } },
      { name: "Empregado", class: "EMPLOYEE", level: "DIRECT", tax_id: { number: "00000000002" } },
      { name: "Indireto", class: "QSA", level: "INDIRECT", tax_id: { number: "00000000003" } },
    ] },
    relationships_phones: [
      { number: "5541999990001", type: "MOBILE", relationship: { class: "QSA", tax_id: "00000000001" } },
      { number: "5541999990002", relationship: { class: "EMPLOYEE", tax_id: "00000000001" } },
      { number: "5541999990003", relationship: { class: "QSA", tax_id: "00000000009" } },
    ],
  } };
  const result = parseDeskCompany(raw, cnpj, ["basic", "relationships", "relationships_phones"]);
  assert.deepEqual(result?.partners, [{ name: "Sócia sintética", role: "SOCIO-ADMINISTRADOR", phones: ["5541999990001"] }]);
  assert.deepEqual(result?.phones, []);
  assert.equal(JSON.stringify(result).includes("00000000001"), false);
  assert.deepEqual(parseDeskCompany(raw, cnpj, ["basic"])?.partners, []);
  assert.deepEqual(parseDeskCompany(raw, cnpj, ["basic", "relationships"])?.partners?.[0].phones, []);
  const ambiguous = structuredClone(raw);
  ambiguous.data.relationships.items.push({ ...ambiguous.data.relationships.items[0], name: "Outra sócia" });
  assert.deepEqual(parseDeskCompany(ambiguous, cnpj, ["basic", "relationships", "relationships_phones"])?.partners?.[0].phones, []);
});
