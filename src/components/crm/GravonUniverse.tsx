import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BadgeCheck, Check, ChevronRight, Lock, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SCENE,
  achievementMonths,
  brl,
  buildSegments,
  compactBrl,
  pathFor,
  pointAtPosition,
  progressSegments,
  stars,
  milestoneState as stateOf,
  type Journey,
  type JourneyProgress,
  type MilestoneState,
  type Milestone,
  type MonthValue,
} from "@/lib/gravon-universe-journey";
import { galaxyPixels, visualFor } from "@/lib/gravon-universe-visuals";
import { celebrationMessage } from "@/lib/gravon-universe-celebration";
import { PlanetRenderer, webglAvailable, type PlanetDraw } from "./gravon-universe-gl";

const GOLD = "#e3b75f";
// Caixas laterais usam o azul da identidade Pipeflow (#6ea8fe/#2f6fed/#bcd4ff); a jornada e a linha do tempo mantêm o dourado.
const GEOMETRY = new Map<Journey["mode"], ReturnType<typeof buildSegments>>();
const segmentsFor = (journey: Journey) => {
  let segs = GEOMETRY.get(journey.mode);
  if (!segs) GEOMETRY.set(journey.mode, (segs = buildSegments(journey.nodes)));
  return segs;
};
const MID_STARS = stars(110, 7);
const NEAR_STARS = stars(26, 99);
const pct = (v: number, total: number) => `${(v / total) * 100}%`;
const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + (i % 2) * 0.22;
  return { a, d: 1.25 + ((i * 37) % 10) / 14, s: 2 + (i % 3), delay: (i % 5) * 0.08 };
});

export type CelebrationView = { key: string; indices: number[] };

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

// ---- Galáxia: gerada uma vez por sessão e reaproveitada ----
const GALAXY_W = 640;
const GALAXY_H = Math.round((GALAXY_W * SCENE.height) / SCENE.width);
let galaxyCache: HTMLCanvasElement | null = null;
function galaxyCanvas(): HTMLCanvasElement | null {
  if (galaxyCache) return galaxyCache;
  const c = document.createElement("canvas");
  c.width = GALAXY_W;
  c.height = GALAXY_H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(galaxyPixels(GALAXY_W, GALAXY_H), GALAXY_W, GALAXY_H), 0, 0);
  galaxyCache = c;
  return c;
}

