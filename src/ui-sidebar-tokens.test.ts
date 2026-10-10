import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");
/** P10 slice: sidebar→queue, minus GitHub dialog and L1/M1 exclusives. */
function sidebarCss(): string {
  const start = css.indexOf("/* ---- sidebar");
  const end = css.indexOf("/* ---- provider dialog", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  let slice = css.slice(start, end);
  const gh = slice.indexOf("/* ---- github link dialog");
  const orch = slice.indexOf("/* ---- orchestrator entry");
  slice = slice.slice(0, gh) + slice.slice(orch);
  return slice
    .replace(/\.queue-section\s*\{[^}]*\}/s, "")
    .replace(/\.queue-section\s+\.queue-actions-sticky\s*\{[^}]*\}/s, "")
    .replace(/\.orchestrator-track\s*\{[^}]*\}/s, "")
    .replace(/\.orchestrator-thumb\s*\{[^}]*\}/s, "")
    .replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.orchestrator-thumb[^}]*\}/s, "")
    .replace(/\.badge-queue-sharpening::before\s*\{[^}]*\}/s, "")
    .replace(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.badge-queue-sharpening::before[^}]*\}/s,
      "",
    );
}

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function themeVars() {
  const lightStart = css.indexOf("@media (prefers-color-scheme: light)");
  const dark = parseVars(css.slice(0, lightStart));
  const lightRoot = css.indexOf(":root", lightStart);
  const lightEnd = css.indexOf("\n}", lightRoot);
  return { dark, light: { ...dark, ...parseVars(css.slice(lightStart, lightEnd)) } };
}

function resolveVar(vars: Record<string, string>, value: string, depth = 0): string {
  expect(value).toBeDefined();
  expect(depth).toBeLessThanOrEqual(10);
  const m = value.match(/var\(--([\w-]+)(?:,\s*[^)]+)?\)/);
  if (!m) return value.trim();
  return resolveVar(vars, value.replace(m[0], resolveVar(vars, vars[m[1]], depth + 1)), depth + 1);
}

function parseHex(raw: string) {
  const m = raw.match(/^#([0-9a-f]{6})$/i);
  expect(m, `hex ${raw}`).not.toBeNull();
  const n = parseInt(m![1], 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
}

function luminance({ r, g, b }: { r: number; g: number; b: number }) {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function contrast(a: string, b: string) {
  const [x, y] = [luminance(parseHex(a)), luminance(parseHex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function ruleBlock(slice: string, selector: string) {
  const m = slice.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  expect(m, selector).not.toBeNull();
  return m![1];
}

function decl(block: string, prop: string) {
  const m = block.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}
const OFF = /\b(?:3|5|7|9|13|14|18|20|22|28)px\b/;
describe("UT-P10 sidebar tokens", () => {
  it("field border meets 3 to 1 on content elevated and raised in both modes", () => {
    const field = ruleBlock(sidebarCss(), ".field");
    expect(decl(field, "border")).toMatch(/var\(--color-control-border\)/);
    const { dark, light } = themeVars();
    for (const [mode, vars] of [
      ["dark", dark],
      ["light", light],
    ] as const) {
      const border = resolveVar(vars, vars["color-control-border"]);
      for (const surface of ["color-content", "color-elevated", "color-raised"] as const) {
        expect(contrast(border, resolveVar(vars, vars[surface])), `${mode} ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("owned sidebar selectors carry no off-scale spacing literals", () => {
    const clean = sidebarCss().replace(/\/\*[\s\S]*?\*\//g, "");
    const hits = [...clean.matchAll(/[^{\n]+\{[^}]*\}/g)]
      .filter((b) => OFF.test(b[0]))
      .map((b) => b[0].slice(0, 72).replace(/\s+/g, " "));
    expect(hits).toEqual([]);
  });

  it("field has a colour transition and no second focus border colour", () => {
    const slice = sidebarCss();
    const t = decl(ruleBlock(slice, ".field"), "transition") ?? "";
    expect(t).toMatch(/border-color/);
    expect(t).toMatch(/var\(--dur-fast\)/);
    expect(slice).not.toMatch(/\.field:focus\s*\{[^}]*border-color/s);
  });

  it("sidebar chrome uses surface-chrome and inset focus on scrolling rows", () => {
    const slice = sidebarCss();
    const sidebar = ruleBlock(slice, ".sidebar");
    expect(decl(sidebar, "background")).toBe("var(--surface-chrome)");
    expect(decl(sidebar, "backdrop-filter")).toMatch(/var\(--material-chrome-filter\)/);
    expect(decl(ruleBlock(slice, ".button-primary"), "border-radius")).toBe("var(--radius-sm)");
    expect(decl(ruleBlock(slice, ".button-primary"), "padding")).toMatch(/var\(--space-control-/);
    expect(decl(ruleBlock(slice, ".button-ghost"), "border-radius")).toBe("var(--radius-sm)");
    expect(slice).toMatch(/\.project-button:focus-visible[\s\S]*?outline-offset:\s*-2px/);
    expect(slice).toMatch(/\.worker-open:focus-visible[\s\S]*?outline-offset:\s*-2px/);
    expect(slice).toMatch(/\.queue-entry-main:focus-visible[\s\S]*?outline-offset:\s*-2px/);
  });

  it("queue action pair shares one control height and weight", () => {
    const pair = sidebarCss().match(
      /\.queue-actions\s+\.button-primary\s*,\s*\.queue-actions\s+\.button-subtle\s*\{([^}]*)\}/s,
    );
    expect(pair, "equal pair").not.toBeNull();
    expect(decl(pair![1], "min-height")).toBe("var(--ui-control-min)");
    expect(decl(pair![1], "font-weight")).toMatch(/var\(--weight-/);
  });
});
