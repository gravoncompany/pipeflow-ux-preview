import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, insightForEmail, insightLinks, instagramHandle, parseDiscovery } from "./company-insights";

test("Instagram handle comes only from a profile URL or @handle, never posts/reels", () => {
  assert.equal(instagramHandle("https://www.instagram.com/Clinica.Sorriso/"), "clinica.sorriso");
  assert.equal(instagramHandle("@clinica_sorriso"), "clinica_sorriso");
  assert.equal(instagramHandle("instagram.com/clinica"), "clinica");
  assert.equal(instagramHandle("https://www.instagram.com/p/ABC123/"), "");
  assert.equal(instagramHandle("https://www.instagram.com/reel/ABC123/"), "");
  assert.equal(instagramHandle("https://evil.com/clinica"), "");
  assert.equal(instagramHandle(""), "");
});

test("site reading follows only same-host HTTPS service/about pages, max 3", () => {
  const html = `<a href="/servicos">Serviços</a><a href="/sobre">Sobre nós</a><a href="https://other.com/servicos">x</a>
    <a href="http://clinica.com.br/tratamentos">t</a><a href="/blog">Blog</a><a href="/tratamentos">Tratamentos</a><a href="/especialidades">Especialidades</a>`;
  assert.deepEqual(insightLinks(html, "https://clinica.com.br/"), ["https://clinica.com.br/servicos", "https://clinica.com.br/sobre", "https://clinica.com.br/tratamentos"]);
});

test("page text drops scripts and tags", () => {
  const t = htmlToText("<title>Clínica X</title><script>alert(1)</script><p>Implantes &amp; clareamento</p>");
  assert.match(t, /Clínica X/);
  assert.match(t, /Implantes & clareamento/);
  assert.doesNotMatch(t, /alert/);
});

test("Business Discovery reply keeps only Instagram permalinks and at most 8 posts", () => {
  const media = Array.from({ length: 10 }, (_, i) => ({ caption: `post ${i}`, permalink: i === 0 ? "https://evil.com/x" : `https://www.instagram.com/p/${i}/`, like_count: i }));
  const p = parseDiscovery({ business_discovery: { username: "clinica", followers_count: 1200, media: { data: media } } });
  assert.ok(p);
  assert.equal(p.recent.length, 8);
  assert.equal(p.recent[0].permalink, "");
  assert.equal(p.recent[1].permalink, "https://www.instagram.com/p/1/");
  assert.equal(parseDiscovery({ error: { code: 110 } }), null);
});

test("e-mail context is empty without an analysis", () => {
  assert.equal(insightForEmail(null), "");
  const text = insightForEmail({ summary: "Clínica odontológica em Curitiba.", services: [{ name: "Implantes", source: "site" }], positioning: "", recentPosts: "", opportunities: ["Site sem botão de agendamento"], emailAngle: "" });
  assert.match(text, /Implantes \(site\)/);
  assert.match(text, /Site sem botão de agendamento/);
});
