// Renderizador WebGL leve dos planetas do Gravon Universe.
// Cada planeta é um quad com esfera iluminada no fragment shader: textura procedural,
// atmosfera, anéis com profundidade, rotação e destaques. Sem dependências externas.
import { KIND_CODE, hexToRgb, type PlanetVisual } from "@/lib/gravon-universe-visuals";

export type PlanetDraw = {
  id: string;
  /** Centro e raio em pixels CSS do canvas. */
  x: number;
  y: number;
  radius: number;
  visual: PlanetVisual;
  /** Alvos animados (0–1). */
  locked: number;
  gold: number;
  hover: number;
  selected: number;
};

const VERT = `
attribute vec2 a_pos;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_extent;
uniform vec2 u_res;
varying vec2 v_p;
void main() {
  v_p = a_pos * u_extent;
  vec2 px = u_center + vec2(a_pos.x, -a_pos.y) * u_radius * u_extent;
  vec2 clip = px / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_p;
uniform float u_time;
uniform float u_kind;
uniform float u_seed;
uniform float u_spin;
uniform float u_tilt;
uniform float u_glow;
uniform float u_locked;
uniform float u_gold;
uniform float u_hover;
uniform float u_aa;
uniform float u_edge;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_atm;
uniform vec3 u_ring;
uniform vec3 u_ringColor;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 surface(vec3 q, float lat, out float spec) {
  spec = 0.0;
  vec3 sp = q * 1.0 + vec3(u_seed);
  if (u_kind < 0.5) {
    // Rochoso com crateras.
    float h = fbm(sp * 3.0);
    vec3 col = mix(u_c3, u_c1, smoothstep(0.25, 0.8, h));
    col = mix(col, u_c2, 0.35);
    float cr = noise(sp * 7.0);
    float crater = smoothstep(0.66, 0.72, cr) - smoothstep(0.72, 0.8, cr) * 0.6;
    col *= 0.82 + 0.35 * fbm(sp * 11.0);
    col = mix(col, u_c3, clamp(crater, 0.0, 1.0) * 0.55);
    return col;
  } else if (u_kind < 1.5) {
    // Gigante gasoso com faixas e tempestades.
    float warp = fbm(sp * vec3(2.0, 7.0, 2.0)) * 1.4;
    float band = 0.5 + 0.5 * sin((lat * 7.5 + warp) * 3.14159);
    vec3 col = mix(u_c1, u_c2, band);
    col = mix(col, u_c3, smoothstep(0.55, 0.85, fbm(sp * vec3(3.0, 12.0, 3.0))) * 0.45);
    float storm = smoothstep(0.16, 0.0, length(vec2(q.x - 0.35, (lat + 0.32) * 1.8)) - 0.0);
    col = mix(col, u_c3 * 1.25, storm * step(0.0, q.z) * 0.6);
    return col;
  } else if (u_kind < 2.5) {
    // Planeta com oceanos, continentes, gelo e nuvens.
    float land = fbm(sp * 2.4);
    float isLand = smoothstep(0.5, 0.53, land);
    vec3 landCol = mix(u_c1, vec3(0.55, 0.45, 0.3), smoothstep(0.55, 0.75, land));
    vec3 ocean = mix(u_c2 * 0.55, u_c2, smoothstep(0.3, 0.5, land));
    vec3 col = mix(ocean, landCol, isLand);
    col = mix(col, u_c3, smoothstep(0.78, 0.86, abs(lat)));
    spec = (1.0 - isLand) * 0.6;
    vec3 cq = q;
    cq.xz = rot(cq.xz, u_time * 0.02);
    float cloud = smoothstep(0.52, 0.75, fbm(cq * 3.2 + vec3(u_seed + 3.0)));
    col = mix(col, vec3(1.0), cloud * 0.85);
    spec *= 1.0 - cloud;
    return col;
  } else if (u_kind < 3.5) {
    // Gigante de gelo com faixas suaves.
    float t = 0.5 + 0.5 * sin(lat * 5.0 + fbm(sp * vec3(2.0, 6.0, 2.0)) * 1.8);
    vec3 col = mix(u_c2, u_c1, t * 0.55);
    col = mix(col, u_c3, smoothstep(0.6, 0.9, fbm(sp * 4.0)) * 0.35);
    return col;
  } else if (u_kind < 4.5) {
    // Estrela: granulação animada, emissiva.
    float g = fbm(sp * 6.0 + vec3(0.0, u_time * 0.06, 0.0));
    float g2 = fbm(sp * 14.0 - vec3(u_time * 0.04));
    return mix(u_c2, u_c1, smoothstep(0.3, 0.75, g * 0.7 + g2 * 0.5));
  } else if (u_kind < 5.5) {
    // Planeta desértico ferruginoso.
    float h = fbm(sp * 2.6);
    vec3 col = mix(u_c2, u_c1, smoothstep(0.3, 0.75, h));
    float dark = smoothstep(0.52, 0.68, fbm(sp * 4.5 + vec3(7.0)));
    col = mix(col, u_c3, dark * 0.6);
    col = mix(col, vec3(0.95, 0.9, 0.86), smoothstep(0.86, 0.92, abs(lat)));
    return col;
  }
  // Atmosfera densa com redemoinhos.
  vec3 w = sp * vec3(2.5, 1.2, 2.5);
  float swirl = fbm(w + vec3(fbm(w * 1.5 + vec3(u_time * 0.01))) * 1.8);
  return mix(u_c3, u_c1, smoothstep(0.25, 0.8, swirl)) * 0.85 + u_c2 * 0.2;
}

vec4 over(vec4 dst, vec3 rgb, float a) {
  return vec4(rgb * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}

void main() {
  vec2 p = v_p;
  float r = length(p);
  bool isStar = u_kind > 3.5 && u_kind < 4.5;
  // Luz principal lateral (esquerda) e contraluz quente (direita).
  vec3 L = normalize(vec3(-0.82, 0.3, 0.5));
  vec3 RIM = normalize(vec3(0.9, -0.05, 0.25));
  vec4 acc = vec4(0.0);

  // Halo/atmosfera externa (aditiva).
  float d = max(r - 1.0, 0.0);
  float haloK = isStar ? 3.2 : 11.0;
  float halo = exp(-d * haloK) * u_glow * (isStar ? 1.0 : 0.55) * step(1.0, r);
  halo *= 1.0 + u_hover * 0.6 + u_gold * 0.2;
  acc.rgb += u_atm * halo * (1.0 - u_locked * 0.75);

  // Anel: plano inclinado projetado ortograficamente.
  float ringA = 0.0;
  vec3 ringCol = vec3(0.0);
  bool ringFront = false;
  if (u_ring.x > 0.0) {
    vec2 pr = rot(p, -u_tilt * 0.35);
    float incl = 0.3;
    float ry = pr.y / sin(incl);
    float rr = length(vec2(pr.x, ry));
    float inner = u_ring.x;
    float outer = u_ring.y;
    ringA = smoothstep(inner, inner + 0.05, rr) * (1.0 - smoothstep(outer - 0.08, outer, rr));
    ringA *= 0.55 + 0.45 * sin(rr * 46.0 + noise(vec3(rr * 30.0, 0.0, u_seed)) * 3.0);
    ringA *= smoothstep(0.015, 0.05, abs(rr - (inner + outer) * 0.52));
    ringA *= u_ring.z;
    ringFront = pr.y < 0.0;
    // Sombra do planeta sobre a parte de trás do anel.
    float shadow = (!ringFront && abs(pr.x + 0.35) < 1.0 && ry > 0.0) ? 0.45 : 1.0;
    ringCol = u_ringColor * (0.55 + 0.45 * (0.6 + 0.4 * sin(rr * 9.0))) * shadow;
  }
  if (ringA > 0.0 && !ringFront) acc = over(acc, ringCol, ringA * 0.9);

  // Esfera.
  if (r < 1.0) {
    float z = sqrt(1.0 - r * r);
    vec3 n = vec3(p, z);
    vec3 q = n;
    q.xy = rot(q.xy, -u_tilt);
    q.xz = rot(q.xz, u_time * u_spin + u_seed);
    float lat = q.y;
    float spec;
    vec3 col = surface(q, lat, spec);
    if (isStar) {
      col *= 0.62 + 0.55 * pow(z, 0.45);
      col += u_atm * pow(1.0 - z, 2.0) * 0.5;
      col *= 1.15 + u_hover * 0.25;
    } else {
      float ndl = dot(n, L);
      float diff = smoothstep(-0.28, 1.0, ndl);
      // Mais definição e contraste na textura antes da luz.
      float tl = dot(col, vec3(0.299, 0.587, 0.114));
      col = clamp(mix(vec3(tl), col, 1.18), 0.0, 1.0);
      col = clamp((col - 0.5) * 1.12 + 0.5, 0.0, 1.0);
      vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
      float sp = pow(max(dot(n, H), 0.0), 48.0) * spec;
      col = col * (0.1 + 1.18 * diff) + vec3(1.0, 0.95, 0.85) * sp * 0.8;
      float rim = pow(1.0 - z, 3.0) * max(dot(n, RIM), 0.0);
      col += vec3(0.96, 0.78, 0.48) * rim * 0.55;
      float fres = pow(1.0 - z, 2.6);
      col += u_atm * fres * u_glow * (0.25 + 0.9 * clamp(ndl + 0.35, 0.0, 1.0));
      col *= 1.0 + u_hover * 0.22;
    }
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * 0.55, u_locked * 0.82);
    col *= 1.0 - u_locked * (isStar ? 0.45 : 0.25);
    float edge = 1.0 - smoothstep(1.0 - u_aa, 1.0, r);
    acc = over(acc, col, edge);
  }

  if (ringA > 0.0 && ringFront) {
    vec3 rc = mix(ringCol, vec3(dot(ringCol, vec3(0.33))) * 0.6, u_locked * 0.8);
    acc = over(acc, rc, ringA);
  }

  // Destaque dourado (próxima conquista / selecionado), aditivo.
  float thin = exp(-abs(r - 1.13) * 60.0) * 0.85;
  float soft = exp(-abs(r - 1.13) * 9.0) * 0.22 + exp(-d * 4.0) * 0.12 * step(1.0, r);
  float pulse = 0.88 + 0.12 * sin(u_time * 1.3);
  acc.rgb += (vec3(0.98, 0.84, 0.52) * thin + vec3(0.89, 0.66, 0.3) * soft) * u_gold * pulse;

  // Suaviza brilhos aditivos antes da borda do quad (evita contorno quadrado).
  float box = max(abs(p.x), abs(p.y));
  acc.rgb *= 1.0 - smoothstep(u_edge * 0.72, u_edge, box) * step(1.0, r);
  gl_FragColor = acc;
}`;

