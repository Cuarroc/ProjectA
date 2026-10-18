import { act, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { saveMotionMode } from "../motion/motionMode";
import { POSE_FRAMES, ROLES, type Pose } from "./figures/poses";
import type { HallScene } from "./fixtures";
import { Hall } from "./Hall";
import { MAX_MOVING, pickMoving } from "./useHallMotion";
import figureMap from "./sprites/hall-figures.json";

// DS-H-06 (ASSETS.md §7): three motion modes, at most twelve moving figures, pause when the document is hidden.
const SCENE: HallScene = {
  pieces: [
    { id: "probe-a", name: "hall.piece.a", role: "plan", state: "run" },
    { id: "probe-b", name: "hall.piece.b", role: "build", state: "need" },
    { id: "probe-c", name: "hall.piece.c", role: "check", state: "rev" },
    { id: "probe-d", name: "hall.piece.a", role: "ops" },
  ],
};
const moving = (c: HTMLElement) => [...c.querySelectorAll("[data-animate]")].map((e) => e.getAttribute("data-sprite"));
const scene = (c: HTMLElement) => c.querySelector<HTMLElement>(".g-hall__scene")!;

/** jsdom has no matchMedia: stand in for the OS reduced-motion setting. */
const osReduced = (matches: boolean) => vi.stubGlobal("matchMedia", () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }));
const hidden = (value: boolean) => act(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
  document.dispatchEvent(new Event("visibilitychange"));
});

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.motion; });
afterEach(() => { vi.unstubAllGlobals(); hidden(false); });

it("calm animates run and keeps need and review and unknown still", () => {
  const { container } = render(<Hall scene={SCENE} />);
  expect(scene(container).dataset.motion).toBe("calm");
  expect(moving(container)).toEqual(["fig-plan-run-0"]);
});

it("lively animates run too and still keeps waiting and unknown still", () => {
  saveMotionMode("lively");
  const { container } = render(<Hall scene={SCENE} />);
  expect(scene(container).dataset.motion).toBe("lively");
  expect(moving(container)).toEqual(["fig-plan-run-0"]);
});

it("off and reduced motion show frame 0", () => {
  saveMotionMode("off");
  const off = render(<Hall scene={SCENE} />);
  expect(scene(off.container).dataset.motion).toBe("still");
  expect(moving(off.container)).toEqual([]);
  off.unmount();
  saveMotionMode("lively");
  osReduced(true);
  const reduced = render(<Hall scene={SCENE} />);
  expect(scene(reduced.container).dataset.motion).toBe("still");
  expect(moving(reduced.container)).toEqual([]);
});

it("at most twelve figures animate", () => {
  const poses: Pose[] = Array.from({ length: 20 }, () => "run");
  const picked = pickMoving(poses);
  expect(MAX_MOVING).toBe(12);
  expect(picked.filter(Boolean)).toHaveLength(12);
  expect(picked.slice(0, 12).every(Boolean)).toBe(true);
  expect(pickMoving(["need", "rev", "done", "unknown", "ready", "ok", "bad"])).toEqual(Array(7).fill(false));
});

it("a hidden document pauses the hall", () => {
  const { container } = render(<Hall scene={SCENE} />);
  expect(scene(container).dataset.paused).toBeUndefined();
  hidden(true);
  expect(scene(container).dataset.paused).toBe("true");
  hidden(false);
  expect(scene(container).dataset.paused).toBeUndefined();
});

it("an off-screen scene pauses the hall", () => {
  let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: typeof notify) { notify = cb; } observe() {} disconnect() {} });
  const { container } = render(<Hall scene={SCENE} />);
  expect(scene(container).dataset.paused).toBeUndefined();
  act(() => notify([{ isIntersecting: false }]));
  expect(scene(container).dataset.paused).toBe("true");
  act(() => notify([{ isIntersecting: true }]));
  expect(scene(container).dataset.paused).toBeUndefined();
});

it("the second run frame sits right next to the first in every role strip", () => {
  const map = figureMap as Record<string, number[]>;
  expect(POSE_FRAMES.run).toBe(2);
  for (const role of ROLES) {
    const [x, y, w] = map[`fig-${role}-run-0`];
    expect(map[`fig-${role}-run-1`].slice(0, 2)).toEqual([x + w, y]);
  }
});

it("hall motion css takes every duration from the tokens", () => {
  const css = readFileSync(resolve(__dirname, "motion.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(css).toMatch(/var\(--g-dur-/);
  expect(css).not.toMatch(/\d\s*m?s\b/);
  expect(css).toMatch(/prefers-reduced-motion: reduce/);
});
