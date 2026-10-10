import { expect, test } from "@playwright/test";

test("rail toggle yields an intermediate grid-template-columns sample", async ({ page }) => {
  await page.addInitScript(() => {
    window.__PROJECTA_E2E_RICH__ = true;
    localStorage.setItem("projecta.railOpen", "true");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".app-railed")).toBeVisible();

  const widths = await page.evaluate(async () => {
    const app = document.querySelector(".app");
    const toggle = document.querySelector(".viewbar-rail-toggle");
    if (!(app instanceof HTMLElement) || !(toggle instanceof HTMLElement)) throw new Error("rail fixtures missing");
    const seen = new Set<string>();
    const samples: number[] = [];
    const push = () => {
      const value = getComputedStyle(app).gridTemplateColumns;
      if (seen.has(value)) return;
      seen.add(value);
      samples.push(Number.parseFloat(value.trim().split(/\s+/)[1] ?? ""));
    };
    push();
    const start = performance.now();
    toggle.click();
    while (performance.now() - start < 500) {
      push();
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }
    push();
    return samples;
  });

  const open = Math.max(...widths);
  const closed = Math.min(...widths);
  expect(open).toBeGreaterThan(200);
  expect(closed).toBeLessThan(8);
  expect(widths.some((w) => w > closed + 1 && w < open - 1)).toBe(true);
});

test("Tab to Leiste einklappen then Enter focuses the ViewBar rail toggle", async ({ page }) => {
  await page.addInitScript(() => {
    window.__PROJECTA_E2E_RICH__ = true;
    localStorage.setItem("projecta.railOpen", "true");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".app-railed")).toBeVisible();

  await page.locator(".rail-title").focus();
  let onCollapse = false;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    onCollapse = await page.evaluate(() =>
      document.activeElement?.classList.contains("rail-collapse") === true,
    );
    if (onCollapse) break;
  }
  expect(onCollapse).toBe(true);
  await page.keyboard.press("Enter");

  await expect(page.locator(".rail")).toHaveAttribute("inert", "");
  await expect(page.locator(".viewbar-rail-toggle")).toBeFocused();
});
