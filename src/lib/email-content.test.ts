import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonTextColor, emailHtml, emailPlainText, parseEmailBody, previewImageOrigin, safeEmailUrl } from "./email-content";
import { emailImageType } from "./email-images";
import { renderEmail, emailContentIssues } from "./email-campaigns";

const body = [
  "Olá {{nome}},",
  "[imagem: https://crm.gravoncompany.com/api/public/email-images/0d6b5c1e-1111-4222-8333-944445555666.png | Banner {{empresa}} | https://gravoncompany.com]",
  "Veja o [link: nosso portfólio | https://gravoncompany.com/portfolio] hoje.",
  "[botão: Agendar conversa | https://gravoncompany.com/agenda | #16a34a]",
].join("\n");

test("imagem, botão e link viram HTML com tabela, VML para Outlook e versão em texto", () => {
  const r = renderEmail({ subject: "Oi", body }, { name: "Ana", company: "A&B" });
  assert.ok(r.html.includes('<img src="https://crm.gravoncompany.com/api/public/email-images/0d6b5c1e-1111-4222-8333-944445555666.png" width="536" alt="Banner A&amp;B"'));
  assert.ok(r.html.includes('<a href="https://gravoncompany.com/portfolio" target="_blank"'));
  assert.ok(r.html.includes('v:roundrect') && r.html.includes('fillcolor="#16a34a"') && r.html.includes("Agendar conversa"));
  assert.ok(r.html.includes('role="presentation"') && r.html.includes("max-width:600px"));
  assert.ok(r.text.includes("nosso portfólio (https://gravoncompany.com/portfolio)"));
  assert.ok(r.text.includes("Agendar conversa: https://gravoncompany.com/agenda"));
  assert.equal(parseEmailBody(body).issues.length, 0);
});

test("endereços perigosos ou sem https são recusados e bloqueiam o envio", () => {
  assert.equal(safeEmailUrl("javascript:alert(1)", true), null);
  assert.equal(safeEmailUrl("http://site.com"), null);
  assert.equal(safeEmailUrl("data:image/png;base64,AAA"), null);
  assert.equal(safeEmailUrl("mailto:contato@gravoncompany.com"), null);
  assert.equal(safeEmailUrl("mailto:contato@gravoncompany.com", true), "mailto:contato@gravoncompany.com");
  const bad = "[botão: Comprar | javascript:alert(1)]\n[imagem: http://x.com/a.png | a]\n[link: aqui | ftp://x]";
  const codes = emailContentIssues({ subject: "Oi", body: bad }).map(i => i.code);
  assert.ok(codes.includes("button_url") && codes.includes("image_invalid") && codes.includes("link_invalid"));
  assert.ok(!emailHtml(bad, "rodapé").includes("javascript:"));
});

test("cor do botão: inválida bloqueia; texto do botão mantém contraste", () => {
  assert.ok(parseEmailBody("[botão: Ok | https://a.com | azul]").issues.some(i => i.code === "button_color"));
  assert.equal(buttonTextColor("#1d4ed8"), "#ffffff");
  assert.equal(buttonTextColor("#f59e0b"), "#111827");
});

test("marcador fora de linha própria é apontado; texto comum continua escapado", () => {
  assert.ok(parseEmailBody("Veja [imagem: https://a.com/x.png | x] aqui").issues.some(i => i.code === "markup_misplaced"));
  assert.ok(emailHtml("<script>x</script>", "r").includes("&lt;script&gt;"));
  assert.equal(emailPlainText("linha 1\n\nlinha 2"), "linha 1\n\nlinha 2");
});

test("imagens: só JPG, PNG e GIF reais; pré-visualização usa o endereço atual", () => {
  assert.equal(emailImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))?.ext, "png");
  assert.equal(emailImageType(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0]))?.ext, "jpg");
  assert.equal(emailImageType(new TextEncoder().encode("<svg onload=x>")), null);
  assert.equal(previewImageOrigin("https://crm.gravoncompany.com/api/public/email-images/a.png", "http://localhost:8080"), "http://localhost:8080/api/public/email-images/a.png");
});
