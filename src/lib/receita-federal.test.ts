import { test } from "node:test";
import assert from "node:assert/strict";
import { receitaSearch, receitaCompany, receitaApiUrl, receitaResponse, type ReceitaRow } from "./receita-federal";
const row: ReceitaRow = { cnpj: "12345678000199", razao_social: null, nome_fantasia: null, cnae_principal: "7319002", situacao_cadastral: "02", municipio_codigo: "8105", municipio: null, uf: "SC", endereco: null, cep: null, telefone: null, email: null, porte: null, data_abertura: null };
test("CNAE permite pesquisa sem dados complementares; filtros combinados e limite máximo 100", () => {
  const query = receitaSearch.parse({ cnae: "7319002", municipality: "8105", hasEmail: true, pageSize: 100 });
  assert.equal(query.cnae, "7319002"); assert.equal(query.municipality, "8105"); assert.equal(query.uf, "SC"); assert.equal(query.hasEmail, true);
  assert.equal(receitaSearch.safeParse({ pageSize: 101 }).success, false);
  assert.equal(receitaSearch.safeParse({ uf: "PR" }).success, false);
});
test("dados ausentes permanecem vazios, sem nome fictício, cidade inventada ou WhatsApp inferido", () => {
  const company = receitaCompany({ ...row, telefone: "(48) 3333-4444" }, "2026-10");
  assert.equal(company.legalName, ""); assert.equal(company.tradeName, "");
  // O código 8105 resolve para o nome oficial do município (tabela RFB), sem inventar cidade.
  assert.equal(company.city, "Florianópolis");
  assert.equal(company.placeId, ""); assert.deepEqual(company.whatsappNumbers, []);
  assert.deepEqual(company.phones, ["4833334444"]); assert.match(company.sourceReference, /Receita Federal.*2026-10/);
  assert.equal(company.sourceReference.includes("Google"), false);
  assert.equal("identityConfirmed" in company, false);
});
test("API só usa HTTPS em domínio público sem credenciais nem porta de banco", () => {
  assert.equal(receitaApiUrl("https://receita.example.com/v1/estabelecimentos").protocol, "https:");
  for (const url of ["http://receita.example.com", "https://127.0.0.1", "https://localhost", "https://user:pass@receita.example.com", "https://receita.example.com:5432", "https://receita.internal", "https://[::1]"]) assert.throws(() => receitaApiUrl(url));
});
test("resposta não aceita mais de 100 empresas ou dados fora de SC", () => {
  const response = { rows: [row], total: 1, page: 1, pageSize: 50, competence: "2026-10", updatedAt: "2026-11-06T21:47:00.000Z" };
  assert.equal(receitaResponse.safeParse(response).success, true);
  assert.equal(receitaResponse.safeParse({ ...response, rows: Array(101).fill(row) }).success, false);
  assert.equal(receitaResponse.safeParse({ ...response, rows: [{ ...row, uf: "SP" }] }).success, false);
});test("consulta sem filtros é recusada; filtros mínimos aceitos", async () => {
  const { hasReceitaFilter } = await import("./receita-federal");
  assert.equal(hasReceitaFilter(receitaSearch.parse({})), false);
  assert.equal(hasReceitaFilter(receitaSearch.parse({ hasEmail: true, status: "02" })), false);
  assert.equal(hasReceitaFilter(receitaSearch.parse({ cnae: "7319002" })), true);
  assert.equal(hasReceitaFilter(receitaSearch.parse({ municipality: "8105" })), true);
});
