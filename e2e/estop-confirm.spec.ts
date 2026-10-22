import { expect, test, type Locator } from "@playwright/test";

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

test("header hint fits at 900 pixels and preserves both layouts' confirmation controls", async ({ page }, testInfo) => {
  for (const viewport of [{ width: 900, height: 600 }, { width: 1440, height: 900 }]) {
    for (const theme of ["dark", "light"]) {
      for (const shell of [true, false]) {
        const label = `${shell ? "header" : "classic"}-${viewport.width}-${theme}`;
        await test.step(label, async () => {
          await page.addInitScript(({ theme, shell }) => {
            localStorage.setItem("projecta.settings.glassTheme", theme);
            localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", shell ? "1" : "0");
          }, { theme, shell });
          await page.setViewportSize(viewport);
          await page.goto("/#/einstellungen");
          if (!shell) await page.getByRole("tab", { name: "Einstellungen" }).click();
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

          const control = page.getByTestId("emergency-stop");
          const raise = page.getByRole("button", { name: "Not-Aus auslösen" });
          const hint = control.getByRole("status");
          const hintText = "Beendet binnen 10 Sekunden alle laufenden Agenten und stoppt neue Aufgaben.";
          await expect(control).toHaveCount(1);
          await expect(raise).toBeEnabled();
          await raise.scrollIntoViewIfNeeded();
          await expect(hint).toHaveText(hintText);
          await expect(raise).toHaveAccessibleDescription(hintText);
          await page.screenshot({ path: testInfo.outputPath(`${label}-idle.png`) });

          const insideWindow = async (element: Locator) => {
            const box = await element.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.y).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
            expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
          };
          await insideWindow(raise);
          await insideWindow(hint);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
          // Keep enough visible text to read the action, even when the header ellipsizes it.
          expect((await hint.boundingBox())!.width).toBeGreaterThanOrEqual(100);
          if (shell) {
            const header = page.locator(".g-shell-top");
            const hintBox = (await hint.boundingBox())!;
            const headerBox = (await header.boundingBox())!;
            expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width);
            for (const button of await header.getByRole("button").all()) await insideWindow(button);
          } else {
            expect(await hint.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          }

          await raise.click();
          const dialog = page.getByRole("dialog", { name: "Not-Aus bestätigen" });
          const cancel = dialog.getByRole("button", { name: "Abbrechen" });
          await expect(dialog).toBeVisible();
          await expect(cancel).toBeFocused();
          await insideWindow(dialog);
          await insideWindow(cancel);
          await insideWindow(dialog.getByRole("button", { name: "Ja, alles anhalten" }));
          await insideWindow(hint);
          await page.screenshot({ path: testInfo.outputPath(`${label}-confirmation.png`) });
          await cancel.press("Escape");
          await expect(dialog).toHaveCount(0);
          await expect(raise).toBeFocused();
          await raise.click();
          await cancel.click();
          await expect(dialog).toHaveCount(0);
          await expect(raise).toBeFocused();
          expect(await page.evaluate(() => window.__PROJECTA_E2E_IPC_CALLS__?.filter((c) => c === "set_emergency_stop"))).toEqual([]);
        });
      }
    }
  }
});
