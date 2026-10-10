import { expect, test } from "@playwright/test";

test("focused project row shows all four inset ring edges inside project-list", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__PROJECTA_E2E_RICH__ = true;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".app")).toBeVisible();
  await expect(page.locator(".project-list .project-button").first()).toBeVisible();

  const button = page.locator(".project-list .project-button").first();
  await button.focus();
  await expect(button).toBeFocused();

  const metrics = await page.evaluate(() => {
    const list = document.querySelector(".project-list");
    const btn = document.querySelector(".project-list .project-button");
    if (!(list instanceof HTMLElement) || !(btn instanceof HTMLElement)) {
      throw new Error("project list or button missing");
    }
    const listBox = list.getBoundingClientRect();
    const btnBox = btn.getBoundingClientRect();
    const style = getComputedStyle(btn);
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const outlineOffset = Number.parseFloat(style.outlineOffset) || 0;
    // Inset ring: outer edge of the outline sits inside the button box.
    const inset = outlineWidth + Math.max(0, -outlineOffset);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth,
      outlineOffset,
      inset,
      list: { top: listBox.top, right: listBox.right, bottom: listBox.bottom, left: listBox.left },
      ring: {
        top: btnBox.top - outlineOffset,
        right: btnBox.right + outlineOffset,
        bottom: btnBox.bottom + outlineOffset,
        left: btnBox.left - outlineOffset,
      },
      // With negative offset the ring sits inside the button; report edges
      // relative to the clipping list padding box.
      ringInsideList: {
        top: btnBox.top + inset,
        right: btnBox.right - inset,
        bottom: btnBox.bottom - inset,
        left: btnBox.left + inset,
      },
    };
  });

  expect(metrics.outlineStyle).not.toBe("none");
  expect(metrics.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(metrics.outlineOffset).toBeLessThan(0);

  const { list, ringInsideList: ring } = metrics;
  expect(ring.top).toBeGreaterThanOrEqual(list.top - 0.5);
  expect(ring.left).toBeGreaterThanOrEqual(list.left - 0.5);
  expect(ring.right).toBeLessThanOrEqual(list.right + 0.5);
  expect(ring.bottom).toBeLessThanOrEqual(list.bottom + 0.5);
});
