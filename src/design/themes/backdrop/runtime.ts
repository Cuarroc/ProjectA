import { createPauseState, type PauseReason } from "./guards";

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
export interface BackdropOptions {
  host: HTMLElement;
  candidates: readonly BackdropCandidate[];
  webgl?: boolean;
  fps?: number;
  scale?: number;
  now?: () => number;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
}
export interface BackdropRuntime {
  /** Kind of the renderer that claimed the canvas, or "css" when none did. */
  kind: string;
  pauseReason(): PauseReason | null;
  setOverlay(open: boolean): void;
  dispose(): void;
}

const BASE_SCALE = Math.sqrt(1 / 8); // 1/8 of the viewport area; CSS upscales
const STATIC_QUERY =
  "(prefers-reduced-motion: reduce), (prefers-contrast: more), (prefers-reduced-transparency: reduce)";

export function createBackdropRuntime(o: BackdropOptions): BackdropRuntime {
  const now = o.now ?? (() => performance.now());
  const raf = o.raf ?? ((cb: () => void) => requestAnimationFrame(cb));
  const pause = createPauseState(now);
  const media = typeof matchMedia === "function" ? matchMedia(STATIC_QUERY) : null;
  const offs: Array<() => void> = [];
  const fps = o.fps ?? 30;
  const scale = o.scale ?? BASE_SCALE;
  let lastAt = -Infinity;
  let disposed = false;
  let rafId: number | null = null;
  let kind = "css";
  let renderer: BackdropRenderer | null = null;
  let canvas: HTMLCanvasElement | null = null;

  // Fallback chain: every candidate is tried exactly once, then the CSS gradient.
  for (const c of o.candidates) {
    if (c.webgl && !o.webgl) continue;
    const el = document.createElement("canvas");
    let r: BackdropRenderer | null = null;
    try {
      r = c.create();
      if (r.init(el)) {
        [renderer, canvas, kind] = [r, el, c.kind];
        break;
      }
    } catch { /* a throwing init counts as a failed init */ }
    try {
      r?.dispose();
    } catch { /* nothing left to release */ }
  }

  // Reduce / high contrast / reduced transparency: one frame, never a loop.
  const isStatic = () => media?.matches ?? false;
  const draw = () => {
    lastAt = now();
    renderer?.frame(lastAt);
  };
  const setSize = (w: number, h: number) => {
    if (!renderer || !canvas) return;
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    renderer.resize(canvas.width, canvas.height);
    if (isStatic()) draw(); // resizing clears the canvas; a static theme redraws once
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

  if (renderer && canvas) {
    o.host.append(canvas);
    bind(document, "visibilitychange", () => (pause.set("hidden", document.visibilityState === "hidden"), schedule()));
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

  return {
    kind,
    pauseReason: pause.reason,
    setOverlay: (open) => (pause.set("overlay", open), schedule()),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId !== null) (o.caf ?? cancelAnimationFrame)(rafId);
      offs.forEach((off) => off());
      renderer?.dispose();
      canvas?.remove();
    },
  };
}
