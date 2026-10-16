import { expect, test } from "@playwright/test";

// DS-X-01: the Glass settings screen at the 1440x900 design size.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/einstellungen");
  await expect(page.locator(".es-grid")).toBeVisible();
});

test("tab strip keeps its height beside the long body", async ({ page }) => {
  const box = await page.locator(".es > .g-tabs").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
});

test("section grid has at least two columns", async ({ page }) => {
  const columns = await page.locator(".es-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(columns).toBeGreaterThanOrEqual(2);
});

test("header keeps both appearance groups instead of a menu", async ({ page }) => {
  const header = page.locator(".g-shell-top");
  await expect(header.getByRole("radiogroup")).toHaveCount(2);
  await expect(header.getByRole("button", { name: "Darstellung" })).toHaveCount(0);
});
