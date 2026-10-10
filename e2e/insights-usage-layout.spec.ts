import { expect, test, type Page } from "@playwright/test";

async function openRichInsights(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.__PROJECTA_E2E_RICH__ = true;
  });
  await page.goto("/");
  await expect(page.locator(".app")).toBeVisible();
  await page.locator("#goal-tab-insights").click();
  await expect(page.getByTestId("insights")).toBeVisible();
  await expect(page.locator(".usage-view .usage-section")).toHaveCount(4, {
    timeout: 15_000,
  });
}

test("at 1024 nothing in Insights sits right of the viewport", async ({ page }) => {
  await openRichInsights(page, 1024, 720);
  const measure = await page.evaluate(() => {
    const vw = window.innerWidth;
    let right = 0;
    for (const el of document.querySelectorAll('[data-testid="insights"] *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > right) right = r.right;
    }
    return { vw, right, over: right > vw + 1 };
  });
  expect(measure.over, `right=${measure.right} vw=${measure.vw}`).toBe(false);
});

test("at 1440 usage grid stays two columns and free-tier row stays unclipped", async ({
  page,
}) => {
  await openRichInsights(page, 1440, 900);
  const measure = await page.evaluate(() => {
    const view = document.querySelector(".usage-view");
    if (!(view instanceof HTMLElement)) {
      return { ok: false as const, reason: "missing .usage-view" };
    }
    const sections = [...view.querySelectorAll(":scope > .usage-section")];
    if (sections.length < 4) {
      return { ok: false as const, reason: `sections=${sections.length}` };
    }
    const lefts = [
      ...new Set(sections.map((s) => Math.round(s.getBoundingClientRect().left))),
    ].sort((a, b) => a - b);
    const columns = lefts.length;

    const freeSection = sections.find((s) => s.querySelector(".free-tier-row"));
    if (!freeSection) {
      return { ok: false as const, reason: "missing free-tier section", columns };
    }
    const sectionRight = freeSection.getBoundingClientRect().right;
    const row = freeSection.querySelector(".free-tier-row");
    if (!(row instanceof HTMLElement)) {
      return { ok: false as const, reason: "missing free-tier-row", columns };
    }
    let clipped = false;
    const childRights: number[] = [];
    for (const child of row.children) {
      const r = child.getBoundingClientRect();
      childRights.push(r.right);
      if (r.width > 0 && r.right > sectionRight + 1) clipped = true;
    }
    const remaining = row.querySelector(".free-tier-remaining");
    const remainingText = remaining?.textContent?.trim() ?? "";
    const reset = row.querySelector(".free-tier-reset");
    const resetText = reset?.textContent?.trim() ?? "";
    const name = row.querySelector(".free-tier-name");
    const nameText = name?.textContent?.trim() ?? "";

    const bg = getComputedStyle(view).backgroundColor;
    const borderSample = getComputedStyle(document.documentElement).getPropertyValue("--border").trim();

    return {
      ok: true as const,
      columns,
      clipped,
      remainingText,
      resetText,
      nameText,
      sectionRight,
      childRights,
      bg,
      borderSample,
    };
  });

  expect(measure.ok, "reason" in measure ? measure.reason : "").toBe(true);
  if (!measure.ok) return;

  expect(measure.columns, "three auto-fit columns leave a border slab at 1440").toBeLessThanOrEqual(
    2,
  );
  expect(measure.clipped, "free-tier children must stay inside their section").toBe(false);
  expect(measure.nameText.length).toBeGreaterThan(0);
  expect(measure.remainingText).toMatch(/\d/);
  expect(measure.resetText.length).toBeGreaterThan(0);
});
