import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePublicCompany, lookupPublicCompany } from "./b2b-public.server";
import { mergeCompanyData, requestedDatasets, estimateDeskCredits, publicLookupInput, paidLookupInput } from "./b2b-hybrid";
import { configuredDeskCosts, lookupKey } from "./b2b-hybrid.server";
const cnpj="50621449000145";
const fixture={cnpj,razao_social:"Empresa fictícia",nome_fantasia:"Teste",capital_social:10000,data_inicio_atividade:"2020-01-01",cnae_fiscal:1234567,cnae_fiscal_descricao:"Serviços",cep:"80000000",municipio:"Curitiba",uf:"PR",ddd_telefone_1:"4130000001",email:"contato@example.test",qsa:[{nome_socio:"Sócia fictícia",qualificacao_socio:"Sócia",cnpj_cpf_do_socio:"***123456**"}]};
test("public CNPJ fills registration contacts and QSA without retaining CPF",()=>{
 const result=parsePublicCompany(fixture,cnpj);
 assert.equal(result.legalName,"Empresa fictícia");assert.equal(result.publicDetails?.openedOn,"2020-01-01");
 assert.equal(result.publicDetails?.capital,10000);assert.equal(result.publicDetails?.revenueEstimate,null);
 assert.deepEqual(result.phones,["554130000001"]);assert.deepEqual(result.emails,["contato@example.test"]);
 assert.deepEqual(result.partners,[{name:"Sócia fictícia",role:"Sócia",phones:[]}]);
 assert.equal(JSON.stringify(result).includes("123456**"),false);assert.deepEqual(result.whatsappNumbers,[]);
 assert.throws(()=>parsePublicCompany(fixture,"11222333000181"),/CNPJ/);
});
test("incomplete sources cannot overwrite existing reliable values",()=>{
 const current=parsePublicCompany(fixture,cnpj);const incoming=parsePublicCompany({...fixture,razao_social:"Outro nome",email:null,ddd_telefone_1:null},cnpj);
 const merged=mergeCompanyData(current,incoming);assert.equal(merged.legalName,"Empresa fictícia");assert.deepEqual(merged.emails,["contato@example.test"]);assert.deepEqual(merged.phones,["554130000001"]);
});
test("public query needs legitimate purpose and paid query requires quote plus confirmation",()=>{
 assert.equal(publicLookupInput.safeParse({cnpj,purposeConfirmed:false}).success,false);
 assert.equal(paidLookupInput.safeParse({keyType:"cnpj",key:cnpj,confirmed:true}).success,false);
 assert.equal(paidLookupInput.safeParse({keyType:"cnpj",key:cnpj,confirmed:false,quote:"x"}).success,false);
});
test("phone quote includes basic and relationships costs and rejects uncontracted or unknown pricing",()=>{
 const datasets=requestedDatasets({keyType:"cnpj",key:cnpj,selected:["relationships_phones"]});
 assert.deepEqual(datasets,["basic","relationships","relationships_phones"]);
 assert.equal(estimateDeskCredits(datasets,datasets,{basic:1,relationships:2,relationships_phones:3}),6);
 assert.equal(estimateDeskCredits(datasets,["basic"],{basic:1,relationships:2,relationships_phones:3}),null);
 assert.equal(estimateDeskCredits(datasets,datasets,{basic:1}),null);
 assert.deepEqual(configuredDeskCosts({B2B_DESKDATA_CREDIT_COSTS:'{"basic":1}'}),{});
});
test("query identity canonicalization prevents duplicate CNPJ charges",async()=>{
 assert.equal(await lookupKey("deskdata","cnpj",cnpj,["basic","relationships"]),await lookupKey("deskdata","cnpj","50.621.449/0001-45",["relationships","basic"]));
});
test("public failures try only primary and free secondary, never DeskData",async()=>{
 const urls:string[]=[];await assert.rejects(lookupPublicCompany(cnpj,(async(url)=>{urls.push(String(url));return new Response("private prose",{status:503});}) as typeof fetch),/HTTP 503/);assert.deepEqual(urls,[`https://minhareceita.org/${cnpj}`,`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`]);
});