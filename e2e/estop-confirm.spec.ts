import { expect, test } from "@playwright/test";

// R1722-M1: the Not-Aus confirmation must fit the supported minimum window
// (src-tauri/tauri.conf.json minWidth 900) without clipping, at every width.
for (const viewport of [
  { width: 900, height: 600 },
  { width: 1440, height: 900 },
]) {
  test(`confirmation stays inside the ${viewport.width}x${viewport.height} viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/einstellungen");

    const raise = page.getByRole("button", { name: "Not-Aus auslösen" });
    await expect(raise).toBeVisible();
    await raise.click();

    const dialog = page.getByRole("dialog", { name: "Not-Aus bestätigen" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    const confirm = page.getByRole("button", { name: "Ja, alles anhalten" });
    const confirmBox = await confirm.boundingBox();
    expect(confirmBox).not.toBeNull();
    expect(confirmBox!.x + confirmBox!.width).toBeLessThanOrEqual(viewport.width);
  });
}

// R1722-R2-M1: the classic settings (preview flag off) render the Not-Aus
// control inline, not in the shell header; the confirmation must still stay
// inside the supported minimum window (900 px) there.
test("classic settings keep the confirmation inside the 900x600 viewport", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "0");
  });
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/#/einstellungen");
  // The classic goal tab bar does not follow the hash; open the settings goal.
  await page.getByRole("tab", { name: "Einstellungen" }).click();

  const raise = page.getByRole("button", { name: "Not-Aus auslösen" });
  await expect(raise).toBeVisible();
  await raise.click();

  const dialog = page.getByRole("dialog", { name: "Not-Aus bestätigen" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(900);
  expect(box!.y + box!.height).toBeLessThanOrEqual(600);

  const confirm = page.getByRole("button", { name: "Ja, alles anhalten" });
  const confirmBox = await confirm.boundingBox();
  expect(confirmBox).not.toBeNull();
  expect(confirmBox!.x).toBeGreaterThanOrEqual(0);
  expect(confirmBox!.x + confirmBox!.width).toBeLessThanOrEqual(900);
});
