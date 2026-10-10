import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeBackdrop from "../../../components/ThemeBackdrop";
import {
  createBackdropRuntime,
  holdBackdrop,
  registerBackdrop,
  type BackdropCandidate,
  type BackdropOptions,
  type BackdropRuntime,
} from "./runtime";

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

const testRenderer = (kind = "test", costMs = 0) => ({
  kind,
  init: vi.fn(() => true),
  frame: vi.fn<(at: number) => void>(() => void (t += costMs)),
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
    ["hold", () => holdBackdrop()],
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
    expect(runtime.stats.pauseReason).toBe(reason);
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

  it("downgrades a slow renderer in the order scale fps static", () => {
    const { renderer, runtime } = mount(testRenderer("slow", 5), { fps: 30 });
    run(1000);
    const first = renderer.resize.mock.calls[0];
    run(8000);
    expect(runtime.stats.downgrades).toEqual(["scale", "fps", "static"]);
    expect(renderer.resize.mock.calls.at(-1)![0]).toBeLessThan(first[0]);
    const frozen = renderer.frame.mock.calls.length;
    run(1000);
    expect(renderer.frame.mock.calls.length).toBe(frozen);
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
      expect(runtime.stats.kind).toBe("css");
    });

    it("moves past a failing init exactly once and ends on css", () => {
      const [bad, good] = [testRenderer("bad"), testRenderer("good")];
      bad.init.mockReturnValue(false);
      const first = mount(good, { candidates: [{ kind: "bad", create: () => bad }, { kind: "good", create: () => good }] });
      expect(bad.init).toHaveBeenCalledTimes(1);
      expect(good.init).toHaveBeenCalledTimes(1);
      expect(first.runtime.stats.kind).toBe("good");
      const all = mount(bad, { candidates: [{ kind: "bad", create: () => bad }] });
      expect(bad.init).toHaveBeenCalledTimes(2);
      expect(all.runtime.stats.kind).toBe("css");
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

  it("stretches the scaled-down canvas over its host by CSS", () => {
    const { host } = mount();
    const style = host.querySelector("canvas")!.style;
    expect([style.width, style.height]).toEqual(["100%", "100%"]);
  });

  it("publishes the stats hook only on request and removes it on dispose", () => {
    const quiet = mount();
    expect(window.__PA_BACKDROP_STATS__).toBeUndefined();
    quiet.runtime.dispose();
    const { runtime } = mount(testRenderer(), { exposeStats: true });
    run(1000);
    expect(window.__PA_BACKDROP_STATS__).toMatchObject({ kind: "test", pauseReason: null, downgrades: [] });
    expect(window.__PA_BACKDROP_STATS__!.fps).toBeGreaterThan(0);
    runtime.dispose();
    expect(window.__PA_BACKDROP_STATS__).toBeUndefined();
  });

  describe("ThemeBackdrop", () => {
    afterEach(() => registerBackdrop("liquid", []));

    it("keeps Klassisch empty and mounts a registered renderer for other styles", () => {
      const renderer = testRenderer("registered");
      registerBackdrop("liquid", [{ kind: "registered", create: () => renderer }]);
      expect(render(createElement(ThemeBackdrop, { style: "klassisch" })).container.firstChild).toBeNull();
      const { container, unmount } = render(createElement(ThemeBackdrop, { style: "liquid" }));
      expect(container.querySelector(".theme-backdrop canvas")).not.toBeNull();
      unmount();
      expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it("pauses while an aria-modal dialog is open", async () => {
      const renderer = testRenderer("registered");
      registerBackdrop("liquid", [{ kind: "registered", create: () => renderer }]);
      vi.stubGlobal("performance", { now: () => t });
      vi.stubGlobal("requestAnimationFrame", (cb: () => void) => ((pending = cb), 1));
      vi.stubGlobal("cancelAnimationFrame", () => (pending = null));
      render(createElement(ThemeBackdrop, { style: "liquid" }));
      run(200);
      expect(renderer.frame).toHaveBeenCalled();
      const dialog = document.createElement("div");
      dialog.setAttribute("aria-modal", "true");
      document.body.append(dialog);
      await Promise.resolve(); // MutationObserver callbacks run as a microtask
      const frames = renderer.frame.mock.calls.length;
      run(500);
      expect(renderer.frame.mock.calls.length).toBe(frames);
      dialog.remove();
      await Promise.resolve();
      run(500);
      expect(renderer.frame.mock.calls.length).toBeGreaterThan(frames);
    });
  });
});
