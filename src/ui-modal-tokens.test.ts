import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

/** P02 exclusive slice: after `.modal { … }` until usage view. */
function modalCss(): string {
  const header = "/* ---- modals: profile picker, new worker";
  const usage = "/* ---- usage view";
  const start = css.indexOf(header);
  const end = css.indexOf(usage, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const slice = css.slice(start, end);
  // X1 owns `.modal-backdrop` / base `.modal`; drop those two blocks.
  return slice
    .replace(/\.modal-backdrop\s*\{[^}]*\}/s, "")
    .replace(/\.modal\s*\{[^}]*\}/s, "");
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

function decl(block: string, prop: string): string | null {
  const m = block.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

function ruleBlock(slice: string, selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const m = slice.match(re);
  expect(m, `missing rule ${selector}`).not.toBeNull();
  return m![1];
}

describe("UT-P02 modal tokens", () => {
  it("profile hover pairs meet 4.5 to 1 without a solid accent fill", () => {
    const slice = modalCss();
    expect(slice).not.toMatch(
      /\.modal\s+\.profile-item:hover\s*\{[^}]*background:\s*var\(--accent\)/s,
    );
    expect(slice).toMatch(/\.modal\s+\.profile-item:hover\s*\{/);
    const hover = ruleBlock(slice, ".modal .profile-item:hover");
    const bg = decl(hover, "background");
    expect(bg).toBe("var(--color-hover)");

    // Name and command both paint primary on hover.
    expect(slice).toMatch(
      /\.modal\s+\.profile-item:hover\s+\.profile-name,\s*\n\s*\.modal\s+\.profile-item:hover\s+\.profile-command/s,
    );

    const { dark, light } = themeVars();
    for (const [mode, vars] of [
      ["dark", dark],
      ["light", light],
    ] as const) {
      const elevated = resolveVar(vars, vars["color-elevated"]);
      const ground = compositeOver(resolveVar(vars, vars["color-hover"]), elevated);
      const primary = resolveVar(vars, vars["color-text-primary"]);
      const text = primary.startsWith("rgba") ? compositeOver(primary, ground) : primary;
      expect(contrast(text, ground), mode).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("modal title body and footer share one horizontal inset token", () => {
    const slice = modalCss();
    const title = ruleBlock(slice, ".modal-title");
    const body = ruleBlock(slice, ".modal-body");
    const actions = ruleBlock(slice, ".modal-actions");
    const titlePad = decl(title, "padding") ?? "";
    const bodyPad = decl(body, "padding") ?? "";
    const actionsPad = decl(actions, "padding") ?? "";
    const horiz = (pad: string) => {
      const parts = pad.trim().split(/\s+/);
      if (parts.length === 1) return parts[0];
      if (parts.length === 2 || parts.length === 3) return parts[1];
      if (parts.length === 4) return parts[1];
      return parts[parts.length - 1];
    };
    expect(horiz(titlePad)).toBe("var(--ui-panel-pad)");
    expect(horiz(bodyPad)).toBe("var(--ui-panel-pad)");
    expect(horiz(actionsPad)).toBe("var(--ui-panel-pad)");
  });

  it("picker profile-list and profile-name are scoped under modal", () => {
    const slice = modalCss();
    expect(slice).toMatch(/\.modal\s+\.profile-list\s*\{/);
    expect(slice).toMatch(/\.modal\s+\.profile-name\s*\{/);
    expect(slice).toMatch(/\.modal\s+\.profile-command\s*\{/);
    // Base row stays unscoped so `.profile-item-variant` padding-left can win.
    expect(slice).toMatch(/(?:^|\n)\.profile-item\s*\{/);
    expect(slice).not.toMatch(/(?:^|\n)\.modal\s+\.profile-item\s*\{/);
    expect(slice).not.toMatch(/(?:^|\n)\.profile-list\s*\{/);
    expect(slice).not.toMatch(/(?:^|\n)\.profile-name\s*\{/);
    expect(slice).not.toMatch(/(?:^|\n)\.profile-command\s*\{/);
    const list = ruleBlock(slice, ".modal .profile-list");
    expect(decl(list, "padding")).toMatch(/var\(--space-/);
    expect(decl(list, "max-height")).toBe("50vh");
  });

  it("footer control tokens resolve for equal height and weight", () => {
    const slice = modalCss();
    const footer = ruleBlock(slice, ".modal-actions button");
    expect(decl(footer, "min-height")).toBe("var(--ui-control-min)");
    expect(decl(footer, "font-weight")).toBe("var(--weight-medium)");
    // `--weight-medium` lives on `:root`; `--ui-control-min` on `.app` (T2).
    expect(css).toMatch(/--weight-medium\s*:\s*\d/);
    expect(css).toMatch(/--ui-control-min\s*:\s*\d+px/);
    const { dark } = themeVars();
    expect(resolveVar(dark, dark["weight-medium"])).toMatch(/^\d/);
  });
});
