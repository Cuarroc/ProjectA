import { expect, test } from "@playwright/test";

test("detail bar over the diff is exactly one shell bar high", async ({ page }) => {
  await page.addInitScript(() => {
    window.__PROJECTA_E2E_RICH__ = true;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("#goal-tab-agents").click();
  await page.getByRole("complementary", { name: "Board" }).getByText(/W1-02/).first().click();
  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(page.locator(".diff-view")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const bar = document.querySelector(".detailbar");
    if (!bar) throw new Error("detail bar missing");
    const probe = document.createElement("div");
    probe.style.height = "var(--shell-bar-h)";
    document.body.appendChild(probe);
    const shell = probe.getBoundingClientRect().height;
    probe.remove();
    return { bar: bar.getBoundingClientRect().height, shell };
  });

  expect(metrics.bar).toBe(metrics.shell);
});
