import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignInstances, campaignReadiness } from "./campaign-channels";
const binding = { instance: "Empresa teste", company_key: "crm:1", canonical_phone: "5541999990001" };
const row = { name: binding.instance, ownerJid: `${binding.canonical_phone}@s.whatsapp.net`, connectionStatus: "open", integration: "WHATSAPP-BAILEYS" };
const channels = () => ({ instances: campaignInstances([row], [binding], [binding]), error: null, checkedAt: "2026-11-01T22:00:00Z" });
test("connected, exclusively bound instance is ready for campaigns (start still needs the acknowledgement)", () => {
 const i = channels().instances[0]; assert.equal(i.bindingVerified,true); assert.equal(i.connection,"open"); assert.equal(i.campaignAuthorized,true);
 const r = campaignReadiness({channel:"whatsapp",instanceReference:binding.instance,body:"Mensagem",scheduledAt:null},channels(),1); assert.equal(r.ready,true); assert.equal(r.warnings.length>0,true);
});
test("WhatsApp scheduling is not offered", () => { assert.equal(campaignReadiness({channel:"whatsapp",instanceReference:binding.instance,body:"Mensagem",scheduledAt:"2099-01-01T00:00:00Z"},channels(),1).ready,false); });
test("no eligible recipients blocks start", () => { assert.equal(campaignReadiness({channel:"whatsapp",instanceReference:binding.instance,body:"Mensagem",scheduledAt:null},channels(),0).ready,false); });
test("other-company instances and phone fields are never disclosed", () => {
 const other = {...binding,instance:"Outra empresa",company_key:"crm:other"}; const result=campaignInstances([row,{...row,name:other.instance}],[binding,other],[binding,other]);
 assert.deepEqual(result.map(i=>i.reference),[binding.instance]); assert.equal(JSON.stringify(result).includes(binding.canonical_phone),false);
});
test("conflicting company binding cannot authorize the selected instance",()=>{assert.equal(campaignInstances([row],[binding],[binding,{...binding,company_key:"crm:other"}])[0].bindingVerified,false);});
test("mismatched sender cannot authorize the instance",()=>{assert.equal(campaignInstances([{...row,ownerJid:"5541888880001@s.whatsapp.net"}],[binding],[binding])[0].bindingVerified,false);});
test("duplicate provider instance fails closed",()=>{const i=campaignInstances([row,row],[binding],[binding])[0];assert.equal(i.bindingVerified,false);assert.equal(i.connection,"ambiguous");});
test("disconnected instance remains blocked even with valid binding",()=>{const c=channels();c.instances=campaignInstances([{...row,connectionStatus:"close"}],[binding],[binding]);assert.equal(c.instances[0].connection,"close");assert.equal(campaignReadiness({channel:"whatsapp",instanceReference:binding.instance,body:"Mensagem",scheduledAt:null},c,1).ready,false);});
test("official transport also requires independent policy/template validation",()=>{const i=campaignInstances([{...row,integration:"WHATSAPP-BUSINESS"}],[binding],[binding])[0];assert.equal(i.campaignAuthorized,true);assert.equal(i.transport,"WHATSAPP-BUSINESS");});
test("scheduling validates future date and consent but never enqueues",()=>{const input={channel:"whatsapp" as const,instanceReference:binding.instance,body:"Mensagem",scheduledAt:"2026-11-01T20:00:00Z"}; const r=campaignReadiness(input,channels(),0,Date.parse("2026-11-01T22:00:00Z"));assert.equal(r.eligible,0);assert.equal(r.reasons.includes("A data pretendida precisa estar no futuro."),true);assert.equal(r.ready,false);assert.equal(campaignReadiness({...input,scheduledAt:"2026-12-01T12:00:00Z"},channels(),2).ready,false);});
test("missing authorization or provider error cannot become send permission",()=>{const result=campaignReadiness({channel:"whatsapp",instanceReference:binding.instance,body:"Mensagem",scheduledAt:null},{instances:[],error:"Canal não autorizado",checkedAt:""},1);assert.equal(result.ready,false);assert.equal(result.reasons.includes("Canal não autorizado"),true);});
test("oversized provider list fails closed rather than truncating",()=>{assert.throws(()=>campaignInstances(Array.from({length:201},()=>row),[binding],[binding]));});