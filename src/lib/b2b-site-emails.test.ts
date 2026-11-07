import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bestContact, classifyEmail, summarizeEmailSearch, teamLinks,
  type SiteEmailContact, type SiteEmailResult,
} from "./b2b-site-emails";
import { searchPlaceEmails, searchPlacesEmails, scanSiteEmails } from "./b2b-site-emails.server";

const contact = (email: string, source: "site" | "fiscal" = "site", page = "https://empresa.com.br/contato"): SiteEmailContact =>
  ({ email, kind: classifyEmail(email), page, source });

describe("classifyEmail", () => {
  it("reconhece diretoria, comercial e administração pela parte local", () => {
    assert.equal(classifyEmail("diretoria@empresa.com.br"), "diretoria");
    assert.equal(classifyEmail("socio@empresa.com.br"), "diretoria");
    assert.equal(classifyEmail("comercial@empresa.com.br"), "comercial");
    assert.equal(classifyEmail("vendas@empresa.com.br"), "comercial");
    assert.equal(classifyEmail("orcamento@empresa.com.br"), "comercial");
    assert.equal(classifyEmail("administrativo@empresa.com.br"), "administracao");
    assert.equal(classifyEmail("financeiro@empresa.com.br"), "administracao");
  });
  it("trata contato/atendimento e desconhecidos como geral", () => {
    assert.equal(classifyEmail("contato@empresa.com.br"), "geral");
    assert.equal(classifyEmail("atendimento@empresa.com.br"), "geral");
    assert.equal(classifyEmail("maria.silva@empresa.com.br"), "geral");
  });
});

describe("bestContact", () => {
  it("prioriza diretoria sobre comercial e geral", () => {
    const best = bestContact([contact("contato@empresa.com.br"), contact("comercial@empresa.com.br"), contact("diretoria@empresa.com.br")]);
    assert.equal(best?.email, "diretoria@empresa.com.br");
  });
  it("cai para o e-mail geral quando não há contato específico", () => {
    const best = bestContact([contact("contato@empresa.com.br")]);
    assert.equal(best?.email, "contato@empresa.com.br");
  });
  it("prefere e-mail do site ao fiscal na mesma prioridade", () => {
    const best = bestContact([contact("contato@empresa.com.br", "fiscal", ""), contact("contato@empresa.com.br")]);
    assert.equal(best?.source, "site");
  });
  it("devolve null sem contatos", () => {
    assert.equal(bestContact([]), null);
  });
});

describe("teamLinks", () => {
  it("descobre páginas de equipe no mesmo domínio", () => {
    const html = `<a href="/equipe">Nossa equipe</a><a href="https://outro.com/team">Team</a><a href="/contato">Contato</a>`;
    assert.deepEqual(teamLinks(html, "https://empresa.com.br/"), ["https://empresa.com.br/equipe"]);
  });
});

describe("summarizeEmailSearch", () => {
  it("conta consultadas, com e-mail, com contato específico e falhas", () => {
    const r = (contacts: SiteEmailContact[], status: SiteEmailResult["status"]): SiteEmailResult =>
      ({ key: "k", name: "n", cnpj: "", site: "", contacts, status, note: "", checkedAt: "", fromCache: false });
    const summary = summarizeEmailSearch([
      r([contact("diretoria@a.com.br")], "encontrado"),
      r([contact("contato@b.com.br")], "encontrado"),
      r([], "nao_encontrado"),
      r([], "erro"),
    ]);
    assert.deepEqual(summary, { consulted: 4, withEmails: 2, withSpecific: 1, failed: 1 });
  });
});

const htmlResponse = (html: string) =>
  new Response(html, { status: 200, headers: { "content-type": "text/html" } });

describe("searchPlaceEmails (servidor, transporte simulado)", () => {
  const noCache = { get: async () => null, set: async () => undefined };
  const noFiscal = async () => null;

  it("extrai e-mails da home e da página de contato com a origem de cada um", async () => {
    const transport = async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/robots.txt")) return new Response("not found", { status: 404 });
      if (u === "https://empresa.com.br/") return htmlResponse(`<a href="/contato">Fale conosco</a> contato@empresa.com.br`);
      if (u === "https://empresa.com.br/contato") return htmlResponse(`comercial@empresa.com.br`);
      return new Response("not found", { status: 404 });
    };
    const r = await searchPlaceEmails(
      { key: "p1", name: "Empresa", website: "https://empresa.com.br" },
      { scan: (site) => scanSiteEmails(site, transport as typeof fetch), cache: noCache, fiscal: noFiscal },
    );
    assert.equal(r.status, "encontrado");
    assert.deepEqual(r.contacts.map(c => c.email).sort(), ["comercial@empresa.com.br", "contato@empresa.com.br"]);
    assert.equal(r.contacts.find(c => c.email === "comercial@empresa.com.br")?.page, "https://empresa.com.br/contato");
    assert.equal(r.contacts.find(c => c.email === "comercial@empresa.com.br")?.kind, "comercial");
  });

  it("respeita robots.txt que bloqueia a leitura", async () => {
    const transport = async (url: string | URL | Request) =>
      String(url).endsWith("/robots.txt") ? htmlResponse("User-agent: *\nDisallow: /") : htmlResponse("contato@empresa.com.br");
    const r = await searchPlaceEmails(
      { key: "p1", name: "Empresa", website: "https://empresa.com.br" },
      { scan: (site) => scanSiteEmails(site, transport as typeof fetch), cache: noCache, fiscal: noFiscal },
    );
    assert.equal(r.status, "site_bloqueado");
    assert.deepEqual(r.contacts, []);
  });

  it("sem site, usa o e-mail do cadastro fiscal como geral", async () => {
    const r = await searchPlaceEmails(
      { key: "p1", name: "Empresa", website: "", cnpj: "00000000000191" },
      { cache: noCache, fiscal: async () => ({ email: "fiscal@contador.com.br", website: "" }) },
    );
    assert.equal(r.status, "encontrado");
    assert.deepEqual(r.contacts[0], { email: "fiscal@contador.com.br", kind: "geral", page: "", source: "fiscal" });
  });

  it("reutiliza o cache do domínio sem nova leitura", async () => {
    const cached: SiteEmailResult = {
      key: "outro", name: "Outra", cnpj: "", site: "https://empresa.com.br",
      contacts: [contact("contato@empresa.com.br")], status: "encontrado", note: "", checkedAt: "", fromCache: false,
    };
    let scans = 0;
    const r = await searchPlaceEmails(
      { key: "p1", name: "Empresa", website: "https://empresa.com.br" },
      { scan: async () => { scans++; return null; }, cache: { get: async () => cached, set: async () => undefined }, fiscal: noFiscal },
    );
    assert.equal(scans, 0);
    assert.equal(r.fromCache, true);
    assert.equal(r.key, "p1");
    assert.equal(r.contacts[0].email, "contato@empresa.com.br");
  });

  it("uma falha em uma empresa não derruba as demais do lote", async () => {
    const out = await searchPlacesEmails(
      [{ key: "ok", name: "Boa", website: "https://boa.com.br" }, { key: "ruim", name: "Ruim", website: "https://ruim.com.br" }],
      {
        scan: async (site) => {
          if (site.includes("ruim")) throw new Error("falhou");
          return { contacts: [contact("contato@boa.com.br", "site", site)], blocked: false, pages: 1 };
        },
        cache: noCache, fiscal: noFiscal,
      },
    );
    assert.equal(out[0].status, "encontrado");
    assert.equal(out[1].status, "erro");
  });
});
