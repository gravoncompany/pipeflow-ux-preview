import { test } from "node:test";
import assert from "node:assert/strict";
import { literalDue, suggestTaskFromMessage } from "./message-task";
const base = new Date(2026, 10, 5, 10);
test("'amanhã' vira dia seguinte", () => assert.equal(literalDue("me manda amanhã", base), "2026-11-06"));
test("data 20/11 é usada", () => assert.equal(literalDue("entrega até 20/11", base), "2026-11-20"));
test("sem data mencionada não sugere prazo", () => assert.equal(literalDue("pode ajustar o anúncio?", base), null));
test("título usa a primeira frase", () => assert.equal(suggestTaskFromMessage("Troca a arte do post. Obrigado!", base.toISOString()).title, "Troca a arte do post."));
