import { test } from "node:test";
import assert from "node:assert/strict";
import { whatsappLink, whatsappEvidence, pageMatchesInstagram } from "./instagram-public-contacts";
import { extractContacts, profileToCompany, type InstagramProfile } from "./b2b-instagram";
import { resolveContactLink } from "./b2b-instagram-public.server";

for (const url of ["https://wa.me/5541999991234", "https://api.whatsapp.com/send?text=Oi&phone=%2B5541999991234", "https://web.whatsapp.com/send?phone=5541999991234", "https://www.whatsapp.com/send?phone=5541999991234", "https://l.instagram.com/?u=https%3A%2F%2Fwa.me%2F5541999991234"]) {
  test(`WhatsApp explícito em ${new URL(url).hostname}`, () => {
    assert.equal(whatsappLink(url).phone, "5541999991234");
    const c = extractContacts("", url);
    assert.equal(c.whatsapp, "5541999991234");
    assert.equal(c.website, "");
    assert.equal(whatsappLink(url).original, url);
  });
}
test("WhatsApp sem telefone e domínio falso não inventam contatos", () => {
  assert.equal(extractContacts("", "https://whatsapp.com/").website, "");
  assert.equal(whatsappLink("https://wa.me/abc").phone, "");
  assert.equal(whatsappLink("https://wa.me.attacker.test/5541999991234").isWhatsapp, false);
  assert.equal(extractContacts("Tel: (41) 3333-1234", "").whatsapp, "");
});
test("Botões flutuantes e orçamento preservam fonte", () => {
  const html = `<a aria-label="Solicitar orçamento" href="https://web.whatsapp.com/send?text=Olá&amp;phone=5541999991234"><i></i></a>`;
  assert.deepEqual(whatsappEvidence(html, "https://empresa.test/contato", "site"), [{ field: "whatsapp", value: "5541999991234", url: "https://empresa.test/contato", method: "site" }]);
});
test("Pesquisa complementar exige backlink exato, nunca apenas nome semelhante", () => {
  assert.equal(pageMatchesInstagram(`<a href="https://instagram.com/empresa/">Instagram</a>`, "empresa"), true);
  assert.equal(pageMatchesInstagram(`<a href="https://instagram.com/outra/">Empresa Curitiba</a>`, "empresa"), false);
  assert.equal(pageMatchesInstagram(`<a href="https://instagram.com.attacker.test/empresa/">Empresa</a>`, "empresa"), false);
});
test("Redirecionamento de atendimento extrai destino sem requisitar WhatsApp", async () => {
  const calls: string[] = [];
  const mock = (async (url: string | URL | Request) => { calls.push(String(url)); return new Response(null, { status: 302, headers: { location: "https://wa.me/5541999991234" } }); }) as typeof fetch;
  assert.equal(await resolveContactLink("https://empresa.test/orcamento", "https://empresa.test/", mock), "5541999991234");
  assert.deepEqual(calls, ["https://empresa.test/orcamento"]);
});
test("Redirecionamento privado ou de outra empresa falha fechado", async () => {
  for (const destination of ["https://127.0.0.1/", "https://outra.test/contato", "https://user:pass@empresa.test/"]) {
    let calls = 0;
    const mock = (async () => { calls++; return new Response(null, { status: 302, headers: { location: destination } }); }) as typeof fetch;
    assert.equal(await resolveContactLink("https://empresa.test/contato", "https://empresa.test/", mock), "");
    assert.equal(calls, 1);
  }
});
test("Revisão preserva fonte e não transforma telefone em WhatsApp", () => {
  const p = { username: "empresa", fullName: "Empresa", biography: "", externalUrl: "https://wa.me/5541999991234", whatsapp: "", phone: "554133331234", cnpj: "", address: "", city: "", state: "", aiSegment: "", category: "", hashtag: "facilities", email: "contato@empresa.test", contactSources: [{ field: "email", value: "contato@empresa.test", url: "https://empresa.test/contato", method: "site" }] } as InstagramProfile;
  const c = profileToCompany(p);
  assert.equal(c.website, "");
  assert.deepEqual(c.whatsappNumbers, ["5541999991234"]);
  assert.match(c.sourceReference, /https:\/\/empresa.test\/contato/);
  assert.deepEqual(profileToCompany({ ...p, externalUrl: "https://empresa.test" }).whatsappNumbers, []);
});