import { expect, test } from "@playwright/test";

test("empty state is centred in terminal-area", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".app")).toBeVisible();

  await page.getByRole("tab", { name: "Agents" }).click();
  const empty = page.locator(".terminal-area .empty-state");
  await expect(empty).toBeVisible();

  const metrics = await page.evaluate(() => {
    const area = document.querySelector(".terminal-area");
    const state = document.querySelector(".terminal-area .empty-state");
    if (!area || !state) {
      throw new Error("empty-state or terminal-area missing");
    }
    const areaBox = area.getBoundingClientRect();
    const stateBox = state.getBoundingClientRect();
    return {
      areaMidX: areaBox.left + areaBox.width / 2,
      stateMidX: stateBox.left + stateBox.width / 2,
      areaWidth: areaBox.width,
      stateWidth: stateBox.width,
    };
  });

  expect(Math.abs(metrics.areaMidX - metrics.stateMidX)).toBeLessThan(12);
  expect(metrics.stateWidth).toBeGreaterThan(metrics.areaWidth * 0.85);
});

test("Einreihen is in viewport after sidebar scroll at 900x600", async ({ page }) => {
  await page.addInitScript(() => {
    window.__PROJECTA_E2E_RICH__ = true;
  });
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/");
  await expect(page.locator(".app")).toBeVisible();
  await expect(page.locator(".queue-section")).toBeVisible();

  const submit = page.locator(".queue-submit");
  await expect(submit).toBeVisible();

  const initial = await page.evaluate(() => {
    const button = document.querySelector(".queue-submit");
    const section = document.querySelector(".queue-section");
    if (!button || !section) {
      throw new Error("queue submit or section missing");
    }
    const buttonBox = button.getBoundingClientRect();
    const sectionBox = section.getBoundingClientRect();
    return {
      clippedBySection:
        buttonBox.bottom > sectionBox.bottom + 0.5 || buttonBox.top < sectionBox.top - 0.5,
      sectionScrolls: section.scrollHeight > section.clientHeight + 1,
    };
  });
  expect(initial.clippedBySection).toBe(false);
  expect(initial.sectionScrolls).toBe(false);

  await page.locator(".sidebar").evaluate((sidebar) => {
    const button = sidebar.querySelector(".queue-submit");
    if (!(button instanceof HTMLElement)) return;
    const sidebarBox = sidebar.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    sidebar.scrollTop += buttonBox.bottom - sidebarBox.bottom + 8;
  });

  const after = await page.evaluate(() => {
    const button = document.querySelector(".queue-submit");
    if (!button) {
      throw new Error("queue submit missing");
    }
    const buttonBox = button.getBoundingClientRect();
    return {
      top: buttonBox.top,
      bottom: buttonBox.bottom,
      height: buttonBox.height,
      viewportHeight: window.innerHeight,
    };
  });

  expect(after.top).toBeGreaterThanOrEqual(-0.5);
  expect(after.bottom).toBeLessThanOrEqual(after.viewportHeight + 0.5);
  expect(after.height).toBeGreaterThan(16);
});
