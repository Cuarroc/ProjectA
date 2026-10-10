import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("nested materials use tint without blur or shadow while outer materials keep depth", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(resolve(__dirname, "glass.css"), "utf8");
  const fixture = document.createElement("div");
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

        // jsdom omits the vendor property from computed styles. Inspect the
        // matching nested rule in CSSOM as well to protect WebKit consumers.
        const nestedRule = Array.from(style.sheet!.cssRules)
          .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
          .find((rule) => inner.matches(rule.selectorText)
            && rule.style.getPropertyValue("backdrop-filter") === "none");
        expect(nestedRule?.style.getPropertyValue("-webkit-backdrop-filter"), pair)
          .toBe("none");
        expect(nestedRule && outer.matches(nestedRule.selectorText), pair).toBe(false);
        const outerRule = Array.from(style.sheet!.cssRules)
          .find((rule) => rule instanceof CSSStyleRule
            && rule.selectorText === `.g-${outerMaterial}`) as CSSStyleRule;
        expect(outerRule.style.getPropertyValue("-webkit-backdrop-filter"), pair)
          .toBe(`var(--g-${role}-blur)`);
      }
    }
  } finally {
    fixture.remove();
    style.remove();
  }
});
