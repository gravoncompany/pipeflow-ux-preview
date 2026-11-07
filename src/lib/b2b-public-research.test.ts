import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicResearchLookup, parsePublicCompany } from "./b2b-public.server";
import { assertPartnerEnrichment, matchPublicCompanyNames } from "./b2b-hybrid";
import { buildDeskQuote } from "./b2b-hybrid.server";

const cnpj="50621449000145";
const fixture={cnpj,razao_social:"Empresa fictícia",nome_fantasia:"Café fictício",cnae_fiscal:1234567,cnae_fiscal_descricao:"Serviços",capital_social:10000,email:"contato@example.test",ddd_telefone_1:"4130000001",municipio:"Curitiba",uf:"PR",logradouro:"Rua fictícia",qsa:[{nome_socio:"Sócia fictícia",qualificacao_socio:"Sócia",cnpj_cpf_do_socio:"***123456**"}]};

test("Minha Receita is free primary, sanitizes data and identifies actual source",async()=>{
 const urls:string[]=[];
 const lookup=createPublicResearchLookup({transport:(async url=>{urls.push(String(url));return Response.json(fixture);}) as typeof fetch});
 const company=await lookup(cnpj);
 assert.deepEqual(urls,[`https://minhareceita.org/${cnpj}`]);
 assert.equal(company.evidence?.[0].source,"Minha Receita");
 assert.equal(company.evidence?.[0].reference,`https://minhareceita.org/${cnpj}`);
 assert.equal(company.publicDetails?.capital,10000);
 assert.equal(company.publicDetails?.revenueEstimate,null);
 assert.deepEqual(company.partners,[{name:"Sócia fictícia",role:"Sócia",phones:[]}]);
 assert.equal(JSON.stringify(company).includes("123456**"),false);
});
test("transient primary failure uses BrasilAPI once and records secondary provenance",async()=>{
 const urls:string[]=[];
 const lookup=createPublicResearchLookup({log:()=>{},transport:(async url=>{urls.push(String(url));return urls.length===1?new Response("private",{status:503}):Response.json(fixture);}) as typeof fetch});
 const [a,b]=await Promise.all([lookup(cnpj),lookup(cnpj)]);
 assert.deepEqual(urls,[`https://minhareceita.org/${cnpj}`,`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`]);
 assert.deepEqual(a,b);assert.equal(a.evidence?.[0].source,"BrasilAPI / Minha Receita");
});
test("rate limit and definitive failures never bypass to another provider",async()=>{
 for(const status of [429,400,404,302]){
  const urls:string[]=[];
  const lookup=createPublicResearchLookup({log:()=>{},transport:(async url=>{urls.push(String(url));return new Response("private",{status});}) as typeof fetch});
  await assert.rejects(lookup(cnpj));assert.deepEqual(urls,[`https://minhareceita.org/${cnpj}`]);
 }
});
test("invalid primary data and mismatched identity never fall back or replace records",async()=>{
 for(const data of [{...fixture,cnpj:"11222333000181"},{...fixture,razao_social:null}]){
  let calls=0;
  const lookup=createPublicResearchLookup({log:()=>{},transport:(async()=>{calls++;return Response.json(data);}) as typeof fetch});
  await assert.rejects(lookup(cnpj));assert.equal(calls,1);
 }
});
test("name lookup searches only supplied cached records and never infers an identity",()=>{
 const company=parsePublicCompany(fixture,cnpj);
 assert.deepEqual(matchPublicCompanyNames([company,company],"cafe"),[company]);
 assert.deepEqual(matchPublicCompanyNames([company],"Empresa"),[company]);
 assert.deepEqual(matchPublicCompanyNames([company],"Desconhecida"),[]);
});
test("DeskData is restricted to selected partner enrichment by CNPJ",async()=>{
 assert.throws(()=>assertPartnerEnrichment({keyType:"name",selected:["relationships"]}));
 assert.throws(()=>assertPartnerEnrichment({keyType:"cnpj",selected:[]}));
 assert.doesNotThrow(()=>assertPartnerEnrichment({keyType:"cnpj",selected:["relationships_phones"]}));
 await assert.rejects(buildDeskQuote({keyType:"name",key:"Empresa",selected:[]}));
});