import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** UT-P09: the diff, merge and verdict rules speak tokens only. */

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");
type Rule = { selector: string; decls: Map<string, string> };

function rulesOf(text: string): Rule[] {
  return [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    decls: new Map(
      m[2].split(";").flatMap((d): [string, string][] => {
        const at = d.indexOf(":");
        return at > 0 ? [[d.slice(0, at).trim(), d.slice(at + 1).trim()]] : [];
      }),
    ),
  }));
}

const between = (from: string, to: string) => css.slice(css.indexOf(from), css.indexOf(to, css.indexOf(from)));
// The card summary rules inside the diff section belong to the board package.
const p09 = [
  ...rulesOf(between("/* ---- diff review (Phase 5)", "/* ---- skill packs (Phase 6)")),
  ...rulesOf(between("/* ---- merge (Phase 13)", "/* ---- role variants (Phase 15)")),
  ...rulesOf(css.slice(css.indexOf(".diff-verdict-choice {"))).filter((r) => r.selector.startsWith(".diff-verdict")),
].filter((r) => !/^\.board-card-(expand|actions-spacer|diff)/.test(r.selector));
const decl = (selector: string, prop: string) => p09.find((r) => r.selector === selector)?.decls.get(prop);

describe("diff and merge tokens", () => {
  it("references no undefined variable and no var fallback", () => {
    const defined = new Set([...css.matchAll(/^\s*--([\w-]+)\s*:/gm)].map((m) => m[1]));
    const bad = p09.flatMap((r) =>
      [...r.decls].filter(([, v]) =>
        [...v.matchAll(/var\(\s*--([\w-]+)\s*(,)?/g)].some((m) => !defined.has(m[1]) || m[2]),
      ).map(([p, v]) => `${r.selector} { ${p}: ${v} }`),
    );
    expect(bad).toEqual([]);
  });

  it("keeps spacing radius and type on the scale", () => {
    const spaced = /^(padding|margin)(-\w+)?$|^(row-|column-)?gap$/;
    const literal = /(?<![\w.-])-?\d*\.?\d+(px|rem|em)\b/g;
    const bad: string[] = [];
    for (const r of p09) {
      for (const [prop, value] of r.decls) {
        const bare = value.replace(/var\([^)]*\)/g, "");
        // 1px hairlines and the 56px comment indent (clears the line-number gutter) stay literal.
        const off = [...bare.matchAll(literal)].filter(
          (m) => m[0] !== "1px" && !(r.selector === ".diff-comment-box" && m[0] === "56px"),
        );
        const radius = prop === "border-radius" && !/^(var\(--radius-[\w-]+\)|50%)$/.test(value);
        const type = prop === "font-size" && !/^var\(--text-[\w-]+\)$/.test(value);
        if ((spaced.test(prop) && off.length) || radius || type) bad.push(`${r.selector} { ${prop}: ${value} }`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("leaves the line gutters and the sticky comment offset where they were", () => {
    expect(decl(".diff-gutter", "width")).toBe("42px");
    expect(decl(".diff-marker", "width")).toBe("12px");
    expect(decl(".diff-sign", "width")).toBe("14px");
    expect(decl(".diff-comment-box", "position")).toBe("sticky");
    expect(decl(".diff-comment-box", "left")).toBe("0");
    expect(decl(".diff-comment-box", "margin")).toMatch(/ 56px$/);
  });

  it("paints bars and containers with surface roles and keeps the hunks solid", () => {
    expect(decl(".detailbar", "height")).toBe("var(--shell-bar-h)");
    expect(decl(".detailbar", "background")).toBe("var(--surface-chrome)");
    expect(decl(".detailbar", "backdrop-filter")).toBe("var(--material-chrome-filter)");
    expect(decl(".diff-files", "background")).toBe("var(--surface-chrome)");
    for (const sel of [".diff-readiness", ".diff-comments", ".diff-comment-box"]) {
      expect(decl(sel, "background"), sel).toBe("var(--surface-card)");
    }
    expect(decl(".diff-pane", "background")).toBe("var(--bg)");
  });

  it("draws the review-class divider with the separator role", () => {
    expect(decl(".diff-review-class", "border-bottom")).toBe("1px solid var(--border)");
  });

  it("takes the blocked merge look from the disabled tokens", () => {
    expect(decl(".board-card-merge:disabled", "background")).toBe("var(--color-disabled-bg)");
    expect(decl(".board-card-merge:disabled", "color")).toBe("var(--color-disabled-fg)");
  });
});
