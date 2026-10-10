/**
 * @vitest-environment node
 *
 * Chromium computed-style checks for P02 layout contracts. A CSS-text regex
 * cannot prove cascade winners (role indent vs `.modal .profile-item`).
 */
import { resolve } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

const STYLES = resolve(__dirname, "styles.css");

const BODY = `
<div class="app">
  <div class="profile-field">
    <ul class="profile-list">
      <li class="profile-row">
        <div class="profile-main"><span class="profile-name">Settings profile</span></div>
      </li>
    </ul>
  </div>
  <div class="modal">
    <ul class="profile-list">
      <li>
        <button type="button" class="profile-item">
          <span class="profile-name">Base</span>
          <span class="profile-command">cmd</span>
        </button>
      </li>
      <li>
        <button type="button" class="profile-item profile-item-variant">
          <span class="profile-name">Role</span>
          <span class="profile-command">cmd</span>
        </button>
      </li>
    </ul>
  </div>
</div>
`;

async function measure() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head></head><body>${BODY}</body></html>`, {
      waitUntil: "domcontentloaded",
    });
    await page.addStyleTag({ path: STYLES });
    const measured = await page.evaluate(() => {
      const settings = getComputedStyle(document.querySelector(".profile-field .profile-list")!);
      const base = getComputedStyle(
        document.querySelector(".profile-item:not(.profile-item-variant)")!,
      );
      const variant = getComputedStyle(document.querySelector(".profile-item-variant")!);
      return {
        settingsMaxHeight: settings.maxHeight,
        settingsListStyle: settings.listStyleType,
        settingsMarginTop: settings.marginTop,
        basePadLeft: parseFloat(base.paddingLeft),
        variantPadLeft: parseFloat(variant.paddingLeft),
      };
    });
    return measured;
  } finally {
    await browser.close();
  }
}

describe("UT-P02 modal layout (Chromium)", () => {
  it("role variant keeps deeper left padding than base profile item", async () => {
    const m = await measure();
    expect(m.variantPadLeft).toBeGreaterThan(m.basePadLeft);
    expect(m.variantPadLeft).toBe(24);
  });

  it("settings profile list does not inherit picker max-height", async () => {
    const m = await measure();
    expect(m.settingsMaxHeight).toBe("none");
    expect(m.settingsListStyle).toBe("none");
    expect(m.settingsMarginTop).toBe("0px");
  });
});
