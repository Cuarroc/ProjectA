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

test("queue submit stays pinned at 900x280 without scroll", async ({ page }) => {
  await page.addInitScript(() => {
    window.__PROJECTA_E2E_RICH__ = true;
  });
  await page.setViewportSize({ width: 900, height: 280 });
  await page.goto("/");
  await expect(page.locator(".app")).toBeVisible();
  await expect(page.locator(".queue-submit")).toBeVisible();

  const pinned = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar");
    const button = document.querySelector(".queue-submit");
    const sticky = document.querySelector(".queue-actions-sticky");
    if (!(sidebar instanceof HTMLElement) || !button || !sticky) {
      throw new Error("sidebar queue sticky fixtures missing");
    }
    sidebar.scrollTop = 0;
    const buttonBox = button.getBoundingClientRect();
    const stickyStyle = getComputedStyle(sticky);
    return {
      top: buttonBox.top,
      bottom: buttonBox.bottom,
      viewportHeight: window.innerHeight,
      position: stickyStyle.position,
    };
  });

  expect(pinned.position).toBe("sticky");
  expect(pinned.top).toBeGreaterThanOrEqual(-0.5);
  expect(pinned.bottom).toBeLessThanOrEqual(pinned.viewportHeight + 0.5);
  expect(pinned.bottom).toBeLessThan(300);
});

test("settings tabs stay pinned while body scrolls at 1024x500", async ({ page }) => {
  await page.addInitScript(() => {
    window.__PROJECTA_E2E_RICH__ = true;
  });
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.goto("/");
  await expect(page.locator(".app")).toBeVisible();
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.locator(".settings-body")).toBeVisible();
  await expect(page.locator(".settings-tabs")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const tabs = document.querySelector(".settings-tabs");
    const body = document.querySelector(".settings-body");
    const area = document.querySelector(".settings-area");
    if (!(tabs instanceof HTMLElement) || !(body instanceof HTMLElement) || !(area instanceof HTMLElement)) {
      throw new Error("settings fixtures missing");
    }
    body.scrollTop = body.scrollHeight;
    area.scrollTop = area.scrollHeight;
    const tabsBox = tabs.getBoundingClientRect();
    return {
      tabsTop: tabsBox.top,
      tabsBottom: tabsBox.bottom,
      bodyScrolls: body.scrollHeight > body.clientHeight + 1,
      bodyOverflowY: getComputedStyle(body).overflowY,
    };
  });

  expect(metrics.bodyOverflowY).toBe("auto");
  expect(metrics.bodyScrolls).toBe(true);
  expect(metrics.tabsTop).toBeGreaterThanOrEqual(-0.5);
  expect(metrics.tabsBottom).toBeGreaterThan(16);
});
