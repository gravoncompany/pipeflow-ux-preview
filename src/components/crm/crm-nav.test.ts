import { test } from "node:test";
import assert from "node:assert/strict";
import { mainAreaActive, MAIN_NAV_ITEMS } from "./crm-nav";
import { isAreaItemActive } from "./area-nav";

const contatos = { to: "/clientes", label: "Contatos", match: ["/clientes", "/contatos"] };
const clientes = { to: "/clientes", nested: true };
const todos = { to: "/contatos" };

test("cada página filha pertence somente à área principal correspondente", () => {
  const cases = [["/pos-venda", "Atendimento"], ["/pos-venda/saude", "Atendimento"], ["/clientes/abc", "Atendimento"], ["/agenda/reunioes", "Atendimento"], ["/automacoes/123", "Campanhas"], ["/fluxos-email", "Campanhas"], ["/financeiro/custos", "Gestão"], ["/projetos/concluidas", "Gestão"]];
  for (const [path, label] of cases) assert.deepEqual(MAIN_NAV_ITEMS.filter((i) => mainAreaActive(i,path)).map((i) => i.label), [label]);
});

test("Contatos fica ativo em Clientes, na ficha do cliente e em Todos os contatos", () => {
  assert.equal(mainAreaActive(contatos, "/clientes"), true);
  assert.equal(mainAreaActive(contatos, "/clientes/abc"), true);
  assert.equal(mainAreaActive(contatos, "/contatos"), true);
  assert.equal(mainAreaActive(contatos, "/campanhas"), false);
});

test("CRM fica ativo no quadro e na Análise de Funis, sem cobrir outras áreas", () => {
  const crm = { to: "/", label: "CRM", match: ["/", "/funil"] };
  assert.equal(mainAreaActive(crm, "/"), true);
  assert.equal(mainAreaActive(crm, "/funil"), true);
  assert.equal(mainAreaActive(crm, "/dashboard"), false);
  assert.equal(mainAreaActive(crm, "/whatsapp"), false);
});

test("Atendimento cobre Conversas, Clientes e Agenda", () => {
  const conversas = { to: "/whatsapp", label: "Conversas" };
  const clientesItem = { to: "/clientes", label: "Clientes", match: ["/clientes", "/contatos"] };
  const agenda = { to: "/agenda", label: "Agenda" };
  assert.equal(mainAreaActive(conversas, "/whatsapp"), true);
  assert.equal(mainAreaActive(clientesItem, "/clientes/abc"), true);
  assert.equal(mainAreaActive(clientesItem, "/contatos"), true);
  assert.equal(mainAreaActive(agenda, "/agenda"), true);
  assert.equal(mainAreaActive(agenda, "/agenda/reunioes"), true);
  assert.equal(mainAreaActive(conversas, "/agenda"), false);
});

test("Campanhas cobre campanhas, fluxos e automações", () => {
  const campanhas = { to: "/campanhas", label: "Campanhas" };
  const fluxos = { to: "/fluxos-email", label: "Fluxos de E-mail" };
  const automacoes = { to: "/automacoes", label: "Automações", match: ["/automacoes"] };
  assert.equal(mainAreaActive(campanhas, "/campanhas"), true);
  assert.equal(mainAreaActive(campanhas, "/campanhas/whatsapp"), true);
  assert.equal(mainAreaActive(fluxos, "/fluxos-email"), true);
  assert.equal(mainAreaActive(automacoes, "/automacoes"), true);
  assert.equal(mainAreaActive(automacoes, "/automacoes/123"), true);
  assert.equal(mainAreaActive(campanhas, "/automacoes"), false);
});

test("submenu mantém Clientes destacado na ficha interna do cliente", () => {
  assert.equal(isAreaItemActive(clientes, "/clientes/123"), true);
  assert.equal(isAreaItemActive(todos, "/clientes/123"), false);
  assert.equal(isAreaItemActive(todos, "/contatos/"), true);
});

test("Prospecção B2B: a etapa 1 fica ativa em todas as fontes de busca, e só nelas", () => {
  const step1 = { to: "/prospeccao-b2b", also: ["/prospeccao-b2b/instagram", "/prospeccao-b2b/receita-federal", "/prospeccao-b2b/importar-listas"] };
  for (const p of ["/prospeccao-b2b", "/prospeccao-b2b/instagram", "/prospeccao-b2b/receita-federal/", "/prospeccao-b2b/importar-listas"]) assert.equal(isAreaItemActive(step1, p), true, p);
  for (const p of ["/prospeccao-b2b/revisar", "/prospeccao-b2b/primeiro-contato"]) assert.equal(isAreaItemActive(step1, p), false, p);
});
