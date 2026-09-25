import { expect, test } from "@playwright/test";

test("opens ProjectA with mocked Tauri IPC and a visible board", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");

  await expect(page).toHaveTitle("ProjectA");
  await expect(page.locator(".app")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Board" })).toBeVisible();
  await expect(page.getByText("Kein Projekt aktiv.")).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => window.__PROJECTA_E2E_IPC_CALLS__ ?? []))
    .toContain("list_projects");
  expect(await page.evaluate(() => window.__PROJECTA_E2E_UNKNOWN_IPC__ ?? [])).toEqual([]);
  expect(pageErrors).toEqual([]);
});
