import { test } from "node:test";
import assert from "node:assert/strict";
import { deskBindInput, deskSendInput, leadDeskDatasets, deskQueryCode } from "./lead-deskdata";
import { deskQueryOperation, parseDeskCompany } from "./b2b-providers.server";
import { businessLinks } from "./business-links";
import { rowToLead, leadToRow } from "./lead-mapper";
import { estimateDeskCredits, assertPartnerEnrichment, requestedDatasets, mergeCompanyData } from "./b2b-hybrid";

const leadId = "00000000-0000-4000-8000-000000000001", cnpj = "50621449000145";
test("documented DeskData basic fields expose size capital and CNAE, never presumed revenue", () => {
  const company = parseDeskCompany({status:{code:4000},data:{basic:{tax_id:{number:cnpj},size:"ME",capital_value:"10000.00",founding_date:"2022-04-01T00:00:00Z",activities:[{is_main:true,code:"5250801",subclass:"Comissaria"}],revenue:500000}}}, cnpj, ["basic"]);
  assert.ok(company);
  assert.equal(company.publicDetails?.capital, 10000);
  assert.equal(company.publicDetails?.companySize, "ME");
  assert.equal(company.publicDetails?.cnae, "5250801");
  assert.equal(company.publicDetails?.openedOn, "2022-04-01T00:00:00Z");
  assert.equal(company.publicDetails?.revenueEstimate, null);
  assert.equal(company.publicDetails?.revenueSource, "");
});
test("capital is never inferred from malformed or localized uncontracted values", () => {
  for (const capital_value of ["10.000,00", "-100", "NaN", "Infinity", ""]) {
    const c = parseDeskCompany({status:{code:4000},data:{basic:{tax_id:{number:cnpj},capital_value}}}, cnpj);
    assert.equal(c?.publicDetails?.capital, null);
  }
});
test("manual company basic enrichment allows only selected CNPJ datasets and confirmed pricing", () => {
  assert.doesNotThrow(() => assertPartnerEnrichment({keyType:"cnpj",selected:["basic"]}));
  assert.throws(() => assertPartnerEnrichment({keyType:"name",selected:["basic"]}));
  assert.throws(() => assertPartnerEnrichment({keyType:"cnpj",selected:[]}));
  assert.throws(() => assertPartnerEnrichment({keyType:"cnpj",selected:["revenue"]}));
  assert.deepEqual(requestedDatasets({keyType:"cnpj",key:cnpj,selected:["basic"]}), ["basic"]);
  assert.equal(estimateDeskCredits(["basic"],["basic"],{}),null);
});
test("enrichment fills absent registration fields without changing confirmed capital or revenue", () => {
  const incoming = parseDeskCompany({status:{code:4000},data:{basic:{tax_id:{number:cnpj},size:"ME",capital_value:"10000.00"}}}, cnpj);
  assert.ok(incoming);
  const current = {...incoming, publicDetails:{openedOn:"",cnae:"",postalCode:"",capital:7000,revenueEstimate:20000,revenueSource:"Fonte confirmada",registrySource:"Receita"}};
  const merged = mergeCompanyData(current,incoming);
  assert.equal(merged.publicDetails?.companySize,"ME");
  assert.equal(merged.publicDetails?.capital,7000);
  assert.equal(merged.publicDetails?.revenueEstimate,20000);
  assert.equal(merged.publicDetails?.registrySource,"Receita + DeskData · dados cadastrais");
});
test("CNPJ association requires identity and storage authorization", () => {
  assert.equal(deskBindInput.safeParse({ leadId, cnpj, identityConfirmed: true, storageAuthorized: true }).success, true);
  for (const field of ["identityConfirmed", "storageAuthorized"]) assert.equal(deskBindInput.safeParse({ leadId, cnpj, identityConfirmed: true, storageAuthorized: true, [field]: false }).success, false);
});
test("paid requests require explicit confirmation and total dependency costs", () => {
  assert.equal(deskSendInput.safeParse({ leadId, quote: "signed", confirmed: false }).success, false);
  const datasets = leadDeskDatasets(["relationships_phones"]);
  assert.deepEqual(datasets, ["basic", "relationships", "relationships_phones"]);
  assert.equal(estimateDeskCredits(datasets, datasets, { basic: 1, relationships: 2, relationships_phones: 3 }), 6);
  assert.equal(estimateDeskCredits(datasets, datasets, { basic: 1 }), null);
});
test("pending DeskData retrieves the original query through GET only", async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const transport = (async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "", body: init?.body });
    return calls.length < 3 ? Response.json({ query_code: "Q-ABCDEF0123", status: { code: 4008 } }, { status: 202 }) : Response.json({ status: { code: 4000 }, data: { basic: { tax_id: { number: cnpj }, name: { legal_name: "Empresa simulada" } } } });
  }) as typeof fetch;
  const pending = await deskQueryOperation(cnpj, ["basic"], "fake", undefined, transport);
  assert.equal(pending.pending, true); assert.equal(pending.queryCode, "Q-ABCDEF0123");
  const again = await deskQueryOperation(cnpj, ["basic"], "fake", "Q-ABCDEF0123", transport);
  assert.equal(again.pending, true);
  const done = await deskQueryOperation(cnpj, ["basic"], "fake", "Q-ABCDEF0123", transport);
  assert.equal(done.company?.legalName, "Empresa simulada");
  assert.deepEqual(calls.map(c => c.method), ["POST", "GET", "GET"]);
  assert.equal(calls[1].url, "https://api.deskdata.com.br/queries/Q-ABCDEF0123");
  assert.equal(calls[1].body, undefined);
});
test("invalid or absent recovery handles never authorize a fresh POST", async () => {
  assert.equal(deskQueryCode("https://evil.test"), null);
  let calls = 0;
  await assert.rejects(deskQueryOperation(cnpj, ["basic"], "fake", "bad", (async () => { calls++; return Response.json({}); }) as typeof fetch));
  assert.equal(calls, 0);
  const result = await deskQueryOperation(cnpj, ["basic"], "fake", undefined, (async () => Response.json({ status: { code: 4008 } }, { status: 202 })) as typeof fetch);
  assert.equal(result.queryCode, null); assert.equal(result.pending, true);
});
test("documented nested query.code survives 4008 and delayed requests use Bearer GET without datasets body", async () => {
  const methods:string[]=[];
  let handle:string|undefined;
  for (let n=0;n<3;n++) {
    const operation = await deskQueryOperation(cnpj,["basic","relationships","relationships_phones"],"fake-secret",handle,(async (url,init)=>{
      methods.push(init?.method ?? "");
      assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer fake-secret");
      assert.ok(init?.signal);
      if(n===0) {
        const body=JSON.parse(String(init?.body));
        assert.deepEqual(body,{type:"companies",key_type:"cnpj",key_value:cnpj,datasets:["basic","relationships","relationships_phones"]});
      } else {
        assert.equal(String(url),"https://api.deskdata.com.br/queries/Q-ABC123DEF4");
        assert.equal(init?.body,undefined);
      }
      return Response.json(n<2 ? {query:{code:"Q-ABC123DEF4"},status:{code:4008}} : {query:{code:"Q-ABC123DEF4"},status:{code:4000},data:{basic:{tax_id:{number:cnpj}}}},{status:n<2?202:200});
    }) as typeof fetch);
    handle=operation.queryCode ?? undefined;
    assert.equal(operation.pending,n<2);
    assert.equal(handle,"Q-ABC123DEF4");
  }
  assert.deepEqual(methods,["POST","GET","GET"]);
});
test("Instagram supplied as site belongs to Instagram and commercial site stays independent", () => {
  assert.deepEqual(businessLinks("https://instagram.com/Empresa.Teste/?utm_source=maps"), { website: "", instagram: "https://www.instagram.com/empresa.teste/" });
  assert.deepEqual(businessLinks("https://empresa.test", "https://instagram.com/perfil/"), { website: "https://empresa.test", instagram: "https://instagram.com/perfil/" });
  assert.equal(businessLinks("https://instagram.com.evil.test/perfil/").instagram, "");
  assert.equal(businessLinks("https://instagram.com/p/post/").instagram, "");
});
test("existing CRM links classify on read and write without overwriting confirmed Instagram", () => {
  const lead = rowToLead({ id: leadId, website: "https://www.instagram.com/empresa.teste/", instagram: "" });
  assert.equal(lead.website, ""); assert.equal(lead.instagram, "https://www.instagram.com/empresa.teste/");
  assert.equal(leadToRow(lead).instagram, lead.instagram);
  const conflict = businessLinks("https://instagram.com/outro/", "@confirmado");
  assert.equal(conflict.instagram, "@confirmado"); assert.equal(conflict.website, "https://instagram.com/outro/");
});