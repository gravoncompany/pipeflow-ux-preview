import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  ACCUMULATED_MILESTONES,
  MONTHLY_MILESTONES,
  brl,
  journeyProgress,
} from "./gravon-universe-journey";
import {
  CELEBRATION_STORAGE_PREFIX,
  celebrationMessage,
  celebrationScope,
  evaluateCelebration,
  readBaseline,
  simulatedValueFor,
  writeBaseline,
  type BaselineStorage,
} from "./gravon-universe-celebration";

function memoryStorage(): BaselineStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** Simula aberturas sucessivas da tela, como o componente faz. */
function visit(storage: BaselineStorage, scope: string | null, achieved: number) {
  if (!scope) return [];
  const r = evaluateCelebration(readBaseline(storage, scope), achieved);
  writeBaseline(storage, scope, r.baseline);
  return r.indices;
}

describe("Gravon Universe · celebração", () => {
  it("primeira abertura não celebra metas antigas", () => {
    assert.deepEqual(evaluateCelebration(null, 3), { indices: [], baseline: 3 });
  });

  it("celebra uma meta recém-conquistada", () => {
    assert.deepEqual(evaluateCelebration(2, 3), { indices: [2], baseline: 3 });
  });

  it("várias metas simultâneas geram uma única celebração resumida", () => {
    const r = evaluateCelebration(1, 4);
    assert.deepEqual(r.indices, [1, 2, 3]);
    const msg = celebrationMessage(ACCUMULATED_MILESTONES, r.indices);
    assert.equal(msg.title, "3 conquistas desbloqueadas");
    assert.equal(msg.detail, `Júpiter, Saturno e Urano · até ${brl(500_000)}`);
  });

  it("meta ainda não alcançada não celebra", () => {
    const achieved = journeyProgress(9_999, MONTHLY_MILESTONES).achieved;
    assert.deepEqual(evaluateCelebration(0, achieved).indices, []);
  });

  it("atualizar a página não repete a celebração", () => {
    const s = memoryStorage();
    const scope = "acumulada:2026";
    assert.deepEqual(visit(s, scope, 1), []);
    assert.deepEqual(visit(s, scope, 2), [1]);
    assert.deepEqual(visit(s, scope, 2), []);
    assert.deepEqual(visit(s, scope, 2), []);
    assert.equal(s.data.get(CELEBRATION_STORAGE_PREFIX + scope), "2");
  });

  it("jornadas usam referências independentes", () => {
    const s = memoryStorage();
    const mensal = celebrationScope("mensal", 2026, 10, 10);
    const acumulada = celebrationScope("acumulada", 2026, 10, 10);
    assert.notEqual(mensal, acumulada);
    visit(s, mensal, 0);
    visit(s, acumulada, 0);
    assert.deepEqual(visit(s, mensal, 2), [0, 1]);
    assert.deepEqual(visit(s, acumulada, 1), [0]);
    assert.deepEqual(visit(s, mensal, 2), []);
  });

  it("consultar meses anteriores nunca celebra nem altera a referência", () => {
    const s = memoryStorage();
    assert.equal(celebrationScope("mensal", 2026, 10, 9), null);
    assert.deepEqual(visit(s, celebrationScope("mensal", 2026, 10, 9), 5), []);
    assert.equal(s.data.size, 0);
  });

  it("cada mês tem escopo próprio (reinício mensal)", () => {
    assert.equal(celebrationScope("mensal", 2026, 9, 9), "mensal:2026-10");
    assert.equal(celebrationScope("mensal", 2026, 10, 10), "mensal:2026-11");
    assert.equal(celebrationScope("acumulada", 2026, 10, 3), "acumulada:2026");
    assert.equal(celebrationScope("acumulada", 2026, -1, -1), null);
  });

  it("correção financeira rebloqueia sem celebrar e celebra a reconquista", () => {
    const s = memoryStorage();
    const scope = "acumulada:2026";
    visit(s, scope, 3);
    assert.deepEqual(visit(s, scope, 2), []);
    assert.equal(readBaseline(s, scope), 2);
    assert.deepEqual(visit(s, scope, 3), [2]);
  });

  it("ignora referência inválida e armazenamento indisponível", () => {
    const s = memoryStorage();
    s.data.set(CELEBRATION_STORAGE_PREFIX + "x", "abc");
    assert.equal(readBaseline(s, "x"), null);
    const broken: BaselineStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(readBaseline(broken, "x"), null);
    assert.doesNotThrow(() => writeBaseline(broken, "x", 2));
    assert.equal(readBaseline(null, "x"), null);
  });

  it("mensagem para uma conquista e simulação de laboratório", () => {
    assert.deepEqual(celebrationMessage(MONTHLY_MILESTONES, [0]), {
      title: "Conquista desbloqueada",
      detail: `Lua · ${brl(10_000)}`,
    });
    assert.equal(simulatedValueFor(MONTHLY_MILESTONES, 0, 1), 10_000);
    assert.equal(simulatedValueFor(ACCUMULATED_MILESTONES, 0, 3), 250_000);
    assert.equal(simulatedValueFor(ACCUMULATED_MILESTONES, 9, 3), 10_000_000);
  });
});
