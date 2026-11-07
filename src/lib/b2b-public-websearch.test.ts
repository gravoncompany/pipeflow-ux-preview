import { test } from "node:test";
import assert from "node:assert/strict";
import { runPlaceLookup } from "./b2b-public-enrichment.server";
import { fieldRows } from "./b2b-public-enrichment";
import type { CompanyData } from "./b2b-prospecting";

// Sem rede: site, cadastro e busca na web simulados.
const company = (cnpj: string, legalName: string, address: string, city = "Curitiba"): CompanyData => ({ placeId: "", cnpj, legalName, tradeName: "", registrationStatus: "ATIVA", segment: "", city, state: "PR", address, phones: [], emails: ["contador@escritorio.test"], website: "", instagram: "", source: "manual", sourceReference: `Público · https://minhareceita.org/${cnpj}` });
const place = { key: "p1", name: "Central Facilities e Serviços de Apoio", address: "R. Dr. Joaquim Ignácio Silveira da Motta, 1198 - Uberaba, Curitiba - PR", website: "https://centralfacilities.test/", city: "Curitiba", state: "PR", phone: "" };
const site = async () => ({ pages: ["https://centralfacilities.test/"], cnpjs: [], emails: [], whatsapp: ["5541996110372"], phones: [], addresses: [], blocked: false });

test("sem CNPJ no site, a busca pública pelo nome encontra um candidato e ele é conferido pelo endereço", async () => {
  const r = await runPlaceLookup(place, {
    site, history: async () => [],
    company: async (c) => company(c, "CENTRAL FACILITIES E SERVICOS DE APOIO LTDA", "RUA DR. JOAQUIM I. SILVEIRA DA MOTTA 1198 UBERABA"),
    web: async () => [{ cnpj: "65897791000140", url: "https://cnpj.example/65897791000140", title: "Central Facilities" }],
  });
  assert.equal(r.identified?.cnpj, "65897791000140");
  assert.equal(r.identified?.how, "busca");
  const rows = Object.fromEntries(fieldRows(r).map((f) => [f.key, f]));
  assert.equal(rows.whatsapp.state, "found");
  assert.equal(rows.whatsapp.source, "Botão de WhatsApp no site oficial");
  assert.equal(rows.siteEmail.state, "not_found");
  assert.equal(rows.fiscalEmail.value, "contador@escritorio.test");
});

test("dois candidatos compatíveis ficam para revisão, sem vínculo automático", async () => {
  const r = await runPlaceLookup(place, {
    site, history: async () => [],
    company: async (c) => company(c, "CENTRAL FACILITIES E SERVICOS DE APOIO LTDA", "RUA X 10"),
    web: async () => [{ cnpj: "65897791000140", url: "https://a.example", title: "A" }, { cnpj: "11222333000181", url: "https://b.example", title: "B" }],
  });
  assert.equal(r.identified, null);
  assert.equal(r.ambiguous, true);
  assert.equal(r.candidates?.length, 2);
});

test("falha da busca aparece como falha, não como não encontrado; sem consulta fica ainda não pesquisado", async () => {
  const r = await runPlaceLookup(place, { site, history: async () => [], company: async () => { throw new Error("x"); }, web: async () => { throw new Error("down"); } });
  const cnpj = fieldRows(r).find((f) => f.key === "cnpj")!;
  assert.equal(cnpj.state, "error");
  assert.equal(fieldRows(null)[0].state, "not_searched");
});
