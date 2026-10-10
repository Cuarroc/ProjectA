import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cssPath = resolve(__dirname, "motion.css");
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

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
