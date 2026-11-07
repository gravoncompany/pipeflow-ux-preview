import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFindings, extractCnpjs, extractEmails, extractWhatsApp, pickReliable, robotsAllows, mergeProfile, type EnrichTarget } from "./b2b-public-enrichment";
import { runPublicEnrichment, safeSiteUrl } from "./b2b-public-enrichment.server";
import type { CompanyData } from "./b2b-prospecting";

const company = (o: Partial<CompanyData> = {}): CompanyData => ({
  placeId: "", cnpj: "11222333000181", legalName: "SORRISO PERFEITO ODONTOLOGIA LTDA", tradeName: "SORRISO PERFEITO", registrationStatus: "ATIVA",
  segment: "Odontologia", city: "Campinas", state: "SP", address: "RUA BARAO DE JAGUARA 1000 CENTRO", phones: ["551932221111"], emails: ["contabil@escritorio.com.br"],
  website: "", source: "manual", sourceReference: "Minha Receita · https://minhareceita.org/11222333000181", ...o,
});
const target = (o: Partial<EnrichTarget> = {}): EnrichTarget => ({ name: "Sorriso Perfeito", company: "", tradeName: "Sorriso Perfeito", legalName: "", city: "Campinas", state: "SP", address: "R. Barão de Jaguara, 1000 - Centro, Campinas", website: "", cnpj: "", ...o });
const ctx = (o: { website?: string; cnpj?: string; email?: string; city?: string } = {}) => ({
  lead: { id: "l1", name: "Sorriso Perfeito", company: "", email: o.email ?? "", whatsapp: "5519999990000", website: o.website ?? "" },
  profile: { ...company({ cnpj: o.cnpj ?? "", legalName: "", emails: [], phones: [], registrationStatus: "", city: o.city ?? "Campinas" }), placeId: "abc123" },
  cnpj: o.cnpj ?? "",
});


test("só aceita CNPJ com dígitos verificadores válidos", () => {
    assert.deepEqual(extractCnpjs("CNPJ 11.222.333/0001-81 · falso 11.222.333/0001-82"), ["11222333000181"]);
  });
test("prefere e-mail do próprio domínio e descarta imagens", () => {
    assert.equal(extractEmails('<a href="mailto:x@gmail.com">x</a> contato@sorriso.com.br logo@2x.png', "www.sorriso.com.br")[0], "contato@sorriso.com.br");
  });
test("lê WhatsApp só de links wa.me/api.whatsapp", () => {
    assert.deepEqual(extractWhatsApp('<a href="https://wa.me/5519988887777">Fale</a> (19) 3222-1111'), ["5519988887777"]);
  });
test("respeita robots.txt", () => {
    assert.equal(robotsAllows("User-agent: *\nDisallow: /", "/contato"), false);
    assert.equal(robotsAllows("User-agent: *\nDisallow: /admin", "/contato"), true);
    assert.equal(robotsAllows("User-agent: *\nDisallow: */tag/*\nDisallow: *?s=*", "/"), true);
    assert.equal(robotsAllows("User-agent: *\nDisallow: */tag/*", "/blog/tag/x"), false);
  });
test("não lê endereços internos, IPs ou redes sociais", () => {
    assert.equal(safeSiteUrl("https://127.0.0.1/"), null);
    assert.equal(safeSiteUrl("https://localhost/"), null);
    assert.equal(safeSiteUrl("http://sorriso.com.br"), null);
    assert.equal(safeSiteUrl("https://instagram.com/sorriso"), null);
    assert.equal(safeSiteUrl("https://sorriso.com.br")?.host, "sorriso.com.br");
  });

test("associa só com cidade e nome compatíveis", () => {
    assert.notEqual(pickReliable(target(), [{ company: company(), how: "historico" }]), null);
    assert.equal(pickReliable(target(), [{ company: company({ city: "Sorocaba" }), how: "historico" }]), null);
    assert.equal(pickReliable(target(), [{ company: company({ legalName: "AGENCIA WEB XPTO LTDA", tradeName: "XPTO", address: "AV NORTE SUL 50" }), how: "site" }]), null);
  });
test("duas empresas compatíveis = ambíguo, nada associado", () => {
    assert.equal(pickReliable(target(), [{ company: company(), how: "historico" }, { company: company({ cnpj: "11444777000161" }), how: "historico" }]), "ambiguous");
  });
test("sem cidade, só aceita CNPJ publicado no próprio site com nome compatível", () => {
    const t = target({ city: "", state: "", address: "" });
    assert.equal(pickReliable(t, [{ company: company(), how: "historico" }]), null);
    assert.notEqual(pickReliable(t, [{ company: company(), how: "site" }]), null);
  });

test("e-mail do cadastro público não é preenchido automaticamente (pode ser do contador)", () => {
    const f = buildFindings({ company: "", email: "", whatsapp: "", website: "", cnpj: "" }, company(), null, "", "Receita", "");
    assert.equal(f.find(x => x.key === "email")?.autoFill, false);
    assert.equal(f.find(x => x.key === "company")?.autoFill, true);
  });
test("valor igual ao atual não aparece como novo", () => {
    const f = buildFindings({ company: "SORRISO PERFEITO ODONTOLOGIA LTDA", email: "", whatsapp: "", website: "", cnpj: "11222333000181" }, company(), null, "", "Receita", "");
    assert.deepEqual(f.map(x => x.key), ["email", "whatsapp"]);
  });
test("perfil existente não perde dados ao completar", () => {
    const merged = mergeProfile(company({ cnpj: "", legalName: "", address: "Endereço do Maps", placeId: "p1" }), company(), "x");
    assert.equal(merged.address, "Endereço do Maps");
    assert.equal(merged.legalName, "SORRISO PERFEITO ODONTOLOGIA LTDA");
    assert.equal(merged.placeId, "p1");
  });

  const site = { pages: ["https://sorriso.com.br/", "https://sorriso.com.br/contato"], cnpjs: ["11222333000181"], emails: ["contato@sorriso.com.br"], whatsapp: ["5519988887777"], phones: [], addresses: [], blocked: false };
test("cadastro sem CNPJ: identifica pelo site, confere cidade e traz e-mail do site", async () => {
    const r = await runPublicEnrichment(ctx({ website: "https://sorriso.com.br" }), { site: async () => site, company: async () => company(), history: async () => [] });
    assert.equal(r.status, "found");
    assert.deepEqual(r.identified, { cnpj: "11222333000181", how: "site" });
    assert.equal(r.findings.find(f => f.key === "email")?.value, "contato@sorriso.com.br");
  });
test("CNPJ do site de outra cidade não é associado", async () => {
    const r = await runPublicEnrichment(ctx({ website: "https://sorriso.com.br" }), { site: async () => site, company: async () => company({ city: "Recife", state: "PE" }), history: async () => [] });
    assert.equal(r.identified, null);
    assert.equal(r.findings.some(f => f.key === "cnpj"), false);
  });
test("com CNPJ no card: consulta direta", async () => {
    let asked = "";
    const r = await runPublicEnrichment(ctx({ cnpj: "11222333000181" }), { site: async () => null, company: async c => { asked = c; return company(); }, history: async () => [] });
    assert.equal(asked, "11222333000181");
    assert.equal(r.identified?.how, "cnpj");
  });
test("sem site e sem histórico: conclui sem dados", async () => {
    const r = await runPublicEnrichment(ctx(), { site: async () => null, company: async () => company(), history: async () => [] });
    assert.equal(r.status, "no_data");
    assert.deepEqual(r.findings, []);
  });
