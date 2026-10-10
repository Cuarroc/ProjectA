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
  const button = page.locator(".project-list .project-button").first();
  await expect(button).toBeVisible();
  await button.focus();
  await expect(button).toBeFocused();

  const m = await page.evaluate(() => {
    const list = document.querySelector(".project-list");
    const btn = document.querySelector(".project-list .project-button");
    if (!(list instanceof HTMLElement) || !(btn instanceof HTMLElement)) {
      throw new Error("missing list or button");
    }
    const lb = list.getBoundingClientRect();
    const bb = btn.getBoundingClientRect();
    const s = getComputedStyle(btn);
    const ow = Number.parseFloat(s.outlineWidth) || 0;
    const oo = Number.parseFloat(s.outlineOffset) || 0;
    const inset = ow + Math.max(0, -oo);
    return {
      outlineStyle: s.outlineStyle,
      outlineWidth: ow,
      outlineOffset: oo,
      list: { top: lb.top, right: lb.right, bottom: lb.bottom, left: lb.left },
      ring: {
        top: bb.top + inset,
        right: bb.right - inset,
        bottom: bb.bottom - inset,
        left: bb.left + inset,
      },
    };
  });

  expect(m.outlineStyle).not.toBe("none");
  expect(m.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(m.outlineOffset).toBeLessThan(0);
  expect(m.ring.top).toBeGreaterThanOrEqual(m.list.top - 0.5);
  expect(m.ring.left).toBeGreaterThanOrEqual(m.list.left - 0.5);
  expect(m.ring.right).toBeLessThanOrEqual(m.list.right + 0.5);
  expect(m.ring.bottom).toBeLessThanOrEqual(m.list.bottom + 0.5);
});
