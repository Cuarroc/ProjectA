import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * V161-UI-F2 — pressed surfaces (UM-17), field/row transitions, APP-3 hit
 * areas for the UM-15 glyph classes. Scans only the owned motion and APP-3
 * slices of styles.css.
 */
const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

const motionStart = css.indexOf("/* ---- motion");
const focusStart = css.indexOf("\n:focus-visible {", motionStart);
const motion = css.slice(motionStart, focusStart === -1 ? undefined : focusStart);

const app3Start = css.indexOf("/* APP-3");
const app3End = css.indexOf("\n.goal-passthrough {", app3Start);
const app3 = css.slice(app3Start, app3End === -1 ? undefined : app3End);

/** Base class from a compound selector like `.tab:hover:not(.tab-active)`. */
function baseClass(selector: string): string | null {
  const match = selector.trim().match(/^\.([\w-]+)/);
  return match ? `.${match[1]}` : null;
}

function selectorList(block: string): string[] {
  return block
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

describe("V161-UI-F2 states", () => {
  it("every class in the shared hover list also has :active pressed surface", () => {
    const hoverRule = motion.match(
      /((?:\.[\w-:()>.\s]+,\s*)+\.[\w-:()>.\s]+)\s*\{([^}]*background:\s*var\(--color-hover\)[^}]*)\}/,
    );
    expect(hoverRule, "shared row/tab/segment :hover list missing").not.toBeNull();

    const hoverClasses = new Set(
      selectorList(hoverRule![1])
        .map(baseClass)
        .filter((value): value is string => Boolean(value)),
    );
    expect([...hoverClasses].length).toBeGreaterThanOrEqual(8);

    const activeRule = motion.match(
      /((?:\.[\w-:()>.\s]+,\s*)+\.[\w-:()>.\s]+)\s*\{([^}]*background:\s*var\(--color-pressed\)[^}]*)\}/,
    );
    expect(activeRule, "shared :active pressed surface missing").not.toBeNull();

    const activeClasses = new Set(
      selectorList(activeRule![1])
        .map(baseClass)
        .filter((value): value is string => Boolean(value)),
    );

    for (const cls of hoverClasses) {
      expect(activeClasses.has(cls), `${cls} has :hover but no :active pressed surface`).toBe(true);
    }

    for (const required of [
      ".project-button",
      ".worker-row",
      ".rail-item",
      ".board-card",
      ".tab",
      ".segment",
      ".panel-tab",
      ".settings-tab",
      ".queue-row",
      ".question-option",
    ]) {
      expect(activeClasses.has(required), `${required} missing from :active pressed list`).toBe(true);
    }
  });

  it("surface and field transitions never touch layout properties", () => {
    const transitionRule = motion.match(
      /((?:\.[\w-]+,\s*)+\.[\w-]+)\s*\{\s*transition:\s*([^}]+)\}/,
    );
    // Prefer the selection/state group that includes .field once present.
    const fieldGroup = [...motion.matchAll(/((?:\.[\w-]+,\s*)+\.[\w-]+)\s*\{\s*transition:\s*([^}]+)\}/g)].find(
      (match) => selectorList(match[1]).includes(".field"),
    );
    expect(fieldGroup, "transition list including .field missing").toBeTruthy();

    const selectors = selectorList(fieldGroup![1]);
    for (const required of [
      ".field",
      ".project-button",
      ".worker-row",
      ".rail-item",
      ".board-card",
      ".tab",
      ".segment",
      ".queue-row",
      ".project-row",
      ".queue-entry",
      ".usage-row",
    ]) {
      expect(selectors, `${required} missing from transition list`).toContain(required);
    }

    const props = fieldGroup![2]
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
    for (const prop of props) {
      expect(prop).toMatch(/^(background(?:-color)?|border-color|color|opacity|transform|box-shadow)$/);
    }
    expect(props).not.toContain("width");
    expect(props).not.toContain("height");
    expect(props).not.toContain("padding");
    expect(props).not.toContain("margin");
    expect(transitionRule).not.toBeNull();
  });

  it("each UM-15 class reaches 24x24 through the APP-3 hit-area overlay", () => {
    const um15 = [".rail-collapse", ".command-chat-expand", ".status-provider-action"];

    const anchor = app3.match(/((?:\.[\w-]+,\s*)+\.[\w-]+)\s*\{\s*position:\s*relative;\s*\}/);
    expect(anchor, "APP-3 position:relative list missing").not.toBeNull();
    const anchored = selectorList(anchor![1]).map((s) => s.replace(/\s+/g, ""));

    const after = app3.match(/((?:\.[\w-]+::after,\s*)+\.[\w-]+::after)\s*\{([^}]*)\}/);
    expect(after, "APP-3 ::after hit-area list missing").not.toBeNull();
    const afterSelectors = selectorList(after![1]).map((s) => s.replace(/\s+/g, ""));
    expect(after![2]).toMatch(/inset:\s*-3px/);

    for (const cls of um15) {
      expect(anchored, `${cls} not anchored`).toContain(cls);
      expect(afterSelectors, `${cls} missing ::after overlay`).toContain(`${cls}::after`);
    }

    // 12px-tall status provider needs a deeper inset than the shared -3px.
    const deep = app3.match(/\.status-provider-action::after\s*\{([^}]*)\}/);
    expect(deep, ".status-provider-action::after depth override missing").not.toBeNull();
    expect(deep![1]).toMatch(/inset:\s*-6px/);
  });
});
