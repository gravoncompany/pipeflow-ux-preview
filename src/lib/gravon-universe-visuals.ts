// Identidade visual dos planetas e da galáxia do Gravon Universe.
// Somente apresentação: não altera metas, cálculos nem estados das jornadas.

export type PlanetKind = "rocky" | "gas" | "earth" | "ice" | "star" | "rust" | "clouds";

export type PlanetVisual = {
  kind: PlanetKind;
  /** Cores principais (hex) usadas pela textura procedural: clara, base, escura. */
  colors: [string, string, string];
  /** Cor da atmosfera/halo. */
  atmosphere: string;
  /** Intensidade da atmosfera (0–1.5). */
  glow: number;
  /** Velocidade de rotação (radianos por segundo). */
  spin: number;
  /** Inclinação do eixo (radianos). */
  tilt: number;
  seed: number;
  ring?: { inner: number; outer: number; color: string };
};

export const KIND_CODE: Record<PlanetKind, number> = {
  rocky: 0,
  gas: 1,
  earth: 2,
  ice: 3,
  star: 4,
  rust: 5,
  clouds: 6,
};

export const PLANET_VISUALS: Record<string, PlanetVisual> = {
  // Jornada Mensal
  lua: {
    kind: "rocky",
    colors: ["#e9e5dc", "#a39e94", "#4a463f"],
    atmosphere: "#d9d2c3",
    glow: 0.25,
    spin: 0.05,
    tilt: 0.1,
    seed: 1.3,
  },
  mercurio: {
    kind: "rocky",
    colors: ["#e2c9a4", "#93785a", "#3b2c20"],
    atmosphere: "#e7c38e",
    glow: 0.3,
    spin: 0.06,
    tilt: 0.05,
    seed: 7.9,
  },
  venus: {
    kind: "clouds",
    colors: ["#fbe7b5", "#d9a95c", "#7a5222"],
    atmosphere: "#ffd88a",
    glow: 0.75,
    spin: 0.035,
    tilt: 0.05,
    seed: 3.1,
  },
  terra: {
    kind: "earth",
    colors: ["#6f9a4e", "#1f5f96", "#eef4f7"],
    atmosphere: "#7cc4ff",
    glow: 0.85,
    spin: 0.08,
    tilt: 0.41,
    seed: 5.7,
  },
  marte: {
    kind: "rust",
    colors: ["#e08a5a", "#a9461f", "#4a170a"],
    atmosphere: "#f2a27a",
    glow: 0.45,
    spin: 0.075,
    tilt: 0.44,
    seed: 9.2,
  },
  // Jornada Acumulada
  ceres: {
    kind: "rocky",
    colors: ["#cfc9bc", "#7d776c", "#2f2b26"],
    atmosphere: "#bdb5a6",
    glow: 0.2,
    spin: 0.07,
    tilt: 0.07,
    seed: 11.4,
  },
  jupiter: {
    kind: "gas",
    colors: ["#f3dcb7", "#c08953", "#6b3a1c"],
    atmosphere: "#f4c48a",
    glow: 0.5,
    spin: 0.12,
    tilt: 0.05,
    seed: 2.2,
  },
  saturno: {
    kind: "gas",
    colors: ["#f8e9c2", "#d3ad6a", "#7d5a2a"],
    atmosphere: "#f6d79a",
    glow: 0.45,
    spin: 0.11,
    tilt: 0.47,
    seed: 4.6,
    ring: { inner: 1.35, outer: 2.25, color: "#ead6a4" },
  },
  urano: {
    kind: "ice",
    colors: ["#d8f7f4", "#78c6cc", "#2b6b72"],
    atmosphere: "#a6f1f2",
    glow: 0.7,
    spin: 0.09,
    tilt: 1.2,
    seed: 6.8,
    ring: { inner: 1.55, outer: 1.75, color: "#bfe9ea" },
  },
  netuno: {
    kind: "ice",
    colors: ["#a9c2ff", "#3a5fd6", "#101d5e"],
    atmosphere: "#7d9cff",
    glow: 0.8,
    spin: 0.1,
    tilt: 0.49,
    seed: 8.3,
  },
  plutao: {
    kind: "rocky",
    colors: ["#f2e1cf", "#b48f74", "#4b3326"],
    atmosphere: "#e9d2bd",
    glow: 0.3,
    spin: 0.04,
    tilt: 0.3,
    seed: 12.9,
  },
  sirius: {
    kind: "star",
    colors: ["#ffffff", "#c9dcff", "#6f8fd8"],
    atmosphere: "#cfe0ff",
    glow: 1.1,
    spin: 0.03,
    tilt: 0,
    seed: 13.7,
  },
  vega: {
    kind: "star",
    colors: ["#f6f9ff", "#b3c8ff", "#5a73c9"],
    atmosphere: "#bcd0ff",
    glow: 1.1,
    spin: 0.03,
    tilt: 0,
    seed: 14.1,
  },
  polaris: {
    kind: "star",
    colors: ["#fffbe9", "#ffe39a", "#c98a1c"],
    atmosphere: "#ffe7a6",
    glow: 1.2,
    spin: 0.03,
    tilt: 0,
    seed: 15.5,
  },
  sol: {
    kind: "star",
    colors: ["#fff6cf", "#ffb43a", "#c2470b"],
    atmosphere: "#ffc25a",
    glow: 1.45,
    spin: 0.025,
    tilt: 0,
    seed: 16.2,
  },
};

