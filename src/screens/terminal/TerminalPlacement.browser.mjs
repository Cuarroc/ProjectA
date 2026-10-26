import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

test("live chooser stays inside viewport and clear of wrapped tabs", async () => {
  process.env.VITE_TAURI_MOCKS = "true";
  const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ reducedMotion: "reduce", colorScheme: "light", viewport: { width: 1100, height: 720 } });
    await page.addInitScript(() => {
      window.__PROJECTA_E2E_RICH__ = true;
      localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
      localStorage.setItem("projecta.activeProjectId", "p1");
    });
    await page.goto(`${server.resolvedUrls.local[0]}#/leitstand/terminal`);
    const launch = page.getByRole("button", { name: "Neue Sitzung", exact: true });
    const panel = page.locator(".g-terminal-chooser");
    const tabs = page.getByRole("tablist", { name: "Terminal-Sitzungen" }).getByRole("tab");
    await expect(launch).toBeVisible();
    await page.evaluate(() => {
      window.placementCalls = [];
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args, ...rest) => {
        window.placementCalls.push({ command, args });
        return original(command, args, ...rest);
      };
    });
    for (let i = 0; i < 6; i++) {
      await launch.click();
      await page.getByRole("button", { name: "Claude", exact: true }).click();
      await expect(tabs).toHaveCount(i + 1);
      await expect(launch).not.toHaveAttribute("aria-busy", "true");
    }
    const settle = async () => {
      await expect(page.locator(".g-terminal .xterm")).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      // Let xterm's scheduled fit and ResizeObserver callbacks finish before measuring.
      await page.waitForTimeout(350);
    };
    const measure = () => page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      return {
        viewport: [innerWidth, innerHeight], route: location.hash,
        theme: "system/light", variant: "glas", motion: "reduce", panel: rect(".g-terminal-chooser"),
        strip: rect(".g-terminal-actions"), viewer: rect('.g-terminal > [role="tabpanel"]:not([hidden])'),
        trigger: rect('.g-terminal-actions [aria-expanded]'),
        controls: [...document.querySelectorAll('.g-terminal [role="tab"], .g-terminal-actions > button')]
          .map((el) => ({ label: el.textContent, ...el.getBoundingClientRect().toJSON() })),
        resize: window.placementCalls.filter(({ command }) => command === "resize_pty"),
      };
    });
    for (const [width, height] of [[760, 260], [760, 520], [1100, 720]]) {
      await page.setViewportSize({ width, height });
      await settle();
      const before = await measure();
      await launch.click();
      await expect(panel.getByRole("button", { name: "Claude", exact: true })).toBeVisible();
      await settle();
      const opened = await measure();
      console.log(JSON.stringify({ before, opened }));
      if (process.env.PLACEMENT_CAPTURE) {
        await mkdir(process.env.PLACEMENT_CAPTURE, { recursive: true });
        await page.screenshot({ path: `${process.env.PLACEMENT_CAPTURE}/${width}x${height}.png` });
      }
      const p = opened.panel;
      assert.ok(p.left >= 0 && p.top >= 0 && p.right <= width && p.bottom <= height,
        `panel outside ${width}x${height}: ${JSON.stringify(p)}`);
      for (const c of opened.controls) assert.ok(p.right <= c.left || p.left >= c.right || p.bottom <= c.top || p.top >= c.bottom,
        `panel intersects ${c.label}: ${JSON.stringify(c)}`);
      for (const action of ["cancel", "escape", "outside"]) {
        if (action !== "cancel") await launch.click();
        await expect(panel).toBeVisible();
        if (action === "cancel") await panel.getByRole("button", { name: "Abbrechen" }).click();
        if (action === "escape") { await panel.getByRole("button", { name: "Claude", exact: true }).focus(); await page.keyboard.press("Escape"); }
        if (action === "outside") await page.locator(".g-terminal .xterm").click();
        await expect(panel).toHaveCount(0);
        await settle();
        const after = await measure();
        assert.deepEqual(after.strip, before.strip);
        assert.deepEqual(after.viewer, before.viewer);
        assert.deepEqual(after.resize, before.resize);
        if (action !== "outside") await expect(launch).toBeFocused();
        console.log(JSON.stringify({ action, after }));
      }
      assert.deepEqual(opened.strip, before.strip);
      assert.deepEqual(opened.viewer, before.viewer);
      assert.deepEqual(opened.resize, before.resize);
    }
    await page.setViewportSize({ width: 760, height: 260 });
    await settle();
    const beforeSwitch = await measure();
    await launch.click();
    await expect(panel).toBeVisible();
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveCount(0);
    await settle();
    console.log(JSON.stringify({ deliberateSwitch: { before: beforeSwitch, after: await measure() } }));
    await launch.click();
    await expect(panel).toBeVisible();
    await page.getByRole("button", { name: "Tab schließen" }).click();
    await expect(tabs).toHaveCount(5);
    assert.deepEqual(await page.evaluate(() => window.placementCalls.filter(({ command }) => command === "kill_pty")),
      [{ command: "kill_pty", args: { sessionId: "ses-adhoc-2" } }]);
    await page.evaluate(() => { location.hash = "#/leitstand/terminal?worker=w1"; });
    await expect(tabs).toHaveCount(6);
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await settle();
    await launch.click();
    await expect(panel).toBeVisible();
    await page.getByRole("button", { name: "Tab schließen" }).click();
    await expect(tabs).toHaveCount(5);
    assert.deepEqual(await page.evaluate(() => window.placementCalls.filter(({ command }) => command === "kill_pty")),
      [{ command: "kill_pty", args: { sessionId: "ses-adhoc-2" } }]);
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
});
