import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regressions for the ui-ux-pro-max audit of the app (.pa/report_uiux_audit_app.md).
 * Each block names its finding. Palette, font and token names are not touched:
 * the checks are about focus rings that were switched off again and pointer
 * targets below the 24 CSS px floor of WCAG 2.2.
 */
const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

/** The declaration block of the first rule whose selector list matches. */
function blockOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `rule ${selector} not found in styles.css`).not.toBeNull();
  return match![1];
}

describe("APP-1 / APP-2: nothing switches the focus ring off again", () => {
  it.each([".field:focus", ".convo-input:focus", ".command-chat-input:focus", ".question-input:focus"])(
    "%s keeps the global :focus-visible ring and only adds its border colour",
    (selector) => {
      expect(blockOf(selector)).not.toMatch(/outline:\s*(none|0)/);
    },
  );

  it(".design-editor does not hide keyboard focus", () => {
    expect(blockOf(".design-editor")).not.toMatch(/outline:\s*(none|0)/);
  });

  it(".profile-item focus is a ring, not the same filled surface as hover", () => {
    expect(css).not.toMatch(/\.profile-item:focus-visible\s*\{[^}]*outline:\s*none/);
    const hoverBlock = css.match(/\.profile-item:hover,\s*\.profile-item:focus-visible\s*\{/);
    expect(hoverBlock, "focus-visible must not share the hover block").toBeNull();
  });
});

describe("APP-3: icon buttons reach 24x24 CSS px without changing their painted size", () => {
  const targets = [
    ".section-action",
    ".project-remove",
    ".project-github",
    ".viewbar-rail-toggle",
    ".board-card-menu-button",
    ".tab-close",
    ".project-gear",
  ];

  it("every small icon button extends its hit area through a ::after overlay", () => {
    const rule = css.match(/\n((?:\.[\w-]+::after,\s*)+\.[\w-]+::after)\s*\{([^}]*)\}/);
    expect(rule, "shared ::after hit-area rule missing").not.toBeNull();
    const selectors = rule![1].replace(/\s+/g, "");
    for (const target of targets) {
      expect(selectors, `${target} is missing from the hit-area rule`).toContain(`${target}::after`);
    }
    expect(rule![2]).toMatch(/content:\s*""/);
    expect(rule![2]).toMatch(/position:\s*absolute/);
    // 18px (.tab-close) plus 2 * 3px reaches 24px; the larger buttons overshoot, which is fine.
    expect(rule![2]).toMatch(/inset:\s*-3px/);
  });

  it("the overlay is anchored, so it never escapes the button", () => {
    const anchor = css.match(/\n((?:\.[\w-]+,\s*)+\.[\w-]+)\s*\{\s*position:\s*relative;\s*\}/);
    expect(anchor, "shared position: relative rule missing").not.toBeNull();
    const selectors = anchor![1].replace(/\s+/g, "");
    for (const target of targets) {
      expect(selectors, `${target} is not anchored`).toContain(target);
    }
  });
});

describe("APP-16: type sizes come from the token scale", () => {
  it("no raw font-size below the base size duplicates or undercuts a token", () => {
    const raw = css.match(/font-size:\s*(9|10|10\.5|11|12|12\.5)px/g) ?? [];
    expect(raw, "hardcoded small font sizes").toEqual([]);
  });

  it("the scale itself still starts at 10.5px", () => {
    expect(css).toMatch(/--text-xs:\s*10\.5px/);
  });
});

describe("review B-1: line-height never undercuts the token size", () => {
  it(".board-card-usage-label keeps its line box at least as tall as its text", () => {
    expect(blockOf(".board-card-usage-label")).not.toMatch(/line-height:\s*10px/);
    expect(blockOf(".board-card-usage-label")).toMatch(/line-height:\s*1;/);
  });

  it("the three sidebar project buttons are spaced so their hit areas do not overlap", () => {
    expect(blockOf(".project-row")).toMatch(/gap:\s*6px/);
  });
});

describe("APP-17: state tints come from the token layer the contrast gate sees", () => {
  it("no hardcoded coloured rgba() background survives below the token block", () => {
    const afterTokens = css.slice(css.indexOf("--state-danger-bg"));
    const coloured = afterTokens.match(/background:\s*rgba\((?!(?:255|0), ?(?:255|0), ?(?:255|0))[^)]*\)/g) ?? [];
    expect(coloured, "coloured rgba backgrounds").toEqual([]);
  });
});