const FALLBACK: PlanetVisual = {
  kind: "rocky",
  colors: ["#e6e1d6", "#9a948a", "#3d3a35"],
  atmosphere: "#d9d2c3",
  glow: 0.25,
  spin: 0.05,
  tilt: 0.1,
  seed: 1,
};

export const visualFor = (id: string): PlanetVisual => PLANET_VISUALS[id] ?? FALLBACK;

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---- Galáxia procedural (gerada uma vez no navegador, sem imagens externas) ----

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed),
    b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed),
    d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm2(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0,
    amp = 0.5,
    f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, y * f, seed + i * 17);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

export type GalaxyOptions = {
  /** Centro do núcleo em coordenadas normalizadas da cena. */
  cx?: number;
  cy?: number;
  seed?: number;
};

/**
 * Gera os pixels RGBA da galáxia espiral dourada com nebulosas e estrelas distantes.
 * Determinístico e sem dependências do DOM (testável no Node).
 */
export function galaxyPixels(
  width: number,
  height: number,
  opts: GalaxyOptions = {},
): Uint8ClampedArray<ArrayBuffer> {
  const { cx = 0.66, cy = 0.5, seed = 2026 } = opts;
  const out = new Uint8ClampedArray(width * height * 4);
  const aspect = width / height;
  const rot = (-24 * Math.PI) / 180;
  const cr = Math.cos(rot),
    sr = Math.sin(rot);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const u = i / width,
        v = j / height;
      const dx = (u - cx) * aspect,
        dy = v - cy;
      // Disco inclinado: rotação + achatamento.
      const gx = dx * cr - dy * sr;
      const gy = (dx * sr + dy * cr) / 0.42;
      const r = Math.sqrt(gx * gx + gy * gy) + 1e-4;
      const theta = Math.atan2(gy, gx);
      const warp = fbm2(u * 5, v * 5, seed, 3) * 1.6;
      const phase = 2 * theta - 4.2 * Math.log(r) + warp;
      const armFade = Math.min(1, Math.max(0, (r - 0.03) / 0.12));
      const arm = Math.pow(Math.max(0, Math.cos(phase)), 2.2) * armFade;
      const dust = Math.pow(Math.max(0, Math.cos(phase + 0.75)), 7) * armFade;
      const disk = Math.exp(-r * 2.6);
      const grain = 0.55 + 0.9 * fbm2(u * 22, v * 22, seed + 5, 3);
      const core = (Math.exp(-r * r * 70) * 1.5 + Math.exp(-r * 6) * 0.5) * 0.7;
      const lum = (arm * disk * 0.9 * grain + core) * (1 - dust * disk * 0.55);
      // Nebulosa ampla em tons dourados, discreta.
      const nebA = Math.pow(fbm2(u * 2.2 + 3, v * 2.2, seed + 9, 4), 2.4) * 0.26;
      const nebB =
        Math.pow(fbm2(u * 4.5 - 2, v * 4.5 + 1, seed + 21, 4), 3) * 0.3 * (0.4 + 0.6 * (1 - v));
      const neb = nebA + nebB;
      // Cores: núcleo branco-quente, braços dourados, bordas âmbar escuro.
      const t = Math.min(1, r * 1.8);
      let R = lum * (1.0 - 0.18 * t) + neb * 0.85;
      let G = lum * (0.9 - 0.32 * t) + neb * 0.58;
      let B = lum * (0.74 - 0.46 * t) + neb * 0.26;
      // Tonemap suave para preservar o preto profundo.
      R = 1 - Math.exp(-R * 1.25);
      G = 1 - Math.exp(-G * 1.25);
      B = 1 - Math.exp(-B * 1.25);
      // Vinheta nas bordas para manter a leitura.
      const vx = u - 0.5,
        vy = v - 0.5;
      const vig = Math.max(0, 1 - (vx * vx + vy * vy) * 1.6);
      const k = (j * width + i) * 4;
      out[k] = R * 255 * vig + 3;
      out[k + 1] = G * 255 * vig + 4;
      out[k + 2] = B * 255 * vig + 8;
      out[k + 3] = 255;
    }
  }
  // Estrelas distantes concentradas nos braços.
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const count = Math.round((width * height) / 200);
  const add = (i: number, j: number, b: number, warm: boolean) => {
    if (i < 0 || j < 0 || i >= width || j >= height) return;
    const k = (j * width + i) * 4;
    out[k] = Math.min(255, out[k] + b);
    out[k + 1] = Math.min(255, out[k + 1] + b * (warm ? 0.86 : 0.95));
    out[k + 2] = Math.min(255, out[k + 2] + b * (warm ? 0.6 : 1));
  };
  for (let n = 0; n < count; n++) {
    const i = Math.floor(rand() * width),
      j = Math.floor(rand() * height);
    const b = 40 + Math.pow(rand(), 3) * 215;
    const warm = rand() < 0.35;
    add(i, j, b, warm);
    if (b > 190) {
      add(i - 1, j, b * 0.35, warm);
      add(i + 1, j, b * 0.35, warm);
      add(i, j - 1, b * 0.35, warm);
      add(i, j + 1, b * 0.35, warm);
    }
  }
  return out;
}
