import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse, list, type AnyNode } from "postcss";
import { describe, expect, it } from "vitest";

const cssPath = resolve(__dirname, "motion.css");
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Match declarations, not line numbers: adding tokens must not move the exceptions.
// DS-05 must shrink this list; never add entries (original inputs.css:48, motion.css:78).
const layoutAllowlist = [
  "inputs/inputs.css|.g-meter b|transition:width var(--g-dur-3, 320ms) var(--g-ease, cubic-bezier(.2, .8, .2, 1))",
  "motion.css|.g-meter b|transition:width var(--g-dur-3) var(--g-ease-out)",
];
const layoutProperty = /^(?:(?:min-|max-)?(?:width|height|(?:inline|block)-size)|top|left|right|bottom|inset(?:-.+)?|margin(?:-.+)?|padding(?:-.+)?|grid-template(?:-.+)?|flex-basis|(?:row-|column-)?gap|font-size|line-height|border(?:-.+)?-width)$/;
function layoutMotion(source: string): string[] {
  const findings: string[] = [];
  parse(source).walkDecls((decl) => {
    const prop = decl.prop.toLowerCase().replace(/^-(?:webkit|moz)-/, "");
    let inKeyframes = false;
    for (let parent: AnyNode | undefined = decl.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && /keyframes$/i.test(parent.name)) inKeyframes = true;
    }
    const transition = /^(transition|transition-property)$/.test(prop) && list.comma(decl.value).some((part) => {
      const property = list.space(part)[0].toLowerCase();
      return layoutProperty.test(property) || property === "all" || /^(?:[.\d-]|var\(|ease|linear|steps\(|cubic-bezier\()/i.test(property);
    });
    if (transition || (inKeyframes && layoutProperty.test(prop))) {
      const owner = decl.parent?.type === "rule" ? decl.parent.selector : "";
      findings.push(`${owner}|${decl.prop}:${decl.value}`);
    }
  });
  return findings;
}

describe("DS-01 motion scale", () => {
  it("provides the complete additive duration easing distance and stagger scale", async () => {
    const values = Object.fromEntries([...rootBlock(css).matchAll(/(--g-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
    for (const [name, value] of Object.entries({
      "dur-instant": "90ms", "dur-1": "120ms", "dur-2": "200ms", "dur-3": "320ms",
      "dur-4": "480ms", "dur-5": "720ms", "dur-exit": "120ms", "dur-ambient": "6s",
      "ease-out": "cubic-bezier(0.2, 0.8, 0.2, 1)", "ease-in": "cubic-bezier(0.4, 0, 1, 1)",
      "ease-move": "cubic-bezier(0.2, 0, 0, 1)", "ease-path": "cubic-bezier(0.45, 0, 0.25, 1)",
      "move-1": "4px", "move-2": "8px", "move-3": "16px", "enter-dist": "var(--g-move-1)",
      stagger: "0ms", "ambient-play": "paused", "orb-trail": "0",
    })) expect(values[`--g-${name}`], name).toBe(value);
    const { motionDuration, motionEasing } = await import(resolve(__dirname, "motion/tokens.ts"));
    expect(motionDuration).toEqual({ instant: "--g-dur-instant", fast: "--g-dur-1", base: "--g-dur-2", slow: "--g-dur-3", hop: "--g-dur-4", travel: "--g-dur-5", exit: "--g-dur-exit", ambient: "--g-dur-ambient" });
    expect(motionEasing).toEqual({ standard: "--g-ease-move", enter: "--g-ease-out", exit: "--g-ease-in", emphasis: "--g-ease-path" });
  });

  it("owns one rise and fade definition and bounds stagger to eight steps", () => {
    const layout = readFileSync(resolve(__dirname, "layout/layout.css"), "utf8");
    for (const name of ["g-rise", "g-fade"]) expect((css + layout).match(new RegExp(`@keyframes ${name}\\b`, "g"))).toHaveLength(1);
    const sheet = parse(css);
    const rules = new Map<string, string>();
    sheet.walkRules((rule) => { rules.set(rule.selector, rule.toString()); });
    expect(rules.get(".g-stagger > *")).toContain("animation: g-rise var(--g-dur-2) var(--g-ease-out) both");
    expect(rules.get(".g-stagger > *")).toContain("animation-delay: calc(var(--i, 0) * var(--g-stagger))");
    for (let i = 1; i <= 8; i++) expect(rules.get(`.g-stagger > :nth-child(${i})`)).toContain(`--i: ${i - 1}`);
    expect(rules.get(".g-stagger > :nth-child(n+9)")).toContain("--i: 8");
  });

  it("rejects layout transitions and animated keyframes including shorthand and nested rules", () => {
    for (const property of ["width", "height", "top", "left", "margin", "padding", "margin-top", "padding-inline", "grid-template-columns"]) {
      expect(layoutMotion(`@media (hover: hover) { .x { transition: opacity 1s, ${property} 200ms; } }`)).toHaveLength(1);
      expect(layoutMotion(`.x { transition-property: ${property}; }`)).toHaveLength(1);
      expect(layoutMotion(`@keyframes bad { to { ${property}: 10px; } }`)).toHaveLength(1);
    }
    for (const value of ["all 1s", "200ms", "var(--unknown)"]) expect(layoutMotion(`.x { transition: ${value}; }`)).toHaveLength(1);
    expect(layoutMotion("/* transition: width 1s; */ .x { width: 10px; transition: transform 1s cubic-bezier(.2, 0, 0, 1), opacity 1s; } @keyframes good { to { transform: translateY(8px); opacity: 0; } }")).toEqual([]);
  });

  it("rejects logical sizing spacing typography and border width motion", () => {
    for (const property of ["inline-size", "block-size", "min-inline-size", "max-inline-size", "min-block-size", "max-block-size", "flex-basis", "gap", "row-gap", "column-gap", "font-size", "line-height", "border-width", "border-top-width", "border-inline-start-width"]) {
      expect(layoutMotion(`.x { transition: ${property} 200ms; }`), property).toHaveLength(1);
      expect(layoutMotion(`.x { transition-property: ${property}; }`), property).toHaveLength(1);
      expect(layoutMotion(`@keyframes bad { to { ${property}: 10px; } }`), property).toHaveLength(1);
    }
  });

  it("disables standalone entry stagger and layout animations under reduced motion", () => {
    for (const [source, selectors] of [
      [css, [".g-stagger > *", ".g-sheet", ".g-view", ".g-is-new"]],
      [readFileSync(resolve(__dirname, "layout/layout.css"), "utf8"), [".g-tabpanel", ".g-sheet", ".g-toast"]],
    ] as const) {
      const disabled = new Set<string>();
      parse(mediaBody(source, "prefers-reduced-motion:\\s*reduce")).walkRules((rule) => {
        rule.walkDecls("animation", (decl) => {
          if (decl.value === "none") rule.selectors.forEach((selector) => disabled.add(selector));
        });
      });
      for (const selector of selectors) expect(disabled, selector).toContain(selector);
    }
  });

  it("allows only the two existing meter layout animations across all design stylesheets", () => {
    const findings = readdirSync(__dirname, { recursive: true }).filter((file) => String(file).endsWith(".css")).flatMap((file) =>
      layoutMotion(readFileSync(resolve(__dirname, String(file)), "utf8")).map((entry) => `${String(file).replaceAll("\\", "/")}|${entry}`));
    expect(findings.sort()).toEqual([...layoutAllowlist].sort());
  });
});

function rootBlock(source: string): string {
  const match = source.match(/:root\s*\{([^{}]*)\}/);
  expect(match, ":root block").toBeTruthy();
  return match![1];
}

function mediaBody(source: string, query: string): string {
  const start = source.search(new RegExp(`@media\\s*\\(${query}\\)\\s*\\{`));
  expect(start, query).toBeGreaterThanOrEqual(0);
  let i = source.indexOf("{", start) + 1;
  let depth = 1;
  while (depth && i < source.length) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(start, i);
}

describe("V2-F2 motion contract", () => {
  it("loads the motion stylesheet in the mounted glass shell", () => {
    const shell = readFileSync(resolve(__dirname, "../shell/Shell.tsx"), "utf8");
    expect(shell.match(/import\s+["']\.\.\/design\/motion\.css["'];/g)).toHaveLength(1);
    expect(shell).toContain('className="g-shell"');
  });

  it("covers shell descendants and pressed controls in reduced motion", () => {
    const reduced = mediaBody(css, "prefers-reduced-motion:\\s*reduce");
    const rule = reduced.match(/([^{}]+)\{[^{}]*animation:\s*none\s*!important[^{}]*\}/);
    expect(rule, "reduced-motion animation rule").toBeTruthy();
    const selectors = rule![1].split(",").map((selector) => selector.trim());
    for (const root of [".g-shell", "[data-g-portal]"]) {
      for (const suffix of ["", "::before", "::after", " *", " *::before", " *::after"]) {
        expect(selectors, `${root}${suffix}`).toContain(`${root}${suffix}`);
      }
    }
    expect(rule![0]).toMatch(/transition-duration:\s*0ms\s*!important/);
    expect(rule![0]).toMatch(/transition-delay:\s*0ms\s*!important/);
    const controls = readFileSync(resolve(__dirname, "controls/controls.css"), "utf8");
    const reducedControls = mediaBody(controls, "prefers-reduced-motion:\\s*reduce");
    for (const selector of [".g-btn:active", ".g-fchip:active", ".g-seg button:active"]) {
      expect(reducedControls).toContain(selector);
    }
    expect(reducedControls).toMatch(/\{\s*transform:\s*none;/);
  });

  it("defines motion duration easing and press tokens under the g namespace", () => {
    const root = rootBlock(css);
    expect(root).toMatch(/--g-dur-1:\s*120ms;/);
    expect(root).toMatch(/--g-dur-2:\s*200ms;/);
    expect(root).toMatch(/--g-dur-3:\s*320ms;/);
    expect(root).toMatch(/--g-ease-out:\s*cubic-bezier\(\s*0?\.2\s*,\s*0?\.8\s*,\s*0?\.2\s*,\s*1\s*\);/);
    expect(root).toMatch(/--g-ease-spring:\s*cubic-bezier\(\s*0?\.34\s*,\s*1\.3\s*,\s*0?\.64\s*,\s*1\s*\);/);
    expect(root).toMatch(/--g-ease:\s*var\(--g-ease-out\);/);
    expect(root).toMatch(/--g-dur:\s*var\(--g-dur-1\);/);
    expect(root).toMatch(/--g-press-scale:\s*0\.98;/);
  });

  it("declares the board keyframes and wires sheet view row-in and the live run pulse", () => {
    for (const name of ["g-enter", "g-rise", "g-fade", "g-row-in", "g-live"]) {
      expect(css, name).toMatch(new RegExp(`@keyframes\\s+${name}\\b`));
    }
    expect(css).toMatch(/\.g-sheet\s*\{[^}]*animation:\s*g-rise\s+var\(--g-dur-2\)\s+var\(--g-ease-out\)/);
    expect(css).toMatch(/\.g-view\s*[,{][^}]*animation:\s*g-fade\s+var\(--g-dur-2\)\s+var\(--g-ease-out\)/);
    expect(css).toMatch(/\.g-is-new\s*\{[^}]*animation:\s*g-row-in\s+var\(--g-dur-2\)\s+var\(--g-ease-out\)/);
    expect(css).toMatch(
      /\.g-st--run::before\s*\{[^}]*animation:\s*g-live\s+2s\s+ease-in-out\s+infinite/,
    );
  });

  it("exposes a shared g-press active scale using the press token", () => {
    expect(css).toMatch(
      /\.g-press\s*\{[^}]*transition:\s*transform\s+var\(--g-dur\)\s+var\(--g-ease\)/,
    );
    expect(css).toMatch(
      /\.g-press:active\s*\{[^}]*transform:\s*scale\(\s*var\(--g-press-scale\)\s*\)/,
    );
  });

  it("turns off every animation and transition under prefers-reduced-motion", () => {
    const reduced = mediaBody(css, "prefers-reduced-motion:\\s*reduce");
    expect(reduced).toMatch(/--g-press-scale:\s*1;/);
    // Selector list and kill-switch declarations must share one rule (incl. portal roots).
    expect(reduced).toMatch(
      /\.g-app \*,\s*\.g-app \*::before,\s*\.g-app \*::after,\s*\[data-g-portal\],\s*\[data-g-portal\]::before,\s*\[data-g-portal\]::after,\s*\[data-g-portal\] \*,\s*\[data-g-portal\] \*::before,\s*\[data-g-portal\] \*::after\s*\{[^}]*animation:\s*none\s*!important[^}]*transition-duration:\s*0ms\s*!important[^}]*transition-delay:\s*0ms\s*!important/,
    );
  });
});
