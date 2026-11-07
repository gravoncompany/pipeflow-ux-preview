import { test } from "node:test";
import assert from "node:assert/strict";
import { receitaSearch, hasReceitaFilter, receitaRowHasEmail, receitaRowHasPhone } from "./receita-federal";
import { searchReceitaCnaes, receitaCnaeDescription, RECEITA_CNAES } from "./receita-cnae";
import { searchReceitaMunicipios, receitaMunicipioName, RECEITA_MUNICIPIOS } from "./receita-municipios";
import { receitaParams } from "./receita-federal.server";

test("busca de CNAE sugere códigos oficiais por atividade", () => {
  for (const term of ["refrigeração", "clínica", "contabilidade", "limpeza"]) {
    const found = searchReceitaCnaes(term);
    assert.ok(found.length > 0, `sem sugestões para ${term}`);
    assert.ok(found.every(c => /^\d{7}$/.test(c.code) && c.description.length > 3));
  }
  const refr = searchReceitaCnaes("refrigeração");
  assert.ok(refr.some(c => c.description.toLowerCase().includes("refrigeração")));
});

test("descrição oficial do CNAE é encontrada pelo código", () => {
  assert.ok(receitaCnaeDescription("8610101").length > 3);
  assert.equal(receitaCnaeDescription("0000000"), "");
  assert.equal(receitaCnaeDescription(null), "");
  assert.ok(RECEITA_CNAES.length > 1000);
});

test("municípios de SC têm código da Receita e nome oficial", () => {
  assert.equal(RECEITA_MUNICIPIOS.length, 295);
  assert.equal(receitaMunicipioName("8105"), "Florianópolis");
  assert.equal(receitaMunicipioName("8039"), "Balneário Camboriú");
  assert.equal(receitaMunicipioName("8179"), "Joinville");
  assert.equal(receitaMunicipioName("9999"), "");
});

test("busca de município por nome ignora acentos", () => {
  assert.ok(searchReceitaMunicipios("balneario camboriu").some(m => m.code === "8039"));
  assert.ok(searchReceitaMunicipios("Florianópolis").some(m => m.code === "8105"));
  assert.ok(searchReceitaMunicipios("joinville").some(m => m.code === "8179"));
  assert.deepEqual(searchReceitaMunicipios("x"), []);
});

test("CNAEs selecionados viram filtro OR válido no PostgREST", () => {
  const q = receitaSearch.parse({ cnaes: ["8610101", "8630503"] });
  const p = receitaParams(q);
  assert.equal(p.get("cnae_principal"), "in.(8610101,8630503)");
  const one = receitaParams(receitaSearch.parse({ cnaes: ["8610101"] }));
  assert.equal(one.get("cnae_principal"), "eq.8610101");
});

test("CNAE selecionado combinado com prefixo digitado usa or=", () => {
  const p = receitaParams(receitaSearch.parse({ cnaes: ["8610101"], cnae: "43" }));
  assert.equal(p.get("or"), "(cnae_principal.in.(8610101),cnae_principal.like.43*)");
  assert.equal(p.get("cnae_principal"), null);
});

test("código CNAE direto de 7 dígitos entra na lista de seleção", () => {
  const p = receitaParams(receitaSearch.parse({ cnae: "8610101" }));
  assert.equal(p.get("cnae_principal"), "eq.8610101");
});

test("prefixo CNAE preserva comportamento atual (like)", () => {
  const p = receitaParams(receitaSearch.parse({ cnae: "86" }));
  assert.equal(p.get("cnae_principal"), "like.86*");
});

test("município pelo código da Receita e combinado com CNAEs", () => {
  const p = receitaParams(receitaSearch.parse({ municipality: "8039", cnaes: ["8610101", "8630503"] }));
  assert.equal(p.get("municipio_codigo"), "eq.8039");
  assert.equal(p.get("cnae_principal"), "in.(8610101,8630503)");
  assert.equal(p.get("uf"), "eq.SC");
});

test("cnaes contam como filtro obrigatório", () => {
  assert.equal(hasReceitaFilter(receitaSearch.parse({})), false);
  assert.equal(hasReceitaFilter(receitaSearch.parse({ cnaes: ["8610101"] })), true);
});

test("schema rejeita CNAE inválido e limita seleção", () => {
  assert.equal(receitaSearch.safeParse({ cnaes: ["123"] }).success, false);
  assert.equal(receitaSearch.safeParse({ cnaes: Array(21).fill("8610101") }).success, false);
});

test("filtro Com e-mail exclui nulo e texto vazio no PostgREST", () => {
  const p = receitaParams(receitaSearch.parse({ cnae: "86", hasEmail: true }));
  assert.deepEqual(p.getAll("email"), ["not.is.null", "neq."]);
  const sem = receitaParams(receitaSearch.parse({ cnae: "86" }));
  assert.deepEqual(sem.getAll("email"), []);
});

test("filtro Com telefone exclui nulo e texto vazio no PostgREST", () => {
  const p = receitaParams(receitaSearch.parse({ cnae: "86", hasPhone: true }));
  assert.deepEqual(p.getAll("telefone"), ["not.is.null", "neq."]);
});

test("filtro client-side só aceita e-mail válido e telefone com dígitos", () => {
  const base = { email: null, telefone: null };
  assert.equal(receitaRowHasEmail(base), false);
  assert.equal(receitaRowHasEmail({ ...base, email: "" }), false);
  assert.equal(receitaRowHasEmail({ ...base, email: "   " }), false);
  assert.equal(receitaRowHasEmail({ ...base, email: "sem-arroba" }), false);
  assert.equal(receitaRowHasEmail({ ...base, email: "contato@empresa.com.br" }), true);
  assert.equal(receitaRowHasPhone(base), false);
  assert.equal(receitaRowHasPhone({ ...base, telefone: "" }), false);
  assert.equal(receitaRowHasPhone({ ...base, telefone: "(48) 3333-4444" }), true);
});
