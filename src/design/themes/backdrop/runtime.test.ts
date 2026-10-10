import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackdropRuntime, type BackdropCandidate, type BackdropOptions, type BackdropRuntime } from "./runtime";

const FRAME = 1000 / 60;
let t = 0;
let pending: (() => void) | null = null;

/** Fake clock + rAF: `run(ms)` plays 60 Hz vsync ticks. */
function run(ms: number) {
  const end = t + ms;
  while (t < end) {
    t += FRAME;
    const cb = pending;
    pending = null;
    cb?.();
  }
}

const testRenderer = (kind = "test") => ({
  kind,
  init: vi.fn(() => true),
  frame: vi.fn<(at: number) => void>(),
  resize: vi.fn<(w: number, h: number) => void>(),
  dispose: vi.fn(),
});

function mount(renderer = testRenderer(), extra: Partial<BackdropOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const runtime = createBackdropRuntime({
    host,
    candidates: [{ kind: renderer.kind, create: () => renderer }],
    now: () => t,
    raf: (cb) => ((pending = cb), 1),
    caf: () => (pending = null),
    ...extra,
  });
  return { host, renderer, runtime };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  t = 1;
  pending = null;
  vi.stubGlobal("matchMedia", undefined);
});
afterEach(() => {
  setHidden(false);
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("backdrop runtime", () => {
  it("never spaces frames closer than the fps cap", () => {
    const { renderer } = mount(testRenderer(), { fps: 30 });
    run(1000);
    const times = renderer.frame.mock.calls.map(([at]) => at);
    expect(times.length).toBeGreaterThan(20);
    expect(Math.min(...times.slice(1).map((at, i) => at - times[i]))).toBeGreaterThanOrEqual(1000 / 30 - 1);
  });

  const pauses: Array<[string, (rt: BackdropRuntime) => () => void]> = [
    ["hidden", () => (setHidden(true), () => setHidden(false))],
    ["blur", () => (window.dispatchEvent(new Event("blur")), () => window.dispatchEvent(new Event("focus")))],
    ["overlay", (rt) => (rt.setOverlay(true), () => rt.setOverlay(false))],
    ["typing", () => (document.dispatchEvent(new KeyboardEvent("keydown")), () => run(2000))],
  ];
  it.each(pauses)("draws 0 frames while %s and resumes afterwards", (reason, start) => {
    const { renderer, runtime } = mount();
    run(500);
    const before = renderer.frame.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    const end = start(runtime);
    run(1000);
    expect(renderer.frame.mock.calls.length).toBe(before);
    expect(runtime.pauseReason()).toBe(reason);
    end();
    run(500);
    expect(renderer.frame.mock.calls.length).toBeGreaterThan(before);
  });

  it("draws exactly one frame under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { renderer } = mount();
    run(5000);
    expect(renderer.frame).toHaveBeenCalledTimes(1);
  });

  it("renders at the scaled size on resize", () => {
    let observe: ResizeObserverCallback = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb: ResizeObserverCallback) { observe = cb; }
      observe() {}
      disconnect() {}
    });
    const { renderer } = mount(testRenderer(), { scale: 0.5 });
    observe([{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry], {} as ResizeObserver);
    expect(renderer.resize).toHaveBeenLastCalledWith(400, 300);
  });

  describe("fallback chain", () => {
    const webglCandidate = (): BackdropCandidate => ({
      kind: "webgl2",
      webgl: true,
      create: () => ({ ...testRenderer("webgl2"), init: (c) => c.getContext("webgl2") !== null }),
    });

    it.each([[false, 0], [true, 1]])("flag %s: getContext(webgl2) called %i times", (flag, calls) => {
      const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      const { runtime } = mount(undefined, { candidates: [webglCandidate()], webgl: flag });
      const webgl = spy.mock.calls.filter(([id]) => id === "webgl" || id === "webgl2");
      expect(webgl).toHaveLength(calls);
      expect(runtime.kind).toBe("css");
    });

    it("moves past a failing init exactly once and ends on css", () => {
      const [bad, good] = [testRenderer("bad"), testRenderer("good")];
      bad.init.mockReturnValue(false);
      const first = mount(good, { candidates: [{ kind: "bad", create: () => bad }, { kind: "good", create: () => good }] });
      expect(bad.init).toHaveBeenCalledTimes(1);
      expect(good.init).toHaveBeenCalledTimes(1);
      expect(first.runtime.kind).toBe("good");
      const all = mount(bad, { candidates: [{ kind: "bad", create: () => bad }] });
      expect(bad.init).toHaveBeenCalledTimes(2);
      expect(all.runtime.kind).toBe("css");
      expect(all.host.querySelector("canvas")).toBeNull();
      run(500);
      expect(bad.frame).not.toHaveBeenCalled();
    });
  });

  it("owns one canvas and releases it on dispose", () => {
    const { host, renderer, runtime } = mount();
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
    runtime.dispose();
    runtime.dispose();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(host.querySelector("canvas")).toBeNull();
  });
});
