import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

/** Semantic roles UT-P00 adds for later consumer packages. */
const FOUNDATION_ROLES = [
  "color-control-border",
  "color-terminal-ground",
  "color-scrim",
  "space-control-y",
  "space-control-x",
  "space-row-y",
  "space-row-x",
  "space-card",
  "line-copy",
  "line-meta",
  "tracking-label",
  "weight-semibold",
] as const;

const SURFACE_ROLES = ["color-content", "color-elevated", "color-raised"] as const;

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of clean.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

function themeVars(): { dark: Record<string, string>; light: Record<string, string> } {
  const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
  expect(lightStart, "light theme block").toBeGreaterThan(0);
  const dark = parseVars(css.slice(0, lightStart));
  const lightRoot = css.indexOf(":root", lightStart);
  const lightEnd = css.indexOf("\n}", lightRoot);
  const light = { ...dark, ...parseVars(css.slice(lightStart, lightEnd)) };
  return { dark, light };
}

function resolveVar(vars: Record<string, string>, value: string, depth = 0): string {
  expect(value, "missing token").toBeDefined();
  expect(depth, `var cycle at ${value}`).toBeLessThanOrEqual(10);
  const match = value.match(/var\(--([\w-]+)\)/);
  if (!match) return value.trim();
  const inner = resolveVar(vars, vars[match[1]], depth + 1);
  return resolveVar(vars, value.replace(match[0], inner), depth + 1);
}

function parseHex(raw: string): { r: number; g: number; b: number } {
  const m = raw.match(/^#([0-9a-f]{6})$/i);
  expect(m, `expected solid hex got ${raw}`).not.toBeNull();
  const n = parseInt(m![1], 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
}

function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(parseHex(a)), luminance(parseHex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("UT-P00 token foundation", () => {
  it("foundation roles resolve in dark and light", () => {
    const { dark, light } = themeVars();
    for (const role of FOUNDATION_ROLES) {
      expect(dark[role], `dark missing --${role}`).toBeTruthy();
      expect(light[role], `light missing --${role}`).toBeTruthy();
      expect(resolveVar(dark, dark[role])).toBeTruthy();
      expect(resolveVar(light, light[role])).toBeTruthy();
    }
    expect(resolveVar(dark, dark["color-control-border"]).toLowerCase()).toBe("#808087");
    expect(resolveVar(light, light["color-control-border"]).toLowerCase()).toBe("#7f7f87");
    expect(resolveVar(dark, dark["color-terminal-ground"]).toLowerCase()).toBe("#1e1e1e");
    expect(resolveVar(light, light["color-terminal-ground"]).toLowerCase()).toBe("#1e1e1e");
    expect(resolveVar(dark, dark["color-scrim"]).replace(/\s+/g, "")).toBe("rgba(0,0,0,0.5)");
  });

  it("control border meets 3 to 1 on content elevated and raised", () => {
    const { dark, light } = themeVars();
    for (const [mode, vars] of [
      ["dark", dark],
      ["light", light],
    ] as const) {
      const border = resolveVar(vars, vars["color-control-border"]);
      for (const surface of SURFACE_ROLES) {
        const ground = resolveVar(vars, vars[surface]);
        const ratio = contrast(border, ground);
        expect(ratio, `${mode} --${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("type and density defaults stay on the compact scale", () => {
    const { dark } = themeVars();
    expect(resolveVar(dark, dark["space-1"])).toBe("2px");
    expect(resolveVar(dark, dark["space-3"])).toBe("6px");
    expect(resolveVar(dark, dark["space-5"])).toBe("10px");
    expect(resolveVar(dark, dark["space-control-y"])).toBe("6px");
    expect(resolveVar(dark, dark["space-control-x"])).toBe("12px");
    expect(resolveVar(dark, dark["space-row-y"])).toBe("6px");
    expect(resolveVar(dark, dark["space-row-x"])).toBe("10px");
    expect(resolveVar(dark, dark["space-card"])).toBe("8px");
    expect(resolveVar(dark, dark["text-md"])).toBe("12px");
    expect(resolveVar(dark, dark["text-lg"])).toBe("15px");
    expect(resolveVar(dark, dark["line-copy"])).toBe("1.5");
    expect(resolveVar(dark, dark["line-meta"])).toBe("1.4");
    expect(resolveVar(dark, dark["tracking-label"])).toBe("0.04em");
    expect(resolveVar(dark, dark["weight-semibold"])).toBe("600");
  });
});
