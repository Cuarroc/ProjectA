import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const reduced: { start: number; end: number }[] = [];
for (const match of css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g)) {
  let end = match.index + match[0].length;
  let depth = 1;
  while (depth && end < css.length) {
    if (css[end] === "{") depth++;
    if (css[end] === "}") depth--;
    end++;
  }
  reduced.push({ start: match.index, end });
}
const reducedRules = rules.filter(rule => reduced.some(range => rule.index >= range.start && rule.index < range.end));
const selects = (rule: RegExpMatchArray, selector: string) => rule[1].split(",").map(s => s.trim()).includes(selector);

describe("M1 motion contract", () => {
  it("defines the shared duration and easing scale", () => {
    for (const [name, value] of Object.entries({ instant: 90, fast: 120, base: 200, slow: 320 })) {
      expect(css.includes(`--dur-${name}: ${value}ms;`), name).toBe(true);
      expect(reducedRules.some(rule => rule[1].trim() === ":root" && rule[2].includes(`--dur-${name}: 80ms;`))).toBe(true);
    }
    for (const [name, curve] of Object.entries({ out: "0.2, 0.8, 0.2, 1", in: "0.4, 0, 1, 1", move: "0.2, 0, 0, 1" })) {
      expect(css.includes(`--ease-${name}: cubic-bezier(${curve});`), name).toBe(true);
    }
  });

  it("uses tokenized timings and safe transition properties", () => {
    for (const rule of rules) {
      for (const declaration of rule[2].matchAll(/\b((?:transition|animation)[\w-]*):\s*([^;]+);/g)) {
        expect(declaration[2], rule[1]).not.toMatch(/\b\d*\.?\d+m?s\b/);
        if (declaration[1] !== "transition") continue;
        // PKG-R owns the existing shell grid transition outside M1's ranges.
        if (rule[1].trim() === ".app") {
          expect(declaration[2]).toBe("grid-template-columns var(--motion-pane) var(--ease-spatial)");
          continue;
        }
        for (const part of declaration[2].split(",")) {
          expect(part.trim().split(/\s+/)[0]).toMatch(/^(background(?:-color)?|border-color|color|opacity|transform|box-shadow)$/);
        }
      }
    }
    expect(css).not.toMatch(/transition(?:-property)?:\s*all\b/);
  });

  it("shares one spinner keyframe and keeps static reduced motion cues", () => {
    const infinite = rules.filter(rule => /animation:[^;]*\binfinite\b/.test(rule[2]));
    expect(infinite).toHaveLength(2);
    expect([...css.matchAll(/@keyframes\s+[\w-]*spin\b/g)].map(match => match[0])).toEqual(["@keyframes spin"]);
    for (const rule of infinite) {
      const selector = rule[1].trim();
      expect(rule[2]).toMatch(/animation:\s*spin var\(--spin-duration\) linear infinite;/);
      // Same-specificity overrides must follow the normal rule in the cascade.
      const override = reducedRules.find(candidate => selects(candidate, selector) && candidate.index > rule.index);
      expect(override?.[2], selector).toMatch(/animation:\s*none;/);
      const marker = selector.includes("::before") ? selector : `${selector}::before`;
      expect(reducedRules.some(candidate => selects(candidate, marker) && /content:\s*"…";/.test(candidate[2])), marker).toBe(true);
    }
  });

  it("snaps the switch thumb under reduced motion", () => {
    const thumb = rules.find(rule => selects(rule, ".orchestrator-thumb"));
    expect(thumb?.[2]).toContain("transition: transform var(--dur-instant) var(--ease-move);");
    const override = reducedRules.find(rule => selects(rule, ".orchestrator-thumb") && rule.index > thumb!.index);
    expect(override?.[2]).toMatch(/transition(?:-property)?:\s*none;/);
  });
});
