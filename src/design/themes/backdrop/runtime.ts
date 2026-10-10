import type { UiThemeStyle } from "../../../lib/settings";
import { createBudget, createPauseState, DOWNGRADE_STEPS, percentile, type Downgrade, type PauseReason } from "./guards";

/** One drawing back end; the runtime owns the canvas, the clock and every guard. */
export interface BackdropRenderer {
  kind: string;
  /** Claim a context on `canvas`; false (or a throw) moves on to the next candidate. */
  init(canvas: HTMLCanvasElement): boolean;
  frame(tMs: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}
/** `webgl` candidates are skipped unless the flag `VITE_PA_BACKDROP_WEBGL` is on. */
export interface BackdropCandidate {
  kind: string;
  webgl?: boolean;
  create(): BackdropRenderer;
}
export interface BackdropStats {
  fps: number;
  frameMsP50: number;
  frameMsP95: number;
  kind: string;
  pauseReason: PauseReason | null;
  downgrades: Downgrade[];
}
declare global {
  interface Window {
    __PA_BACKDROP_STATS__?: BackdropStats;
  }
}
export interface BackdropOptions {
  host: HTMLElement;
  candidates: readonly BackdropCandidate[];
  webgl?: boolean;
  fps?: number;
  now?: () => number;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
  exposeStats?: boolean;
}
export interface BackdropRuntime {
  stats: BackdropStats;
  hold(): void;
  release(): void;
  setOverlay(open: boolean): void;
  dispose(): void;
}

const BASE_SCALE = Math.sqrt(1 / 8); // 1/8 of the viewport area; CSS upscales
const MIN_FPS = 12;
const STATIC_QUERY =
  "(prefers-reduced-motion: reduce), (prefers-contrast: more), (prefers-reduced-transparency: reduce)";
const registry: Partial<Record<UiThemeStyle, readonly BackdropCandidate[]>> = {};
const live = new Set<BackdropRuntime>();

/** Theme packages register their renderers (best first); Klassisch has none. */
export const registerBackdrop = (style: UiThemeStyle, c: readonly BackdropCandidate[]) => void (registry[style] = c);
export const backdropCandidates = (style: UiThemeStyle) => registry[style] ?? [];

/** Freeze every backdrop (TH5 view transition); the returned function releases once. */
export function holdBackdrop(): () => void {
  const held = [...live];
  held.forEach((r) => r.hold());
  return () => held.splice(0).forEach((r) => r.release());
}

export function createBackdropRuntime(o: BackdropOptions): BackdropRuntime {
  const now = o.now ?? (() => performance.now());
  const raf = o.raf ?? ((cb: () => void) => requestAnimationFrame(cb));
  const pause = createPauseState(now);
  const overBudget = createBudget();
  const costs: number[] = [];
  const stamps: number[] = [];
  const downgrades: Downgrade[] = [];
  const media = typeof matchMedia === "function" ? matchMedia(STATIC_QUERY) : null;
  const offs: Array<() => void> = [];
  let fps = o.fps ?? 30;
  let scale = BASE_SCALE;
  let lastAt = -Infinity;
  let slowStatic = false;
  let disposed = false;
  let rafId: number | null = null;
  let kind = "css";
  let renderer: BackdropRenderer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let size = { w: 0, h: 0 };

  // Fallback chain: every candidate is tried exactly once, then the CSS gradient.
  for (const c of o.candidates) {
    if (c.webgl && !o.webgl) continue;
    const el = document.createElement("canvas");
    let r: BackdropRenderer | null = null;
    try {
      r = c.create();
      if (r.init(el)) {
        renderer = r;
        canvas = el;
        kind = c.kind;
        break;
      }
    } catch {
      // a throwing init counts as a failed init
    }
    try {
      r?.dispose();
    } catch {
      // nothing left to release
    }
  }

  const isStatic = () => slowStatic || (media?.matches ?? false);
  const apply = () => {
    if (!renderer || !canvas) return;
    canvas.width = Math.max(1, Math.round(size.w * scale));
    canvas.height = Math.max(1, Math.round(size.h * scale));
    renderer.resize(canvas.width, canvas.height);
    if (isStatic()) draw(); // resizing clears the canvas; a static theme redraws once
  };
  const draw = () => {
    const t0 = now();
    renderer?.frame(t0);
    const cost = now() - t0;
    lastAt = t0;
    stamps.push(t0);
    while (t0 - stamps[0] > 1000) stamps.shift();
    costs.push(cost);
    if (costs.length > 120) costs.shift();
    if (!overBudget(cost, t0)) return;
    const step = DOWNGRADE_STEPS[downgrades.length];
    if (step) downgrades.push(step);
    if (step === "scale") {
      scale *= 0.7;
      apply();
    }
    if (step === "fps") fps = Math.max(MIN_FPS, Math.round(fps / 2));
    if (step === "static") slowStatic = true;
  };
  const schedule = () => {
    if (rafId === null && !disposed && renderer && !isStatic()) rafId = raf(tick);
  };
  function tick() {
    rafId = null;
    if (disposed || isStatic()) return;
    const reason = pause.reason();
    if (reason === "typing") return schedule(); // poll until the 2 s are over
    if (reason) return; // idle: an event wakes the loop
    if (now() - lastAt >= 1000 / fps - 1) draw();
    schedule();
  }
  const bind = (target: EventTarget, type: string, fn: () => void, capture = false) => {
    target.addEventListener(type, fn, capture);
    offs.push(() => target.removeEventListener(type, fn, capture));
  };
  const setSize = (w: number, h: number) => {
    size = { w, h };
    apply();
  };

  const stats = {
    get fps() {
      return stamps.filter((t) => now() - t <= 1000).length;
    },
    get frameMsP50() {
      return percentile(costs, 0.5);
    },
    get frameMsP95() {
      return percentile(costs, 0.95);
    },
    get kind() {
      return kind;
    },
    get pauseReason() {
      return pause.reason();
    },
    get downgrades() {
      return [...downgrades];
    },
  } satisfies BackdropStats;

  if (renderer && canvas) {
    o.host.append(canvas);
    const sync = () => {
      pause.set("hidden", document.visibilityState === "hidden");
      schedule();
    };
    bind(document, "visibilitychange", sync);
    bind(window, "blur", () => pause.set("blur", true));
    bind(window, "focus", () => (pause.set("blur", false), schedule()));
    bind(document, "keydown", pause.key, true);
    if (media) bind(media, "change", () => (isStatic() ? draw() : schedule()));
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.contentRect;
        if (box) setSize(box.width, box.height);
      });
      observer.observe(o.host);
      offs.push(() => observer.disconnect());
    }
    pause.set("hidden", document.visibilityState === "hidden");
    setSize(o.host.clientWidth || window.innerWidth, o.host.clientHeight || window.innerHeight);
    schedule(); // a static theme already drew its one frame in setSize()
  }
  if (o.exposeStats) window.__PA_BACKDROP_STATS__ = stats;

  const runtime: BackdropRuntime = {
    stats,
    hold: pause.hold,
    release: () => (pause.release(), schedule()),
    setOverlay: (open) => (pause.set("overlay", open), schedule()),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId !== null) (o.caf ?? cancelAnimationFrame)(rafId);
      offs.forEach((off) => off());
      renderer?.dispose();
      canvas?.remove();
      if (window.__PA_BACKDROP_STATS__ === stats) delete window.__PA_BACKDROP_STATS__;
      live.delete(runtime);
    },
  };
  live.add(runtime);
  return runtime;
}
