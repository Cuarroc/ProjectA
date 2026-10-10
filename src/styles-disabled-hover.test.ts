import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * V161-UI-U3: a hover rule has the same specificity as `.x:disabled` and sits
 * later in the file, so a bare `.x:hover` lights up a disabled control. The
 * disabled plate must also come from the T2 tokens, not from surface tokens
 * that vanish on a card.
 */
const css = readFileSync(resolve(__dirname, "styles.css"), "utf8").replace(/\r\n/g, "\n");

function blockOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `rule ${selector} not found in styles.css`).not.toBeNull();
  return match![1];
}

/** A hover rule must carry :not(:disabled); a bare `.x:hover` is the defect. */
function expectHoverExcludesDisabled(base: string): void {
  const bare = new RegExp(`(?:^|\\n|,\\s*)${base.replace(".", "\\.")}:hover\\s*[,{]`);
  expect(css).not.toMatch(bare);
  expect(blockOf(`${base}:hover:not(:disabled)`)).toMatch(/\S/);
}

describe("hover rules exclude disabled controls", () => {
  it(".button-ghost:hover only matches enabled controls", () => {
    expectHoverExcludesDisabled(".button-ghost");
  });

  it(".empty-action:hover only matches enabled controls", () => {
    expectHoverExcludesDisabled(".empty-action");
  });

  it(".empty-action-ghost:hover only matches enabled controls", () => {
    expectHoverExcludesDisabled(".empty-action-ghost");
  });

  it(".bootstrap-retry:hover only matches enabled controls", () => {
    expectHoverExcludesDisabled(".bootstrap-retry");
  });
});

describe("disabled plates use the T2 disabled tokens", () => {
  it(".button-danger:disabled paints the disabled plate", () => {
    const block = blockOf(".button-danger:disabled");
    expect(block).toContain("background: var(--color-disabled-bg)");
    expect(block).toContain("color: var(--color-disabled-fg)");
    expect(block).not.toMatch(/--color-elevated|--color-text-tertiary/);
  });

  it(".settings-port-row .button-ghost:disabled uses the disabled foreground", () => {
    const block = blockOf(".settings-port-row .button-ghost:disabled");
    expect(block).toContain("color: var(--color-disabled-fg)");
    expect(block).not.toContain("--color-text-tertiary");
  });
});
