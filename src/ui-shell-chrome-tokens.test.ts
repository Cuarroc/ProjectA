import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");
const terminalView = readFileSync(
  resolve(__dirname, "components/TerminalView.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

/** P06 exclusive slice: main/tabs + terminal, stopping before empty-state (S). */
function chromeCss(): string {
  const start = css.indexOf("/* ---- main / tabs");
  const empty = css.indexOf(".empty-state {", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(empty).toBeGreaterThan(start);
  return css.slice(start, empty);
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

function compositeOver(fg: string, bgHex: string): string {
  const rgba = fg.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!rgba) return fg.startsWith("#") ? fg : bgHex;
  const base = parseHex(bgHex);
  const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
  const mix = (c: number, i: number) => Math.round(c * a + i * (1 - a));
  const r = mix(Number(rgba[1]), base.r);
  const g = mix(Number(rgba[2]), base.g);
  const b = mix(Number(rgba[3]), base.b);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
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

function themeBackgroundFromSource(): string {
  const m = terminalView.match(
    /const THEME\s*=\s*\{[\s\S]*?background:\s*["'](#[0-9a-fA-F]{6})["']/,
  );
  expect(m, "THEME.background in TerminalView.tsx").not.toBeNull();
  return m![1].toLowerCase();
}

describe("V161-UI-P06 tabs and terminal chrome", () => {
  it("terminal ground token equals THEME.background", () => {
    const themeBg = themeBackgroundFromSource();
    const { dark, light } = themeVars();
    expect(resolveVar(dark, dark["color-terminal-ground"]).toLowerCase()).toBe(themeBg);
    expect(resolveVar(light, light["color-terminal-ground"]).toLowerCase()).toBe(themeBg);

    const slice = chromeCss();
    const host = ruleBlock(slice, ".terminal-host");
    expect(decl(host, "background")).toBe("var(--color-terminal-ground)");
    expect(slice).not.toMatch(/\.terminal-host\s*\{[^}]*background:\s*#1e1e1e/s);
  });

  it("exited tab label meets 4.5 to 1 without opacity on informational text", () => {
    const slice = chromeCss();
    const exited = ruleBlock(slice, ".tab-exited .tab-label");
    expect(decl(exited, "opacity")).toBeNull();
    expect(exited).toMatch(/text-decoration:\s*line-through/);

    const tab = ruleBlock(slice, ".tab");
    const tabBgToken = decl(tab, "background");
    const labelColorToken = decl(exited, "color");
    expect(tabBgToken).toMatch(/^var\(--[\w-]+\)$/);
    expect(labelColorToken).toMatch(/^var\(--[\w-]+\)$/);

    const tokenName = (ref: string) => ref.match(/^var\(--([\w-]+)\)$/)![1];
    const { dark, light } = themeVars();
    for (const [mode, vars] of [
      ["dark", dark],
      ["light", light],
    ] as const) {
      const bgHex = resolveVar(vars, vars[tokenName(tabBgToken!)]);
      expect(bgHex.startsWith("#"), `${mode} tab bg`).toBe(true);
      const fgRaw = resolveVar(vars, vars[tokenName(labelColorToken!)]);
      const text =
        fgRaw.startsWith("rgba") || fgRaw.startsWith("rgb")
          ? compositeOver(fgRaw, bgHex)
          : fgRaw;
      expect(contrast(text, bgHex), mode).toBeGreaterThanOrEqual(4.5);

      // Active tab paints content; secondary must still clear 4.5:1 there.
      const content = resolveVar(vars, vars["color-content"]);
      const onContent =
        fgRaw.startsWith("rgba") || fgRaw.startsWith("rgb")
          ? compositeOver(fgRaw, content)
          : fgRaw;
      expect(contrast(onContent, content), `${mode} active`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("tab strip uses surface-chrome and bar-control heights", () => {
    const slice = chromeCss();
    const tabbar = ruleBlock(slice, ".tabbar");
    expect(decl(tabbar, "background")).toBe("var(--surface-chrome)");
    expect(decl(tabbar, "backdrop-filter")).toBe("var(--material-chrome-filter)");

    const tab = ruleBlock(slice, ".tab");
    expect(decl(tab, "height")).toBe("var(--ui-bar-control)");

    const pair = slice.match(/\.tab-new,\s*\.tab-split\s*\{([^}]*)\}/);
    expect(pair, ".tab-new/.tab-split rule").not.toBeNull();
    expect(decl(pair![1], "width")).toBe("var(--ui-bar-control)");
    expect(decl(pair![1], "height")).toBe("var(--ui-bar-control)");

    const searchInput = ruleBlock(slice, ".terminal-search-input");
    expect(decl(searchInput, "min-height")).toBe("var(--ui-bar-control)");
    expect(slice).toMatch(
      /\.terminal-search-btn\.button-ghost\s*\{[^}]*min-height:\s*var\(--ui-bar-control\)/s,
    );
  });
});
