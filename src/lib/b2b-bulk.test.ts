import { test } from "node:test";
import assert from "node:assert/strict";
import { placeToCompany, companyEmails, companyPhones, pickCnpjCandidate, mergeIdentified } from "./b2b-bulk";
import { importInput, type CompanyData, type Place } from "./b2b-prospecting";

const place = (o: Partial<Place> = {}): Place => ({ id: "ChIJabc_123-x", name: "Clínica Sorriso", address: "Rua A, 10 - Curitiba - PR", phone: "(41) 3333-4444", website: "https://sorriso.com.br", category: "Dentista", mapsUrl: "https://maps.google.com/?cid=1", rating: 4.8, userRatingCount: 120, instagram: "", attributions: [], ...o });
const search = { city: "Curitiba", state: "PR" as const };
const pub = (o: Partial<CompanyData> = {}): CompanyData => ({ placeId: "", cnpj: "11222333000181", legalName: "SORRISO ODONTOLOGIA LTDA", tradeName: "Clínica Sorriso", registrationStatus: "ATIVA", segment: "Odontologia", city: "Curitiba", state: "PR", address: "Rua A, 10", phones: ["4133334444"], emails: ["contato@sorriso.com.br"], website: "", source: "manual", sourceReference: "Minha Receita", ...o });

test("cadastro sem CNPJ: usa o identificador do Google Maps e passa na validação da importação existente", () => {
  const r = placeToCompany(place(), search);
  assert.equal(r.ok, true); if (!r.ok) return;
  assert.equal(r.company.cnpj, ""); assert.equal(r.company.placeId, "ChIJabc_123-x"); assert.equal(r.company.tradeName, "Clínica Sorriso");
  assert.deepEqual(r.company.phones, ["4133334444"]); assert.deepEqual(r.company.emails, []); assert.equal(r.company.website, "https://sorriso.com.br");
  assert.equal(importInput.safeParse({ pipelineId: null, companies: [r.company], confirmed: true }).success, true);
});
test("não inventa dados: site sem HTTPS descartado; nome ausente ou identificador inválido recusados com motivo", () => {
  const http = placeToCompany(place({ website: "http://inseguro.com" }), search); assert.equal(http.ok && http.company.website, "");
  assert.deepEqual(placeToCompany(place({ name: " " }), search), { ok: false, reason: "nome da empresa ausente" });
  assert.deepEqual(placeToCompany(place({ id: "id com espaço" }), search), { ok: false, reason: "identificador do Google Maps inválido" });
});
test("dados revisados têm prioridade; contatos combinam revisão e Maps sem duplicar", () => {
  const reviewed = pub({ placeId: "ChIJabc_123-x" });
  const r = placeToCompany(place(), search, reviewed); assert.equal(r.ok && r.company.cnpj, "11222333000181");
  assert.deepEqual(companyEmails(reviewed), ["contato@sorriso.com.br"]); assert.deepEqual(companyEmails(undefined), []);
  assert.deepEqual(companyPhones(place(), reviewed), ["4133334444"]);
});
test("CNPJ: só associa com candidato único de mesmo nome e local; ambíguo ou ausente fica sem CNPJ", () => {
  assert.equal(pickCnpjCandidate(place(), [pub()], search).status, "identificado");
  assert.equal(pickCnpjCandidate(place(), [pub(), pub({ cnpj: "99888777000166" })], search).status, "ambiguo");
  assert.equal(pickCnpjCandidate(place(), [pub({ city: "Londrina" })], search).status, "nao_encontrado");
  assert.equal(pickCnpjCandidate(place(), [pub({ tradeName: "Outra Empresa", legalName: "OUTRA LTDA" })], search).status, "nao_encontrado");
  assert.equal(pickCnpjCandidate(place(), [], search).status, "nao_encontrado");
  const merged = mergeIdentified(place(), search, pub());
  assert.equal(merged.placeId, "ChIJabc_123-x"); assert.equal(merged.cnpj, "11222333000181"); assert.equal(merged.website, "https://sorriso.com.br");
  assert.deepEqual(merged.emails, ["contato@sorriso.com.br"]);
});
