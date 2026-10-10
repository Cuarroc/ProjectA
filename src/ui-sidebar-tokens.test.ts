import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

/** P10 exclusive slice: sidebar through task queue, minus GitHub dialog + L1/M1. */
function sidebarCss(): string {
  const start = css.indexOf("/* ---- sidebar");
  const end = css.indexOf("/* ---- provider dialog", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  let slice = css.slice(start, end);
  const ghStart = slice.indexOf("/* ---- github link dialog");
  const orchStart = slice.indexOf("/* ---- orchestrator entry");
  expect(ghStart).toBeGreaterThanOrEqual(0);
  expect(orchStart).toBeGreaterThan(ghStart);
  slice = slice.slice(0, ghStart) + slice.slice(orchStart);
  // L1 owns queue-section scroll owner + sticky actions block.
  slice = slice
    .replace(/\.queue-section\s*\{[^}]*\}/s, "")
    .replace(/\.queue-section\s+\.queue-actions-sticky\s*\{[^}]*\}/s, "");
  // M1 owns orchestrator track/thumb motion and sharpening spinner.
  slice = slice
    .replace(/\.orchestrator-track\s*\{[^}]*\}/s, "")
    .replace(/\.orchestrator-thumb\s*\{[^}]*\}/s, "")
    .replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.orchestrator-thumb[^}]*\}/s, "")
    .replace(/\.badge-queue-sharpening::before\s*\{[^}]*\}/s, "")
    .replace(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.badge-queue-sharpening::before[^}]*\}/s,
      "",
    );
  return slice;
}

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
  expect(lightStart).toBeGreaterThan(0);
  const dark = parseVars(css.slice(0, lightStart));
  const lightRoot = css.indexOf(":root", lightStart);
  const lightEnd = css.indexOf("\n}", lightRoot);
  return { dark, light: { ...dark, ...parseVars(css.slice(lightStart, lightEnd)) } };
}

function resolveVar(vars: Record<string, string>, value: string, depth = 0): string {
  expect(value, "missing token").toBeDefined();
  expect(depth).toBeLessThanOrEqual(10);
  const match = value.match(/var\(--([\w-]+)(?:,\s*[^)]+)?\)/);
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

function ruleBlock(slice: string, selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const m = slice.match(re);
  expect(m, `missing rule ${selector}`).not.toBeNull();
  return m![1];
}

function decl(block: string, prop: string): string | null {
  const m = block.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

/** Off-scale px literals that must move to spacing tokens (contract UT-9). */
const OFF_SCALE = /\b(?:3|5|7|9|13|14|18|20|22|28)px\b/;

describe("UT-P10 sidebar tokens", () => {
  it("field border meets 3 to 1 on content elevated and raised in both modes", () => {
    const slice = sidebarCss();
    const field = ruleBlock(slice, ".field");
    expect(decl(field, "border")).toMatch(/var\(--color-control-border\)/);

    const { dark, light } = themeVars();
    for (const [mode, vars] of [
      ["dark", dark],
      ["light", light],
    ] as const) {
      const border = resolveVar(vars, vars["color-control-border"]);
      for (const surface of ["color-content", "color-elevated", "color-raised"] as const) {
        const ground = resolveVar(vars, vars[surface]);
        expect(contrast(border, ground), `${mode} ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("owned sidebar selectors carry no off-scale spacing literals", () => {
    const slice = sidebarCss();
    const clean = slice.replace(/\/\*[\s\S]*?\*\//g, "");
    const hits = [...clean.matchAll(/[^{\n]+\{[^}]*\}/g)].flatMap((block) => {
      const body = block[0];
      if (!OFF_SCALE.test(body)) return [];
      return [`off-scale in: ${body.slice(0, 80).replace(/\s+/g, " ")}`];
    });
    expect(hits).toEqual([]);
  });

  it("field has a colour transition and no second focus border colour", () => {
    const slice = sidebarCss();
    const field = ruleBlock(slice, ".field");
    const transition = decl(field, "transition") ?? "";
    expect(transition).toMatch(/border-color/);
    expect(transition).toMatch(/var\(--dur-fast\)/);
    expect(slice).not.toMatch(/\.field:focus\s*\{[^}]*border-color/s);
  });

  it("sidebar chrome uses surface-chrome and inset focus on scrolling rows", () => {
    const slice = sidebarCss();
    const sidebar = ruleBlock(slice, ".sidebar");
    expect(decl(sidebar, "background")).toBe("var(--surface-chrome)");
    expect(decl(sidebar, "backdrop-filter") ?? decl(sidebar, "-webkit-backdrop-filter")).toMatch(
      /var\(--material-chrome-filter\)/,
    );

    const primary = ruleBlock(slice, ".button-primary");
    expect(decl(primary, "border-radius")).toBe("var(--radius-sm)");
    expect(decl(primary, "padding")).toMatch(/var\(--space-control-/);

    const ghost = ruleBlock(slice, ".button-ghost");
    expect(decl(ghost, "border-radius")).toBe("var(--radius-sm)");

    expect(slice).toMatch(
      /\.project-button:focus-visible[\s\S]*?outline-offset:\s*-2px/,
    );
    expect(slice).toMatch(/\.worker-open:focus-visible[\s\S]*?outline-offset:\s*-2px/);
    expect(slice).toMatch(/\.queue-entry-main:focus-visible[\s\S]*?outline-offset:\s*-2px/);
  });

  it("queue action pair shares one control height and weight", () => {
    const slice = sidebarCss();
    const pair = slice.match(
      /\.queue-actions\s+\.button-primary\s*,\s*\.queue-actions\s+\.button-subtle\s*\{([^}]*)\}/s,
    );
    expect(pair, "queue-actions equal pair rule").not.toBeNull();
    expect(decl(pair![1], "min-height")).toBe("var(--ui-control-min)");
    expect(decl(pair![1], "font-weight")).toMatch(/var\(--weight-/);
  });
});
