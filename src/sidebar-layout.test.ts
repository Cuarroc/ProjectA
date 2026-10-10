import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NT-2: the sidebar must scroll instead of letting its sections overlap.
 * With `overflow: visible` (the pre-fix state) the sections painted over each
 * other at normal window heights, and on the Workers tab the "Archive" button
 * fell below the viewport with no way to reach it — measured y=1421 against a
 * 1369px window, and `scrollTop = scrollHeight` did not move the container.
 */
const css = readFileSync(resolve(__dirname, "styles.css"), "utf8");

/** The declaration block of one top-level rule, or a failure telling which. */
function blockOf(selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  expect(match, `rule ${selector} not found in styles.css`).not.toBeNull();
  return match![1];
}

describe("sidebar layout (NT-2)", () => {
  it("the sidebar itself scrolls when its content outgrows the window", () => {
    expect(blockOf("\\.sidebar")).toMatch(/overflow-y:\s*auto/);
  });

  it("sections keep their natural height instead of shrinking into each other", () => {
    expect(blockOf("\\.sidebar-section")).toMatch(/flex-shrink:\s*0/);
  });

  it("queue and recommendation sections do not nest-scroll or shrink", () => {
    // UM-3: nested section scroll clipped Einreihen; the sidebar scrolls alone.
    expect(blockOf("\\.queue-section")).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(blockOf("\\.queue-section")).toMatch(/overflow:\s*visible/);
    expect(blockOf("\\.reco-section")).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(blockOf("\\.reco-section")).toMatch(/overflow:\s*visible/);
  });

  it("queue sticky actions use space-2 padding", () => {
    expect(blockOf("\\.queue-section \\.queue-actions-sticky")).toMatch(
      /padding-block:\s*var\(--space-2\)/,
    );
  });

  it("learn section does not clip with overflow hidden", () => {
    expect(blockOf("\\.learn-section")).toMatch(/overflow:\s*visible/);
  });

  it("settings body keeps its own vertical scroll", () => {
    expect(blockOf("\\.settings-body")).toMatch(/overflow-y:\s*auto/);
  });
});
