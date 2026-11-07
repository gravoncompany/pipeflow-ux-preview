import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { ACCUMULATED_MILESTONES, MONTHLY_MILESTONES } from "./gravon-universe-journey";
import {
  KIND_CODE,
  PLANET_VISUALS,
  galaxyPixels,
  hexToRgb,
  visualFor,
} from "./gravon-universe-visuals";

const all = [...MONTHLY_MILESTONES, ...ACCUMULATED_MILESTONES];
const HEX = /^#[0-9a-f]{6}$/i;

describe("Gravon Universe · identidade visual", () => {
  it("todo planeta das duas jornadas tem visual próprio e válido", () => {
    for (const m of all) {
      const v = PLANET_VISUALS[m.id];
      assert.ok(v, `sem visual para ${m.id}`);
      assert.ok(v.kind in KIND_CODE);
      for (const c of [...v.colors, v.atmosphere]) assert.match(c, HEX);
      if (v.ring) assert.ok(v.ring.inner > 1 && v.ring.outer > v.ring.inner);
    }
  });

  it("planetas não repetem a mesma combinação visual", () => {
    const keys = all.map((m) => JSON.stringify(PLANET_VISUALS[m.id].colors));
    assert.equal(new Set(keys).size, keys.length);
  });

  it("anéis e estrelas respeitam a definição das metas", () => {
    for (const m of all) {
      const v = visualFor(m.id);
      if (m.ring) assert.ok(v.ring, `${m.id} deveria ter anel`);
      if (m.star) assert.equal(v.kind, "star");
    }
  });

  it("converte cores e usa visual padrão para ids desconhecidos", () => {
    assert.deepEqual(hexToRgb("#ff0000"), [1, 0, 0]);
    assert.deepEqual(hexToRgb("inválido"), [1, 1, 1]);
    assert.equal(visualFor("desconhecido").kind, "rocky");
  });
});

describe("Gravon Universe · galáxia procedural", () => {
  it("é determinística, opaca e com o núcleo mais brilhante que as bordas", () => {
    const w = 120,
      h = 74;
    const a = galaxyPixels(w, h);
    assert.equal(a.length, w * h * 4);
    assert.deepEqual(a, galaxyPixels(w, h));
    for (let k = 3; k < a.length; k += 4) assert.equal(a[k], 255);
    const lum = (x: number, y: number) => {
      const k = (y * w + x) * 4;
      return a[k] + a[k + 1] + a[k + 2];
    };
    assert.ok(lum(Math.round(w * 0.66), Math.round(h * 0.5)) > lum(2, 2) + 150);
  });

  it("mantém tons dourados (vermelho ≥ azul) no núcleo", () => {
    const w = 100,
      h = 62;
    const a = galaxyPixels(w, h);
    const k = (Math.round(h * 0.5) * w + Math.round(w * 0.66)) * 4;
    assert.ok(a[k] >= a[k + 2]);
  });
});
