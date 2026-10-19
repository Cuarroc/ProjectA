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