function Galaxy() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      const src = galaxyCanvas();
      const ctx = ref.current?.getContext("2d");
      if (src && ctx) {
        ctx.drawImage(src, 0, 0);
        setReady(true);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div aria-hidden className="pointer-events-none absolute -inset-[5%]">
      {/* Base em CSS enquanto a galáxia é gerada (e para navegadores sem canvas). */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 30% 22% at 64% 50%, rgba(255,226,170,.35), transparent 70%), radial-gradient(ellipse 60% 45% at 64% 50%, rgba(170,120,55,.16), transparent 70%), #020306",
        }}
      />
      <canvas
        ref={ref}
        width={GALAXY_W}
        height={GALAXY_H}
        className={`gu-drift absolute inset-0 h-full w-full blur-[0.6px] brightness-[0.92] transition-opacity duration-1000 ${ready ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

// ---- Planeta em CSS: alternativa sem WebGL e miniaturas ----
export function Planet({
  milestone,
  state,
  className = "",
  small = false,
}: {
  milestone: Milestone;
  state: MilestoneState;
  className?: string;
  /** Miniaturas: brilho contido para não ser cortado por listas com rolagem. */
  small?: boolean;
}) {
  const v = visualFor(milestone.id);
  const [c1, c2, c3] = v.colors;
  const isStar = v.kind === "star";
  const banded = v.kind === "gas" || v.kind === "ice" || v.kind === "clouds";
  const surface: CSSProperties = isStar
    ? { background: `radial-gradient(circle at 45% 42%, ${c1} 0%, ${c2} 48%, ${c3} 100%)` }
    : banded
      ? {
          backgroundImage: `repeating-linear-gradient(${90 - (v.tilt * 180) / Math.PI}deg, ${c1} 0 9%, ${c2} 14% 22%, ${c3} 27% 30%, ${c2} 34% 40%), linear-gradient(${c2}, ${c2})`,
          backgroundSize: "200% 100%, 100% 100%",
        }
      : v.kind === "earth"
        ? {
            background: `radial-gradient(circle at 30% 40%, ${c1} 0 14%, transparent 15%), radial-gradient(circle at 62% 62%, ${c1} 0 18%, transparent 19%), radial-gradient(ellipse at 50% 4%, ${c3} 0 14%, transparent 15%), ${c2}`,
          }
        : {
            background: `radial-gradient(circle at 30% 62%, ${c3} 0 7%, transparent 8%), radial-gradient(circle at 66% 34%, ${c3} 0 5%, transparent 6%), radial-gradient(circle at 58% 72%, ${c1} 0 9%, transparent 10%), radial-gradient(circle at 40% 30%, ${c1}, ${c2} 60%, ${c3})`,
          };
  const glow = small ? (isStar ? 6 : 3) : isStar ? 34 : 14 * v.glow + 4;
  const ring = v.ring && (
    <span
      aria-hidden
      className="absolute left-1/2 top-1/2 h-[36%] w-[205%] -translate-x-1/2 -translate-y-1/2 -rotate-[14deg] rounded-[50%] border-[3px]"
      style={{ borderColor: `${v.ring.color}cc`, boxShadow: `0 0 6px ${v.ring.color}66` }}
    />
  );
  return (
    <span
      className={`relative block aspect-square w-full ${state === "locked" ? "opacity-50 grayscale-[0.8]" : ""} ${className}`}
    >
      {ring}
      <span
        aria-hidden
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{ boxShadow: `0 0 ${glow}px ${v.atmosphere}${isStar ? "cc" : "66"}` }}
      >
        <span className={`absolute inset-0 ${banded ? "gu-bands" : ""}`} style={surface} />
        {!isStar && (
          <span
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 30% 26%, rgba(255,255,255,.38), transparent 38%), radial-gradient(circle at 74% 78%, rgba(0,0,0,.82), transparent 68%)",
              boxShadow: `inset -6px -8px 14px rgba(0,0,0,.55), inset 2px 2px 8px ${v.atmosphere}55`,
            }}
          />
        )}
      </span>
      {ring && (
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[36%] w-[205%] -translate-x-1/2 -translate-y-1/2 -rotate-[14deg] rounded-[50%] border-[3px] [clip-path:inset(50%_0_0_0)]"
          style={{ borderColor: `${v.ring!.color}ee` }}
        />
      )}
    </span>
  );
}

// ---- WebGL ----
function usePlanetRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  reduced: boolean,
  maxDpr: number,
) {
  const rendererRef = useRef<PlanetRenderer | null>(null);
  const [gl, setGl] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !webglAvailable()) return;
    let renderer: PlanetRenderer;
    try {
      renderer = new PlanetRenderer(canvas);
    } catch (error) {
      console.warn("Gravon Universe: WebGL indisponível, usando planetas em CSS.", error);
      return;
    }
    renderer.onLost = () => {
      rendererRef.current = null;
      setGl(false);
    };
    rendererRef.current = renderer;
    setGl(true);
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [canvasRef]);

  // Pausa quando fora da tela, aba oculta ou movimento reduzido.
  useEffect(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return;
    renderer.reducedMotion = reduced;
    let visible = true;
    const sync = () => {
      if (visible && !document.hidden && !reduced) renderer.start();
      else renderer.stop();
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      renderer.stop();
    };
  }, [gl, reduced, canvasRef]);

  return { gl, rendererRef, maxDpr };
}

function PlanetPreview({ milestone, state }: { milestone: Milestone; state: MilestoneState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const { gl, rendererRef } = usePlanetRenderer(ref, reduced, 2);
  // Planetas conquistados aparecem ligeiramente maiores e com brilho na abertura.
  const achieved = state === "achieved";
  const size = achieved ? 200 : 168;
  const scale = achieved ? 1.18 : 1;
  useEffect(() => {
    const r = rendererRef.current;
    if (!gl || !r) return;
    const v = visualFor(milestone.id);
    r.resize(size, size);
    r.setPlanets([
      {
        id: milestone.id,
        x: size / 2,
        y: size / 2,
        radius: (v.ring ? 32 : v.kind === "star" ? 40 : 52) * scale,
        visual: v,
        locked: state === "locked" ? 1 : 0,
        gold: state === "next" ? 1 : 0,
        hover: achieved ? 0.7 : 0.4,
        selected: 0,
      },
    ]);
  }, [gl, rendererRef, milestone.id, state, size, scale, achieved]);
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      {achieved && (
        <span
          aria-hidden
          className="gu-reveal absolute inset-[-12%] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(247,222,160,.32), rgba(227,183,95,.1) 45%, transparent 70%)",
          }}
        />
      )}
      <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
      {!gl && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={achieved ? "w-28" : "w-24"}>
            <Planet milestone={milestone} state={state} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Cena ----
export function UniverseScene({
  progress,
  journey,
  onSelect,
  selected = null,
  celebration = null,
}: {
  progress: JourneyProgress;
  journey: Journey;
  onSelect: (index: number) => void;
  selected?: number | null;
  /** Conquistas recém-desbloqueadas a celebrar (≈3 s). */
  celebration?: CelebrationView | null;
}) {
  const { milestones, nodes } = journey;
  const segments = segmentsFor(journey);
  const celebrating = useMemo(() => new Set(celebration?.indices ?? []), [celebration]);
  const message = celebration ? celebrationMessage(milestones, celebration.indices) : null;
  const fullPath = useMemo(() => pathFor(segments), [segments]);
  const done = useMemo(
    () => pathFor(progressSegments(segments, progress.position)),
    [segments, progress.position],
  );
  const marker = pointAtPosition(segments, progress.position);
  const reduced = usePrefersReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const { gl, rendererRef } = usePlanetRenderer(canvasRef, reduced, 2);

  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Em telas estreitas a cena rola na horizontal: centraliza a posição atual.
  const focusX = progress.next ? marker.x : nodes[nodes.length - 1].x;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    el.scrollLeft = (focusX / SCENE.width) * el.scrollWidth - el.clientWidth / 2;
  }, [focusX, width, journey.mode]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!gl || !r || !width) return;
    const height = (width * SCENE.height) / SCENE.width;
    r.resize(width, height, width < 900 ? 1.5 : 2);
    const k = width / SCENE.width;
    const draws: PlanetDraw[] = milestones.map((m, i) => {
      const state = stateOf(progress, i);
      return {
        id: `${journey.mode}:${m.id}`,
        x: nodes[i + 1].x * k,
        y: nodes[i + 1].y * k,
        radius: (m.size / 2) * k * 1.05,
        visual: visualFor(m.id),
        locked: state === "locked" ? 1 : 0,
        gold: state === "next" || celebrating.has(i) ? 1 : 0,
        hover: hovered === i || celebrating.has(i) ? 1 : 0,
        selected: selected === i ? 1 : 0,
      };
    });
    r.setPlanets(draws);
  }, [
    gl,
    rendererRef,
    width,
    milestones,
    nodes,
    journey.mode,
    progress,
    hovered,
    selected,
    celebrating,
  ]);

  // Parallax suave das estrelas acompanhando o cursor.
  const frame = useRef(0);
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = sceneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--gu-mx", mx.toFixed(3));
      el.style.setProperty("--gu-my", my.toFixed(3));
    });
  };
  const layer = (depth: number): CSSProperties => ({
    transform: `translate3d(calc(var(--gu-mx, 0) * ${-depth}px), calc(var(--gu-my, 0) * ${-depth}px), 0)`,
    transition: "transform 600ms ease-out",
  });

  const zoomTarget = selected != null ? nodes[selected + 1] : null;
  const camera: CSSProperties = {
    transformOrigin: zoomTarget
      ? `${pct(zoomTarget.x, SCENE.width)} ${pct(zoomTarget.y, SCENE.height)}`
      : "50% 50%",
    transform: zoomTarget && !reduced ? "scale(1.22)" : "none",
    transition: "transform 900ms cubic-bezier(.22,.8,.2,1)",
  };
  const hoveredMilestone = hovered != null ? milestones[hovered] : null;
  const hoveredState = hovered != null ? stateOf(progress, hovered) : null;

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto rounded-2xl border border-[#e3b75f]/15 shadow-[0_0_40px_rgba(0,0,0,.6)]"
    >
      <div
        ref={sceneRef}
        onPointerMove={onPointerMove}
        className="relative min-w-[760px] overflow-hidden bg-[#020306]"
        style={{ aspectRatio: `${SCENE.width} / ${SCENE.height}` }}
        aria-label={`${journey.label}: ${progress.achieved} de ${milestones.length} conquistas`}
        role="group"
      >
        <div className="absolute inset-0" style={camera}>
          <Galaxy />

          {/* Estrelas em profundidades diferentes. */}
          <svg
            viewBox={`0 0 ${SCENE.width} ${SCENE.height}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={layer(5)}
            aria-hidden
          >
            {MID_STARS.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.65} fill="#fff" opacity={s.o * 0.7} />
            ))}
          </svg>
          <div aria-hidden className="pointer-events-none absolute inset-0" style={layer(12)}>
            {NEAR_STARS.map((s, i) => (
              <span
                key={i}
                className="gu-twinkle absolute rounded-full bg-white"
                style={{
                  left: pct(s.x, SCENE.width),
                  top: pct(s.y, SCENE.height),
                  width: 1.5 + s.r,
                  height: 1.5 + s.r,
                  boxShadow: `0 0 ${4 + s.r * 4}px rgba(255,236,200,.9)`,
                  animationDelay: `${(i * 0.37) % 4.5}s`,
                }}
              />
            ))}
          </div>

          {/* Caminho das conquistas. */}
          <svg
            key={journey.mode}
            viewBox={`0 0 ${SCENE.width} ${SCENE.height}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden
          >
            <defs>
              <linearGradient id="gu-progress" x1="0" x2="1" y1="1" y2="0">
                <stop offset="0%" stopColor="#f7e3a8" />
                <stop offset="100%" stopColor={GOLD} />
              </linearGradient>
              <filter id="gu-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
            </defs>
            <path
              d={fullPath}
              fill="none"
              stroke="rgba(255,255,255,.06)"
              strokeWidth={9}
              strokeLinecap="round"
            />
            <path
              d={fullPath}
              fill="none"
              stroke="rgba(255,255,255,.14)"
              strokeWidth={1}
              strokeLinecap="round"
            />
            <path
              d={fullPath}
              fill="none"
              stroke="rgba(247,227,168,.42)"
              strokeWidth={1.8}
              strokeDasharray="1.5 8"
              strokeLinecap="round"
            />
            {done && (
              <>
                <path
                  d={done}
                  fill="none"
                  stroke={GOLD}
                  strokeOpacity={0.5}
                  strokeWidth={10}
                  strokeLinecap="round"
                  filter="url(#gu-glow)"
                  pathLength={1}
                  className="gu-draw"
                />
                <path
                  d={done}
                  fill="none"
                  stroke="url(#gu-progress)"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  pathLength={1}
                  className="gu-draw"
                />
                <path
                  d={done}
                  fill="none"
                  stroke="#fff8e1"
                  strokeOpacity={0.85}
                  strokeWidth={1.6}
                  strokeDasharray="2 14"
                  strokeLinecap="round"
                  className="gu-flow"
                />
              </>
            )}
          </svg>

          <canvas
            ref={canvasRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
          />

          {/* Início */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: pct(nodes[0].x, SCENE.width), top: pct(nodes[0].y, SCENE.height) }}
          >
            <span className="block h-3 w-3 rounded-full border-2 border-[#f7e3a8] bg-[#05060b] shadow-[0_0_10px_#e3b75f]" />
            <span className="absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-black/70 px-2 py-1 text-center text-[11px] leading-tight text-white/80 backdrop-blur-sm">
              Início
              <span className="block text-white/60">R$ 0</span>
            </span>
          </div>

          {milestones.map((m, i) => {
            const node = nodes[i + 1];
            const state = stateOf(progress, i);
            const isCurrent = i === progress.achieved - 1;
            const half = m.size / 2;
            const label =
              state === "achieved"
                ? isCurrent
                  ? "planeta atual"
                  : "conquistado"
                : state === "next"
                  ? "próxima conquista"
                  : "bloqueado";
            return (
              <div key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered((h) => (h === i ? null : h))}
                  aria-label={`${m.name}, ${compactBrl(m.threshold)}, ${label}. Ver detalhes`}
                  className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full outline-none transition-transform duration-300 focus-visible:ring-2 focus-visible:ring-[#e3b75f]"
                  style={{
                    left: pct(node.x, SCENE.width),
                    top: pct(node.y, SCENE.height),
                    width: pct(m.size * 1.15, SCENE.width),
                  }}
                >
                  {!gl && (
                    <span
                      className={`block transition-transform duration-300 ${hovered === i || selected === i ? "scale-110" : ""}`}
                    >
                      <Planet milestone={m} state={state} />
                    </span>
                  )}
                  {!gl && state === "next" && (
                    <span
                      aria-hidden
                      className="absolute -inset-[12%] rounded-full border border-[#e3b75f]/80 shadow-[0_0_14px_#e3b75f]"
                    />
                  )}
                  {state === "achieved" && (
                    <span className="absolute right-[4%] top-[4%] flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-[#f7e3a8] to-[#c9952f] text-black shadow">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                  {state === "locked" && (
                    <span className="absolute right-[4%] top-[4%] flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white/70 ring-1 ring-white/15">
                      <Lock className="h-2.5 w-2.5" />
                    </span>
                  )}
                </button>
                <span
                  className={`pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-center leading-tight backdrop-blur-sm transition-colors duration-300 ${
                    state === "locked"
                      ? "border-white/10 bg-black/60 text-white/70"
                      : "border-[#e3b75f]/40 bg-black/65 text-white"
                  } ${isCurrent || state === "next" ? "shadow-[0_0_14px_rgba(227,183,95,.25)]" : ""}`}
                  style={{
                    left: pct(node.x, SCENE.width),
                    top: pct(node.y + half * (m.size > 70 ? 1.05 : 1.15) + 8, SCENE.height),
                  }}
                >
                  <span className="block font-serif text-[13px] font-semibold tracking-wide">
                    {m.name}
                  </span>
                  <span
                    className={`block text-[11px] tabular-nums ${state === "locked" ? "" : "text-[#e3b75f]"}`}
                  >
                    {compactBrl(m.threshold)}
                  </span>
                  {isCurrent && (
                    <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.14em] text-[#f7e3a8]">
                      Planeta atual
                    </span>
                  )}
                  {state === "next" && (
                    <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.14em] text-[#f7e3a8]">
                      Próxima conquista
                    </span>
                  )}
                </span>
              </div>
            );
          })}

          {progress.next && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: pct(marker.x, SCENE.width), top: pct(marker.y, SCENE.height) }}
            >
              <span className="gu-pulse absolute inset-0 rounded-full bg-[#e3b75f]/40" />
              <span className="relative flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#05060b]/80 ring-2 ring-[#e3b75f] shadow-[0_0_16px_rgba(227,183,95,.8)]">
                <span className="h-2 w-2 rounded-full bg-[#fff6dc] shadow-[0_0_6px_#fff6dc]" />
              </span>
              <span className="absolute bottom-[26px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#fbe9b8]/60 bg-gradient-to-b from-[#f9e6b3] to-[#d4a043] px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.12em] text-[#1a1206] shadow-[0_4px_14px_rgba(0,0,0,.5),0_0_12px_rgba(227,183,95,.45)]">
                Você está aqui
                <span className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-[#d4a043]" />
              </span>
            </div>
          )}

          {/* Celebração: brilho dourado, ondas luminosas e partículas discretas. */}
          {celebration &&
            celebration.indices.map((i) => {
              const m = milestones[i];
              const node = nodes[i + 1];
              if (!m || !node) return null;
              const k = width / SCENE.width || 1;
              const r = (m.size / 2) * k;
              const at = { left: pct(node.x, SCENE.width), top: pct(node.y, SCENE.height) };
              return (
                <div key={`${celebration.key}:${m.id}`} aria-hidden className="pointer-events-none">
                  <span
                    className="gu-reveal absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      ...at,
                      width: r * 4.2,
                      height: r * 4.2,
                      background:
                        "radial-gradient(circle, rgba(247,222,160,.38), rgba(227,183,95,.12) 45%, transparent 70%)",
                    }}
                  />
                  {[0, 0.4].map((delay) => (
                    <span
                      key={delay}
                      className="gu-wave absolute rounded-full border-2 border-[#f3d38c]"
                      style={{
                        ...at,
                        width: r * 2.3,
                        height: r * 2.3,
                        animationDelay: `${delay}s`,
                        boxShadow:
                          "0 0 18px rgba(227,183,95,.7), inset 0 0 12px rgba(227,183,95,.4)",
                      }}
                    />
                  ))}
                  {PARTICLES.map((p, n) => (
                    <span
                      key={n}
                      className="gu-particle absolute rounded-full bg-[#fbe3a6]"
                      style={
                        {
                          ...at,
                          width: p.s,
                          height: p.s,
                          boxShadow: "0 0 6px rgba(251,227,166,.9)",
                          animationDelay: `${0.15 + p.delay}s`,
                          "--gu-dx": `${Math.cos(p.a) * r * p.d * 1.6}px`,
                          "--gu-dy": `${Math.sin(p.a) * r * p.d * 1.6}px`,
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
              );
            })}

          {/* Cartão ao passar o cursor. */}
          {hoveredMilestone && hoveredState && hovered != null && selected == null && (
            <div
              className="gu-fade pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
              style={{
                left: pct(nodes[hovered + 1].x, SCENE.width),
                top: pct(nodes[hovered + 1].y - hoveredMilestone.size * 0.62 - 10, SCENE.height),
              }}
            >
              <div className="min-w-[180px] rounded-lg border border-[#e3b75f]/40 bg-[#0b0c10]/95 px-3 py-2 text-xs text-white shadow-[0_8px_30px_rgba(0,0,0,.6)]">
                <p className="font-serif text-sm font-semibold">{hoveredMilestone.name}</p>
                <p className="text-[#e3b75f]">{brl(hoveredMilestone.threshold)}</p>
                <p className="mt-1 text-white/65">
                  {hoveredState === "achieved"
                    ? "Conquistado"
                    : `${hoveredState === "next" ? "Próxima conquista" : "Bloqueado"} · faltam ${brl(Math.max(0, hoveredMilestone.threshold - progress.value))}`}
                </p>
                <p className="mt-1 text-[10px] text-white/40">Clique para ver detalhes</p>
              </div>
            </div>
          )}
        </div>

        {/* Vinheta para leitura e profundidade. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.55) 100%), linear-gradient(to bottom, rgba(0,0,0,.15), transparent 25%, transparent 80%, rgba(0,0,0,.35))",
          }}
        />

        <div role="status" aria-live="polite" className="sr-only">
          {message ? `${message.title}: ${message.detail}` : ""}
        </div>
        {message && celebration && (
          <div
            key={celebration.key}
            aria-hidden
            className="gu-toast pointer-events-none absolute left-1/2 top-5 z-20"
          >
            <div className="rounded-2xl bg-gradient-to-b from-[#f6dc9c]/70 via-[#e3b75f]/25 to-[#e3b75f]/50 p-px shadow-[0_12px_40px_rgba(0,0,0,.65),0_0_30px_rgba(227,183,95,.25)]">
              <div className="flex items-center gap-3 rounded-[15px] bg-gradient-to-b from-[#16130c]/95 to-[#0a0907]/95 px-5 py-3 backdrop-blur-md">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#fbe9b8] to-[#c9952f] text-[#1a1206] shadow-[0_0_16px_rgba(227,183,95,.6)]">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#e3b75f]">
                    {message.title}
                  </p>
                  <p className="font-serif text-base font-semibold text-white">{message.detail}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Painel de faturamento (cálculos inalterados) ----
export function RevenuePanel({
  progress,
  journey,
  periodLabel,
  empty,
  onOpenNext,
}: {
  progress: JourneyProgress;
  journey: Journey;
  periodLabel: string;
  empty: boolean;
  onOpenNext: () => void;
}) {
  const { next, current } = progress;
  const percent = next ? progress.percentToNext : 100;
  return (
    <section
      aria-label="Painel de faturamento"
      className="rounded-2xl bg-gradient-to-b from-[#bcd4ff]/45 via-[#2f6fed]/15 to-[#2f6fed]/30 p-px shadow-[0_14px_44px_rgba(0,0,0,.6),0_0_0_1px_rgba(0,0,0,.4)]"
    >
      <div className="rounded-[15px] bg-gradient-to-b from-[#13151b] to-[#0a0b0f] p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6ea8fe]/80">
              {journey.label}
            </p>
            <p className="mt-1 text-base font-medium text-white/90">
              {journey.mode === "mensal"
                ? "Receita confirmada do mês"
                : "Receita confirmada acumulada"}
            </p>
            <p className="text-xs text-white/65">{periodLabel}</p>
          </div>
          <div className="ml-7 w-12 shrink-0">
            {current ? (
              <Planet milestone={current} state="achieved" />
            ) : next ? (
              <Planet milestone={next} state="locked" />
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p
              className={`font-bold tracking-tight tabular-nums ${brl(progress.value).length > 13 ? "text-2xl" : "text-3xl"}`}
            >
              {brl(progress.value)}
            </p>
            <p className="mt-1 text-sm text-white/70">
              {next ? `de ${brl(next.threshold)}` : "Todas as conquistas alcançadas"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="bg-gradient-to-b from-[#bcd4ff] to-[#2f6fed] bg-clip-text text-[2.1rem] font-bold leading-none text-transparent drop-shadow-[0_0_14px_rgba(110,168,254,.25)]">
              {percent}%
            </p>
            <p className="text-xs text-white/70">{next ? `de ${next.name}` : "da jornada"}</p>
          </div>
        </div>
        <div
          className="relative mt-4 h-3 overflow-hidden rounded-full bg-white/[0.08] ring-1 ring-inset ring-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Progresso até a próxima conquista"
        >
          <div
            className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-[#1d4ed8] via-[#2f6fed] to-[#bcd4ff] shadow-[0_0_12px_#2f6fed] transition-[width] duration-700"
            style={{ width: `${percent}%` }}
          >
            <span className="gu-shimmer absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent" />
          </div>
        </div>
        <div className="mt-4 border-t border-white/10 pt-3">
          {empty ? (
            <p className="text-sm text-white/70">
              Nenhuma receita confirmada neste período ainda. Quando o{" "}
              <Link to="/financeiro" className="text-[#6ea8fe] underline-offset-2 hover:underline">
                Financeiro
              </Link>{" "}
              registrar receita, sua jornada começa.
            </p>
          ) : next ? (
            <button
              type="button"
              onClick={onOpenNext}
              className="flex w-full items-center justify-between gap-3 text-left text-sm text-white/70 hover:text-white"
            >
              <span>
                Faltam{" "}
                <strong className="font-semibold text-[#6ea8fe]">{brl(progress.remaining)}</strong>{" "}
                para conquistar {next.name}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0" />
            </button>
          ) : (
            <p className="flex items-center gap-2 text-sm text-[#6ea8fe]">
              <Sparkles className="h-4 w-4" /> Jornada completa neste período.
            </p>
          )}
          <p className="mt-2 text-xs text-white/60">
            {current ? `Planeta atual: ${current.name}` : "Ponto de partida: Início"} ·{" "}
            {progress.achieved} de {journey.milestones.length} conquistas
          </p>
        </div>
      </div>
    </section>
  );
}

// ---- Lista de conquistas (aproveita a coluna lateral) ----
export function AchievementList({
  progress,
  journey,
  onSelect,
  selected = null,
}: {
  progress: JourneyProgress;
  journey: Journey;
  onSelect: (index: number) => void;
  selected?: number | null;
}) {
  return (
    <section
      aria-label="Conquistas da jornada"
      className="flex min-h-0 flex-col rounded-2xl border border-[#6ea8fe]/15 bg-gradient-to-b from-[#101217] to-[#0a0b0e] p-3 shadow-[0_10px_34px_rgba(0,0,0,.5)]"
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold">Conquistas</h2>
        <span className="text-xs text-white/65">
          {progress.achieved} de {journey.milestones.length}
        </span>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {journey.milestones.map((m, i) => {
          const state = stateOf(progress, i);
          const isCurrent = i === progress.achieved - 1;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                className={`relative flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06] ${
                  state === "next"
                    ? "bg-gradient-to-r from-[#6ea8fe]/[0.16] to-transparent ring-1 ring-inset ring-[#6ea8fe]/35"
                    : selected === i
                      ? "bg-[#6ea8fe]/10"
                      : ""
                }`}
              >
                <span className="mx-1.5 w-6 shrink-0">
                  <Planet milestone={m} state={state} small />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm ${state === "locked" ? "text-white/65" : state === "next" ? "font-semibold text-[#bcd4ff]" : "text-white"}`}
                  >
                    {m.name}
                  </span>
                  <span className="block text-[11px] tabular-nums text-white/60">
                    {compactBrl(m.threshold)}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    isCurrent
                      ? "bg-gradient-to-r from-[#bcd4ff] to-[#2f6fed] text-white"
                      : state === "achieved"
                        ? "bg-[#6ea8fe]/15 text-[#6ea8fe]"
                        : state === "next"
                          ? "border border-[#6ea8fe]/70 text-[#6ea8fe]"
                          : "text-white/50"
                  }`}
                >
                  {isCurrent
                    ? "Atual"
                    : state === "achieved"
                      ? "Conquistado"
                      : state === "next"
                        ? "Próxima"
                        : "Bloqueado"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---- Detalhes da conquista (dados inalterados) ----
export function MilestoneDialog({
  index,
  onClose,
  progress,
  journey,
  months,
  monthIndex,
  periodLabel,
}: {
  index: number | null;
  onClose: () => void;
  progress: JourneyProgress;
  journey: Journey;
  months: readonly MonthValue[];
  monthIndex: number;
  periodLabel: string;
}) {
  const { mode, milestones } = journey;
  const m = index == null ? null : (milestones[index] ?? null);
  const state = index == null ? "locked" : stateOf(progress, index);
  const reached = m ? achievementMonths(mode, months, monthIndex, m) : [];
  const percent = m ? Math.min(100, Math.floor((progress.value / m.threshold) * 100)) : 0;
  const after = index == null ? null : (milestones[index + 1] ?? null);
  const yearLabel = periodLabel.match(/\d{4}/)?.[0] ?? "";
  return (
    <Dialog open={m != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="dark border-[#e3b75f]/25 bg-gradient-to-b from-[#12141a] to-[#08090c] text-white shadow-[0_20px_80px_rgba(0,0,0,.8)] sm:max-w-md">
        {m && (
          <>
            <DialogHeader>
              <PlanetPreview milestone={m} state={state} />
              <DialogTitle className="text-center font-serif text-2xl">
                {m.name} · {compactBrl(m.threshold)}
              </DialogTitle>
              <DialogDescription className="text-center text-white/60">
                {m.description}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-center">
              {state === "achieved" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#fbe9b8]/70 bg-gradient-to-b from-[#f9e6b3] to-[#c9952f] px-3.5 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[#1a1206] shadow-[0_0_18px_rgba(227,183,95,.45)]">
                  <BadgeCheck className="h-4 w-4" /> Conquistado
                </span>
              ) : (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    state === "next"
                      ? "border border-[#e3b75f] text-[#e3b75f]"
                      : "bg-white/10 text-white/60"
                  }`}
                >
                  {state === "next" ? "Próxima conquista" : "Bloqueado"}
                </span>
              )}
            </div>
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-white/60">
                  Receita confirmada · {mode === "mensal" ? "mês" : "acumulada"}
                </span>
                <span className="font-semibold tabular-nums">{brl(progress.value)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#8a6424] via-[#e3b75f] to-[#fbe9b8]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex justify-between gap-3 text-xs text-white/60">
                <span>{percent}% do marco</span>
                <span>
                  {state === "achieved"
                    ? "Marco atingido"
                    : `Faltam ${brl(Math.max(0, m.threshold - progress.value))}`}
                </span>
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-white/60">
                  {mode === "mensal" ? `Meses de ${yearLabel} que atingiram` : "Conquistado em"}
                </dt>
                <dd className="text-right font-medium">
                  {reached.length
                    ? reached.join(", ")
                    : mode === "mensal"
                      ? "Nenhum mês ainda"
                      : "Ainda não conquistado"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/60">Período considerado</dt>
                <dd className="text-right">{periodLabel}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/60">Marco seguinte</dt>
                <dd className="text-right">
                  {after ? `${after.name} · ${compactBrl(after.threshold)}` : "Fim da jornada"}
                </dd>
              </div>
            </dl>
            <DialogClose className="mx-auto flex items-center gap-2 rounded-lg border border-[#e3b75f]/40 px-4 py-2 text-sm text-[#e3b75f] transition-colors hover:bg-[#e3b75f]/10">
              <ArrowLeft className="h-4 w-4" /> Voltar à jornada
            </DialogClose>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