const UNIFORMS = [
  "u_center",
  "u_radius",
  "u_extent",
  "u_res",
  "u_time",
  "u_kind",
  "u_seed",
  "u_spin",
  "u_tilt",
  "u_glow",
  "u_locked",
  "u_gold",
  "u_hover",
  "u_aa",
  "u_edge",
  "u_c1",
  "u_c2",
  "u_c3",
  "u_atm",
  "u_ring",
  "u_ringColor",
] as const;
type UniformName = (typeof UNIFORMS)[number];

type Animated = { locked: number; gold: number; hover: number; selected: number };

export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl", { failIfMajorPerformanceCaveat: true });
  } catch {
    return false;
  }
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("GU_SHADER_CREATE");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`GU_SHADER_COMPILE: ${log}`);
  }
  return sh;
}

export class PlanetRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private loc = {} as Record<UniformName, WebGLUniformLocation | null>;
  private planets: PlanetDraw[] = [];
  private anim = new Map<string, Animated>();
  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private dirty = true;
  /** Sem rotação nem pulsação contínuas (prefers-reduced-motion). */
  reducedMotion = false;
  onLost?: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: "low-power",
      failIfMajorPerformanceCaveat: true,
    });
    if (!gl) throw new Error("GU_WEBGL_UNAVAILABLE");
    this.gl = gl;
    const program = gl.createProgram();
    if (!program) throw new Error("GU_PROGRAM_CREATE");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`GU_PROGRAM_LINK: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (const u of UNIFORMS) this.loc[u] = gl.getUniformLocation(program, u);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    canvas.addEventListener("webglcontextlost", this.handleLost);
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.stop();
    this.onLost?.();
  };

  resize(width: number, height: number, maxDpr = 2) {
    const dpr = Math.min(maxDpr, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.dirty = true;
    if (!this.running) this.frame(performance.now());
  }

  setPlanets(list: PlanetDraw[]) {
    this.planets = list;
    for (const p of list)
      if (!this.anim.has(p.id))
        this.anim.set(p.id, {
          locked: p.locked,
          gold: p.gold,
          hover: p.hover,
          selected: p.selected,
        });
    this.dirty = true;
    if (!this.running) this.frame(performance.now());
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    // O contexto não é descartado: o React pode remontar o componente no mesmo canvas.
    this.planets = [];
  }

  private frame(now: number) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.reducedMotion) this.time += dt;
    // Transições suaves dos estados.
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 8);
    let settling = false;
    for (const p of this.planets) {
      const a = this.anim.get(p.id)!;
      for (const key of ["locked", "gold", "hover", "selected"] as const) {
        const diff = p[key] - a[key];
        if (Math.abs(diff) > 0.002) settling = true;
        a[key] += diff * k;
      }
    }
    if (!this.running && !this.dirty && !settling) return;
    this.dirty = false;
    this.draw();
    if (!this.running && settling) requestAnimationFrame((t) => this.frame(t));
  }

  private draw() {
    const { gl, loc } = this;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(loc.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(loc.u_time, this.time);
    for (const p of this.planets) {
      const a = this.anim.get(p.id)!;
      const v = p.visual;
      const isStar = v.kind === "star";
      const scale = 1 + a.hover * 0.06 + a.selected * 0.08;
      const radius = p.radius * scale * this.dpr;
      const extent = v.ring ? v.ring.outer + 0.15 : isStar ? 2.1 : 1.45;
      const [c1, c2, c3] = v.colors.map(hexToRgb);
      gl.uniform2f(loc.u_center, p.x * this.dpr, p.y * this.dpr);
      gl.uniform1f(loc.u_radius, radius);
      gl.uniform1f(loc.u_extent, extent);
      gl.uniform1f(loc.u_edge, extent);
      gl.uniform1f(loc.u_kind, KIND_CODE[v.kind]);
      gl.uniform1f(loc.u_seed, v.seed);
      gl.uniform1f(loc.u_spin, v.spin);
      gl.uniform1f(loc.u_tilt, v.tilt);
      gl.uniform1f(loc.u_glow, v.glow);
      gl.uniform1f(loc.u_locked, a.locked);
      gl.uniform1f(loc.u_gold, Math.max(a.gold, a.selected));
      gl.uniform1f(loc.u_hover, a.hover);
      gl.uniform1f(loc.u_aa, Math.min(0.2, 1.5 / Math.max(1, radius)));
      gl.uniform3fv(loc.u_c1, c1);
      gl.uniform3fv(loc.u_c2, c2);
      gl.uniform3fv(loc.u_c3, c3);
      gl.uniform3fv(loc.u_atm, hexToRgb(v.atmosphere));
      gl.uniform3f(loc.u_ring, v.ring?.inner ?? 0, v.ring?.outer ?? 0, v.ring ? 1 : 0);
      gl.uniform3fv(loc.u_ringColor, hexToRgb(v.ring?.color ?? "#ffffff"));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
}
