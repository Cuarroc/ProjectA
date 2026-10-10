import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

function sidebarCss() {
  const a = css.indexOf("/* ---- sidebar");
  const b = css.indexOf("/* ---- provider dialog", a);
  expect(a).toBeGreaterThanOrEqual(0);
  let s = css.slice(a, b);
  s = s.slice(0, s.indexOf("/* ---- github link dialog")) + s.slice(s.indexOf("/* ---- orchestrator entry"));
  return s.replace(
    /\.queue-section(?:\s+\.queue-actions-sticky)?\s*\{[^}]*\}|\.orchestrator-(?:track|thumb)\s*\{[^}]*\}|@media[^{]+\{[^}]*(?:orchestrator-thumb|badge-queue-sharpening::before)[^}]*\}|\.badge-queue-sharpening::before\s*\{[^}]*\}/gs,
    "",
  );
}

function vars(block: string) {
  const v: Record<string, string> = {};
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim();
  return v;
}

function themes() {
  const ls = css.indexOf("@media (prefers-color-scheme: light)");
  const dark = vars(css.slice(0, ls));
  const lr = css.indexOf(":root", ls);
  return { dark, light: { ...dark, ...vars(css.slice(ls, css.indexOf("\n}", lr))) } };
}

function rv(v: Record<string, string>, raw: string, d = 0): string {
  expect(raw).toBeDefined();
  expect(d).toBeLessThanOrEqual(10);
  const m = raw.match(/var\(--([\w-]+)(?:,\s*[^)]+)?\)/);
  return m ? rv(v, raw.replace(m[0], rv(v, v[m[1]], d + 1)), d + 1) : raw.trim();
}

function contrast(a: string, b: string) {
  const hex = (raw: string) => {
    const m = raw.match(/^#([0-9a-f]{6})$/i);
    expect(m, `hex ${raw}`).not.toBeNull();
    const n = parseInt(m![1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255] as const;
  };
  const lum = ([r, g, b]: readonly [number, number, number]) => {
    const c = (x: number) => {
      const s = x / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  };
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function rule(slice: string, sel: string) {
  const m = slice.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(m, sel).not.toBeNull();
  return m![1];
}

function decl(b: string, p: string) {
  const m = b.match(new RegExp(`${p}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

describe("UT-P10 sidebar tokens", () => {
  it("field border meets 3 to 1 on content elevated and raised in both modes", () => {
    expect(decl(rule(sidebarCss(), ".field"), "border")).toMatch(/var\(--color-control-border\)/);
    const { dark, light } = themes();
    for (const [mode, v] of [
      ["dark", dark],
      ["light", light],
    ] as const) {
      const border = rv(v, v["color-control-border"]);
      for (const s of ["color-content", "color-elevated", "color-raised"] as const) {
        expect(contrast(border, rv(v, v[s])), `${mode} ${s}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("owned sidebar selectors carry no off-scale spacing literals", () => {
    const clean = sidebarCss().replace(/\/\*[\s\S]*?\*\//g, "");
    expect(
      [...clean.matchAll(/[^{\n]+\{[^}]*\}/g)]
        .filter((b) => /\b(?:3|5|7|9|13|14|18|20|22|28)px\b/.test(b[0]))
        .map((b) => b[0].slice(0, 72).replace(/\s+/g, " ")),
    ).toEqual([]);
  });

  it("field has a colour transition and no second focus border colour", () => {
    const s = sidebarCss();
    const t = decl(rule(s, ".field"), "transition") ?? "";
    expect(t).toMatch(/border-color/);
    expect(t).toMatch(/var\(--dur-fast\)/);
    expect(s).not.toMatch(/\.field:focus\s*\{[^}]*border-color/s);
  });

  it("sidebar chrome uses surface-chrome and inset focus on scrolling rows", () => {
    const s = sidebarCss();
    const sb = rule(s, ".sidebar");
    expect(decl(sb, "background")).toBe("var(--surface-chrome)");
    expect(decl(sb, "backdrop-filter")).toMatch(/var\(--material-chrome-filter\)/);
    expect(decl(rule(s, ".button-primary"), "border-radius")).toBe("var(--radius-sm)");
    expect(decl(rule(s, ".button-primary"), "padding")).toMatch(/var\(--space-control-/);
    expect(decl(rule(s, ".button-ghost"), "border-radius")).toBe("var(--radius-sm)");
    expect(s).toMatch(/\.project-button:focus-visible[\s\S]*?outline-offset:\s*-2px/);
    expect(s).toMatch(/\.worker-open:focus-visible[\s\S]*?outline-offset:\s*-2px/);
    expect(s).toMatch(/\.queue-entry-main:focus-visible[\s\S]*?outline-offset:\s*-2px/);
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
