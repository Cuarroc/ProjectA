import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("nested materials use tint without blur or shadow while outer materials keep depth", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(resolve(__dirname, "glass.css"), "utf8");
  const fixture = document.createElement("div");
  // jsdom drops vendor-prefixed declarations even from CSSOM. Preserve their
  // source blocks and match their selectors against the same DOM fixture.
  const rules = Array.from(style.textContent.replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g), ([, selector, body]) => ({
    selector: selector.trim(), body,
  }));
  document.head.append(style);
  document.body.append(fixture);
  try {
    for (const outerMaterial of ["chrome", "glass"]) {
      for (const innerMaterial of ["chrome", "glass"]) {
        const outer = document.createElement("section");
        const wrapper = document.createElement("div");
        const inner = document.createElement("article");
        outer.className = `g-${outerMaterial}`;
        inner.className = `g-${innerMaterial}`;
        wrapper.append(inner);
        outer.append(wrapper);
        fixture.replaceChildren(outer);
        const innerStyle = getComputedStyle(inner);
        const outerStyle = getComputedStyle(outer);
        const pair = `${outerMaterial} / ${innerMaterial}`;
        const role = outerMaterial === "chrome" ? "chrome" : "content";

        expect(innerStyle.getPropertyValue("backdrop-filter"), pair).toBe("none");
        expect(innerStyle.background, pair).toBe("var(--g-tint)");
        expect(innerStyle.boxShadow, pair).toBe("none");
        expect(outerStyle.getPropertyValue("backdrop-filter"), pair)
          .toBe(`var(--g-${role}-blur)`);
        expect(outerStyle.background, pair).toBe(`var(--g-${role}-bg)`);
        expect(outerStyle.boxShadow, pair).toBe("var(--g-spec), var(--g-shadow)");

        const nestedRule = rules.find((rule) => inner.matches(rule.selector)
          && /(?:^|;)\s*backdrop-filter:\s*none\s*;/.test(rule.body));
        expect(nestedRule?.body, pair).toMatch(/-webkit-backdrop-filter:\s*none\s*;/);
        expect(nestedRule && outer.matches(nestedRule.selector), pair).toBe(false);
        const outerRule = rules.find((rule) => rule.selector === `.g-${outerMaterial}`);
        expect(outerRule?.body, pair)
          .toContain(`-webkit-backdrop-filter: var(--g-${role}-blur)`);
      }
    }
  } finally {
    fixture.remove();
    style.remove();
  }
});
