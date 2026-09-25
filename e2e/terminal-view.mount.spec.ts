import { expect, test } from "@playwright/test";

// W1-21c: mounting a TerminalView (real xterm 5.5, dev build, so React
// StrictMode mounts, cleans up and remounts) threw the pageerror
// "Cannot read properties of undefined (reading 'dimensions')" from
// `Viewport.syncScrollArea`: the timer xterm's `open()` queues fired after
// the first, already disposed Terminal had lost its renderer.
test("mounting a terminal raises no pageerror", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    window.__PROJECTA_E2E_RICH__ = true;
  });
  await page.goto("/");

  // The rich fixture's running worker; its board card opens its terminal.
  await page.getByRole("button", { name: /codex\/w1-02/ }).click();
  await expect(page.locator(".terminal-host .xterm")).toBeVisible();

  // A timer queued now fires after every timer the mount itself queued,
  // including xterm's `syncScrollArea` and any deferred cleanup.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));

  expect(pageErrors).toEqual([]);
  // The StrictMode cleanup's Terminal is gone again, i.e. the deferred
  // dispose really ran. (That it is detached *before* then is shown by the
  // unit test; by now both variants would leave one element.)
  await expect(page.locator(".terminal-host .xterm")).toHaveCount(1);
});
