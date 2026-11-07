import { test } from "node:test";
import assert from "node:assert/strict";
import { contactStage, currentB2bSelection, freshB2bSearch, firstContactNote, latestFirstContact, parseB2bSession, parseB2bStep, removeSelected } from "./b2b-flow";

test("abordagem registrada vence rascunhos; revisado vence preparado", () => {
  const drafts = [{ lead_id: "a", state: "draft" }, { lead_id: "b", state: "draft" }, { lead_id: "b", state: "reviewed" }];
  assert.equal(contactStage("a", drafts, new Set()), "preparada");
  assert.equal(contactStage("b", drafts, new Set()), "revisada");
  assert.equal(contactStage("c", drafts, new Set()), "aguardando");
  assert.equal(contactStage("a", drafts, new Set(["a"])), "abordada");
});

test("só reconhece abordagens gravadas com o texto fixo e devolve a mais recente", () => {
  const history = [
    { text: firstContactNote("email", "Enviei apresentação"), date: "2026-11-01T10:00:00.000Z" },
    { text: firstContactNote("whatsapp", ""), date: "2026-11-03T10:00:00.000Z" },
    { text: "Primeiro contato B2B combinado para semana que vem", date: "2026-11-05T10:00:00.000Z" },
    { text: "Ligação qualquer", date: "2026-11-06T10:00:00.000Z" },
  ];
  assert.deepEqual(latestFirstContact(history), { date: "2026-11-03T10:00:00.000Z", channel: "WhatsApp" });
  assert.equal(latestFirstContact([{ text: "Outra nota", date: "2026-11-01T10:00:00.000Z" }]), null);
  assert.equal(latestFirstContact(null), null);
});

test("remover da revisão tira só os itens escolhidos, mantendo a ordem", () => {
  assert.deepEqual(removeSelected(["a", "b", "c"], ["b"]), ["a", "c"]);
});

test("sessão salva volta com seleção e modo; dados corrompidos são ignorados", () => {
  const raw = JSON.stringify({ v: 1, filters: { segment: "x", city: "y", state: "PR" }, searched: null, places: [{ id: "p1" }], cursor: null, selected: ["p1"], prepared: {}, enriched: {}, cnpjStatus: {}, view: "list", imported: 2 });
  const s = parseB2bSession(raw)!;
  assert.deepEqual(s.selected, ["p1"]);
  assert.equal(s.view, "list");
  assert.equal(s.imported, 2);
  assert.equal(parseB2bSession("{oops"), null);
  assert.equal(parseB2bSession(JSON.stringify({ v: 2 })), null);
});

test("etapa inválida na URL abre a busca", () => {
  assert.equal(parseB2bStep("revisar"), "revisar");
  assert.equal(parseB2bStep("qualquer"), undefined);
});

test("nova pesquisa limpa resultados e seleção anteriores, inclusive se repetir empresas", () => {
  const old = { v: 1 as const, filters: { city: "Curitiba", onlySite: true, onlyPhone: true, onlyRated: true }, searched: { city: "Curitiba" }, places: [{ id: "anterior" }], cursor: "pagina-2", selected: ["anterior"], prepared: { anterior: { placeId: "anterior" } }, enriched: { anterior: { cnpj: "123" } }, cnpjStatus: { anterior: "identificado" }, view: "list" as const, imported: 2, leadIds: ["crm-1", "crm-2"] };
  const next = freshB2bSearch(old, { city: "São Paulo" });
  assert.deepEqual(next.places, []);
  assert.deepEqual(next.selected, []);
  assert.equal(next.cursor, null);
  assert.deepEqual(next.prepared, {});
  assert.deepEqual(next.enriched, {});
  assert.deepEqual(next.cnpjStatus, {});
  assert.deepEqual(next.searched, { city: "São Paulo" });
  assert.equal(next.filters, old.filters);
  assert.equal(next.view, "list");
  assert.deepEqual(next.leadIds, ["crm-1", "crm-2"]);
  assert.equal(next.imported, 2);
  assert.deepEqual(old.selected, ["anterior"]);
});

test("contador, lote e importação excluem IDs e cadastros Maps de pesquisas anteriores", () => {
  assert.deepEqual(currentB2bSelection(["antiga", "nova", "nova", "manual-proprio", "desconhecida"], [{ id: "nova" }], { antiga: { placeId: "antiga" }, "manual-proprio": { placeId: "" } }), ["nova", "manual-proprio"]);
});

test("seleção Receita não exige revisão antecipada nem identificador Maps e elimina duplicados", () => {
  const key = "receita-12345678000199";
  assert.deepEqual(currentB2bSelection([key, key, "receita-outra", "maps-antigo"], [], {}, { [key]: { cnpj: "12345678000199", placeId: "" } }), [key]);
  assert.deepEqual(currentB2bSelection([key], [], {}, { [key]: { cnpj: "99999999000199", placeId: "" } }), []);
});
