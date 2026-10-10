import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AttentionInbox from "./components/AttentionInbox";
import { listRecommendations } from "./lib/ipc";

vi.mock("./lib/ipc", () => ({
  listRecommendations: vi.fn(),
  describeError: (cause: unknown) => String(cause),
}));

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

function attentionCss(): string {
  const start = css.indexOf("/* ---- questions (Phase 21 Q2)");
  const badgeAt = css.indexOf("/* A count on the Fragen segment.", start);
  const railStart = css.indexOf(".rail-questions {");
  const railEnd = css.indexOf("/* ---- shared hint line (InfoLine)");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(badgeAt).toBeGreaterThan(start);
  return css.slice(start, badgeAt) + css.slice(railStart, railEnd);
}

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function themeVars(): { dark: Record<string, string>; light: Record<string, string> } {
  const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
  const dark = parseVars(css.slice(0, lightStart));
  const lightRoot = css.indexOf(":root", lightStart);
  return { dark, light: { ...dark, ...parseVars(css.slice(lightStart, css.indexOf("\n}", lightRoot))) } };
}

function resolveVar(vars: Record<string, string>, value: string, depth = 0): string {
  expect(value, "missing token").toBeDefined();
  const match = value.match(/^var\(--([\w-]+)\)$/);
  return match ? resolveVar(vars, vars[match[1]], depth + 1) : value.trim();
}

function parseHex(raw: string): { r: number; g: number; b: number } {
  const m = raw.match(/^#([0-9a-f]{6})$/i);
  expect(m).not.toBeNull();
  const n = parseInt(m![1], 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
}

function lum(c: { r: number; g: number; b: number }): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [lum(parseHex(a)), lum(parseHex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function compositeOver(fg: string, bgHex: string): string {
  const rgba = fg.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!rgba) return bgHex;
  const base = parseHex(bgHex);
  const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
  const mix = (c: number, i: number) => Math.round(c * a + i * (1 - a));
  return `#${[mix(+rgba[1], base.r), mix(+rgba[2], base.g), mix(+rgba[3], base.b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("UT-P03 attention tokens", () => {
  it("every attention var resolves without needs-you or raw fallbacks", () => {
    const slice = attentionCss();
    expect(slice.includes("--state-needs-you-fg")).toBe(false);
    expect(/var\(--[\w-]+,\s*#[0-9a-fA-F]{3,8}\)/.test(slice)).toBe(false);
    expect(/var\(--[\w-]+,\s*var\(--color-accent/.test(slice)).toBe(false);
    const { dark, light } = themeVars();
    for (const name of ["state-needs-fg", "state-danger-fg", "color-elevated", "color-hover", "color-content", "space-6", "space-7", "weight-semibold"]) {
      expect(resolveVar(dark, dark[name])).toBeTruthy();
      expect(resolveVar(light, light[name])).toBeTruthy();
    }
    expect(slice).toMatch(/var\(--state-needs-fg\)/);
    expect(slice).toMatch(/\.view-head\s*\{[^}]*padding:\s*var\(--space-6\)\s+var\(--space-7\)/s);
    expect(slice).toMatch(/\.question-send\s*\{[^}]*min-height:\s*var\(--ui-control-min\)/s);
    expect(slice).toMatch(/\.question-option\s*\{[^}]*min-height:\s*24px/s);
    expect(slice).toMatch(/\.attention-grade\s*\{[^}]*font-weight:\s*var\(--weight-semibold\)/s);
  });

  it("needs text meets 4.5 to 1 on elevated and hover in both modes", () => {
    for (const [mode, vars] of Object.entries(themeVars()) as [string, Record<string, string>][]) {
      const needs = resolveVar(vars, vars["state-needs-fg"]);
      const danger = resolveVar(vars, vars["state-danger-fg"]);
      const elevated = resolveVar(vars, vars["color-elevated"]);
      const hover = compositeOver(resolveVar(vars, vars["color-hover"]), resolveVar(vars, vars["color-content"]));
      expect(contrast(needs, elevated), mode).toBeGreaterThanOrEqual(4.5);
      expect(contrast(needs, hover), mode).toBeGreaterThanOrEqual(4.5);
      expect(contrast(danger, elevated), mode).toBeGreaterThanOrEqual(4.5);
      expect(contrast(danger, hover), mode).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("shows no empty copy before the first recommendations load", async () => {
    vi.mocked(listRecommendations).mockImplementation(() => new Promise(() => {}));
    render(<AttentionInbox cards={[]} projectId="pj-1" onOpen={vi.fn()} />);
    await act(async () => {});
    expect(screen.queryByText(/Nichts wartet/)).toBeNull();
    expect(screen.getByText(/werden geladen/)).toBeTruthy();
  });
});

describe("UT-P03 attention load settle", () => {
  afterEach(() => {
    vi.mocked(listRecommendations).mockReset();
  });

  it("reveals the empty copy only after recommendations settle", async () => {
    vi.mocked(listRecommendations).mockResolvedValue([]);
    render(<AttentionInbox cards={[]} projectId="pj-1" onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Nichts wartet/)).toBeTruthy());
  });

  it("keeps empty copy hidden while a blockers error is visible", async () => {
    vi.mocked(listRecommendations).mockResolvedValue([]);
    render(
      <AttentionInbox cards={[]} projectId="pj-1" blockersError="Readiness fehlt" onOpen={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Readiness fehlt"));
    expect(screen.queryByText(/Nichts wartet/)).toBeNull();
  });
});
