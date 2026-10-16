import { expect, test } from "@playwright/test";
import { DEFAULT_PATH, ROUTES, SCOPE_ROUTE_IDS } from "../src/shell/routes";
import { GOAL_ROUTE, SETTINGS_CLASSIC_PATH } from "../src/shell/mount/routing";
import { createRunLog } from "../src/testing/e2e/runLog";

// Include registry tabs and the mount-only paths; the checks concern the shell,
// including honest placeholders, rather than the embedded classic UI's behavior.
const routes = [...new Set([
  ...ROUTES.flatMap((route) => [route.path, ...route.tabs.map((tab) => tab.path)]),
  ...Object.values(GOAL_ROUTE),
  "/leitstand/klassisch",
  SETTINGS_CLASSIC_PATH,
])];

test("core Glass routes render without console errors and leave a run log", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
    // V2-SCOPE-1 hides every area outside SCOPE_ROUTE_IDS by default; this walk covers them all.
    localStorage.setItem("projecta.settings.featureFlag.weitere_bereiche", "1");
  });
  const log = await createRunLog("shell-run-logs");
  console.log(`Shell run log: ${log.directory}/steps.json (${routes.length} routes)`);

  for (const route of routes) {
    await test.step(route, async () => {
      const errors: string[] = [];
      const onConsole = (message: import("@playwright/test").ConsoleMessage) => {
        if (message.type() === "error") errors.push(message.text());
      };
      const onPageError = (error: Error) => errors.push(error.message);
      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      try {
        await page.goto(`/#${route}`, { waitUntil: "networkidle" });
        await expect(page.locator(".g-shell")).toBeVisible();
        const main = page.getByRole("main").and(page.locator(".g-shell-content"));
        await expect(main).toBeVisible();
        await expect(main).not.toHaveText("");
        expect(await page.evaluate(() => window.location.hash)).toBe(`#${route}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      try {
        await log.record({ route, status: errors.length ? "failed" : "passed", errors },
          (path) => page.screenshot({ path, fullPage: false }));
        expect.soft(errors, `${route}: render and console errors`).toEqual([]);
      } finally {
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
      }
    });
  }
  await testInfo.attach("shell-steps", { path: `${log.directory}/steps.json`, contentType: "application/json" });
});

test("hidden areas redirect to the Leitstand until weitere Bereiche is on", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
  });
  const hidden = ROUTES.filter((route) => !SCOPE_ROUTE_IDS.includes(route.id));
  expect(hidden.length).toBeGreaterThan(0);
  for (const route of hidden) {
    await page.goto(`/#${route.path}`, { waitUntil: "networkidle" });
    await expect(page.locator(".g-shell")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.location.hash), { message: route.path }).toBe(`#${DEFAULT_PATH}`);
  }
});
