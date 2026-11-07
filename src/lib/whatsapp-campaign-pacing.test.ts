import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidPacing, estimateSeconds } from "./whatsapp-campaigns";
test("1 a 5 s com pausa a cada 80 é permitido", () => assert.equal(isValidPacing({ min: 1, max: 5, pauseEvery: 80, pauseSeconds: 120 }), true));
test("faixa acima do teto é recusada", () => assert.equal(isValidPacing({ min: 1, max: 601, pauseEvery: 80, pauseSeconds: 120 }), false));
test("pausa a cada 0 mensagens é recusada", () => assert.equal(isValidPacing({ min: 5, max: 10, pauseEvery: 0, pauseSeconds: 60 }), false));
test("24 mensagens a 1-5 s, pausa 60 s a cada 10 = 24*3 + 2*60", () => assert.equal(estimateSeconds(24, { min: 1, max: 5, pauseEvery: 10, pauseSeconds: 60 }), 192));
