import { expect, test } from "@playwright/test";

test("empty conversation headline is vertically centred in the stream", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app")).toBeVisible();
  await expect(page.locator(".convo-empty-title")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const stream = document.querySelector(".convo-stream");
    const title = document.querySelector(".convo-empty-title");
    if (!stream || !title) return null;
    const s = stream.getBoundingClientRect();
    const t = title.getBoundingClientRect();
    return {
      streamHeight: s.height,
      streamMid: (s.top + s.bottom) / 2,
      titleMid: (t.top + t.bottom) / 2,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.streamHeight).toBeGreaterThan(200);
  // Contract: empty headline is centred in the stream, not stuck at the top.
  expect(Math.abs(metrics!.titleMid - metrics!.streamMid)).toBeLessThan(
    metrics!.streamHeight * 0.2,
  );
});
