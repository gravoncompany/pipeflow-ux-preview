import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_GROUPS, CLIENT_TABS, resolveClientSection, isClientSection } from "./client-tabs";

test("todas as abas antigas, exceto Cadastro, pertencem a exatamente um grupo", () => {
  for (const t of CLIENT_TABS) {
    const owners = CLIENT_GROUPS.filter((g) => (g.tabs as readonly string[]).includes(t.key));
    assert.equal(owners.length, t.key === "cadastro" ? 0 : 1, t.key);
  }
});

test("endereços antigos continuam abrindo a aba certa dentro do grupo", () => {
  assert.deepEqual(resolveClientSection("conversas"), { group: "relacionamento", tab: "conversas" });
  assert.deepEqual(resolveClientSection("posvenda"), { group: "inteligencia", tab: "posvenda" });
  assert.deepEqual(resolveClientSection("entregas"), { group: "entregas", tab: "projetos" });
  assert.deepEqual(resolveClientSection("cadastro"), { group: "visao", tab: "cadastro" });
  assert.deepEqual(resolveClientSection(undefined), { group: "visao", tab: "visao" });
  assert.equal(isClientSection("relacionamento"), true);
  assert.equal(isClientSection("xpto"), false);
});
