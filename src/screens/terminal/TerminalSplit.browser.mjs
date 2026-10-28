/* global window, document, localStorage, location */
import process from "node:process";
import console from "node:console";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

test("opens two distinct shared session panes without spawning or mirroring on split", async () => {
  process.env.VITE_TAURI_MOCKS = "true";
  const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false } });
  let browser;
  try {
    await server.listen();
    const { ptyOutput } = await server.ssrLoadModule("/src/lib/eventNames.ts");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1100, height: 720 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__PROJECTA_E2E_RICH__ = true;
      localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
      localStorage.setItem("projecta.activeProjectId", "p1");
    });
    await page.goto(`${server.resolvedUrls.local[0]}?restore=1#/leitstand/terminal`);
    const launch = page.getByRole("button", { name: "Neue Sitzung", exact: true });
    await expect(launch).toBeVisible();
    await page.evaluate(() => {
      window.splitCalls = [];
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args, ...rest) => {
        window.splitCalls.push({ command, args });
        return original(command, args, ...rest);
      };
    });
    const calls = command => page.evaluate(cmd => window.splitCalls.filter(c => c.command === cmd), command);
    const panes = page.locator('.g-terminal [role="tabpanel"]:visible');
    const split = () => page.getByRole("button", { name: "Terminal teilen", exact: true });
    for (let i = 1; i <= 2; i++) {
      await launch.click();
      await page.getByRole("button", { name: "Claude", exact: true }).click();
      await expect(page.locator(`#terminal-tab-ses-adhoc-${i}`)).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".g-terminal .xterm")).toHaveCount(1);
    }
    assert.equal((await calls("spawn_pty")).length, 2);
    await expect(split()).toBeEnabled();
    await split().click();
    const unsplit = () => page.getByRole("button", { name: "Split schließen", exact: true });
    await expect(unsplit()).toHaveAttribute("aria-pressed", "true");
    await expect(panes).toHaveCount(2);
    await expect(page.locator(".xterm")).toHaveCount(2);
    assert.deepEqual(await panes.evaluateAll(els => els.map(el => el.id)),
      ["terminal-panel-ses-adhoc-2", "terminal-panel-ses-adhoc-1"]);
    await expect.poll(async () => (await calls("get_scrollback")).length).toBe(4);
    const nodes = await panes.locator(".xterm").elementHandles();
    for (const [side, id, key] of [[0, "ses-adhoc-2", "L"], [1, "ses-adhoc-1", "R"], [0, "ses-adhoc-2", "K"]]) {
      await panes.nth(side).locator(".xterm-screen").click();
      await expect(page.locator(`#terminal-tab-${id}`)).toHaveAttribute("aria-selected", "true");
      await page.keyboard.type(key);
      await expect.poll(() => calls("write_pty")).toContainEqual({ command: "write_pty", args: { sessionId: id, data: key } });
      for (let i = 0; i < 2; i++) assert.ok(await nodes[i].evaluate((el, index) =>
        el === document.querySelectorAll(".g-terminal .xterm")[index], i));
    }
    assert.deepEqual((await calls("write_pty")).map(c => c.args), [
      { sessionId: "ses-adhoc-2", data: "L" }, { sessionId: "ses-adhoc-1", data: "R" }, { sessionId: "ses-adhoc-2", data: "K" },
    ]);
    for (const [id, marker] of [["ses-adhoc-2", "LEFTONLY"], ["ses-adhoc-1", "RIGHTONLY"]]) {
      await page.evaluate(({ event, marker }) => window.__TAURI_INTERNALS__.invoke("plugin:event|emit",
        { event, payload: `\r\n${marker}\r\n` }), { event: ptyOutput(id), marker });
    }
    for (const [side, marker, other] of [[0, "LEFTONLY", "RIGHTONLY"], [1, "RIGHTONLY", "LEFTONLY"]]) {
      await panes.nth(side).locator(".xterm-helper-textarea").focus();
      await page.keyboard.press("Control+Shift+f");
      const input = panes.nth(side).getByRole("search").locator("input");
      await input.fill(marker);
      await input.press("Enter");
      await expect(panes.nth(side).getByLabel("Treffer", { exact: true })).toHaveText("1/1");
      await input.fill(other);
      await input.press("Enter");
      await expect(panes.nth(side).getByLabel("Treffer", { exact: true })).toHaveText("0/0");
      await input.press("Escape");
    }
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.evaluate(() => document.fonts.ready);
      const rects = await panes.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()));
      assert.ok(rects.every(r => r.width > 0 && r.height > 0));
      assert.ok(rects[0].right <= rects[1].left && rects[0].top === rects[1].top);
      console.log(JSON.stringify({ theme, rects, resize: await calls("resize_pty") }));
      if (process.env.SPLIT_CAPTURE) {
        await mkdir(process.env.SPLIT_CAPTURE, { recursive: true });
        await page.screenshot({ path: `${process.env.SPLIT_CAPTURE}/${theme}.png` });
      }
    }
    await unsplit().click();
    await expect(panes).toHaveCount(1);
    await expect(split()).toHaveAttribute("aria-pressed", "false");
    await split().click();
    await expect(panes).toHaveCount(2);
    await page.evaluate(() => { location.hash = "#/leitstand"; });
    await expect(page.locator(".g-terminal")).toHaveCount(0);
    await page.evaluate(() => { location.hash = "#/leitstand/terminal"; });
    await expect(panes).toHaveCount(2);
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args, ...rest) => {
        if (command !== "list_workers") return original(command, args, ...rest);
        window.__TAURI_INTERNALS__.invoke = original;
        return new Promise(resolve => { window.finishSplitLookup = () => resolve(original(command, args, ...rest)); });
      };
      location.hash = "#/leitstand/terminal?worker=restore-demo";
    });
    await expect(unsplit()).toBeDisabled();
    await expect(page.locator(".xterm")).toHaveCount(1);
    await page.evaluate(() => window.finishSplitLookup());
    await expect(page.locator("#terminal-panel-restore\\:restore-demo")).toBeVisible();
    await expect(page.locator(".xterm")).toHaveCount(0);
    await expect(unsplit()).toBeDisabled();
    await expect(unsplit()).toHaveAttribute("aria-pressed", "true");
    await page.locator("#terminal-tab-ses-adhoc-2").click();
    await expect(panes).toHaveCount(2);
    await expect(unsplit()).toBeEnabled();
    assert.equal((await calls("spawn_pty")).length, 2);
    assert.deepEqual(await calls("kill_pty"), []);
    await page.locator("#terminal-panel-ses-adhoc-1 .xterm-helper-textarea").focus();
    await page.getByRole("button", { name: "Tab schließen", exact: true }).click();
    await expect(panes).toHaveCount(1);
    await expect(page.locator(".xterm")).toHaveCount(1);
    await expect(page.locator("#terminal-tab-ses-adhoc-2")).toBeFocused();
    await expect(split()).toBeDisabled();
    assert.deepEqual(await calls("kill_pty"), [{ command: "kill_pty", args: { sessionId: "ses-adhoc-1" } }]);
    assert.equal((await calls("spawn_pty")).length, 2);
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
});

async function withSplit(verify) {
  process.env.VITE_TAURI_MOCKS = "true";
  const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false } });
  let browser;
  try {
    await server.listen();
    const { ptyOutput } = await server.ssrLoadModule("/src/lib/eventNames.ts");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__PROJECTA_E2E_RICH__ = true;
      localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
      localStorage.setItem("projecta.activeProjectId", "p1");
    });
    await page.goto(`${server.resolvedUrls.local[0]}?restore=1#/leitstand/terminal`);
    await expect(page.getByRole("button", { name: "Neue Sitzung", exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.splitCalls = [];
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args, ...rest) => {
        window.splitCalls.push({ command, args });
        return original(command, args, ...rest);
      };
    });
    for (let i = 1; i <= 3; i++) {
      await page.getByRole("button", { name: "Neue Sitzung", exact: true }).click();
      await page.getByRole("button", { name: "Claude", exact: true }).click();
      await expect(page.locator(`#terminal-tab-ses-adhoc-${i}`)).toHaveAttribute("aria-selected", "true");
    }
    await page.getByRole("button", { name: "Terminal teilen", exact: true }).click();
    const panes = page.locator('.g-terminal [role="tabpanel"]:visible');
    await expect(panes).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => window.splitCalls.filter(c => c.command === "get_scrollback").length)).toBe(5);
    await verify({ page, panes, ptyOutput });
    assert.equal(await page.evaluate(() => window.splitCalls.filter(c => c.command === "spawn_pty").length), 3);
    assert.equal(await page.evaluate(() => window.splitCalls.filter(c => c.command === "kill_pty").length), 0);
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
}

test("preserves the active pane focus and physical order across split toggles", () => withSplit(async ({ page, panes }) => {
  await expect(page.locator("#terminal-tab-ses-adhoc-3")).toHaveAttribute("aria-selected", "true");
  await expect(panes.nth(0).locator(".xterm-helper-textarea")).toBeFocused();
  assert.deepEqual(await panes.evaluateAll(els => els.map(el => el.id)),
    ["terminal-panel-ses-adhoc-3", "terminal-panel-ses-adhoc-2"]);
  await page.getByRole("button", { name: "Split schließen", exact: true }).click();
  await expect(panes).toHaveCount(1);
  await page.getByRole("button", { name: "Terminal teilen", exact: true }).click();
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(0).locator(".xterm-helper-textarea")).toBeFocused();
  assert.deepEqual(await panes.evaluateAll(els => els.map(el => el.id)),
    ["terminal-panel-ses-adhoc-3", "terminal-panel-ses-adhoc-2"]);
}));

test("resets search on session replacement and attaches each pane reader exactly once", () => withSplit(async ({ page, panes, ptyOutput }) => {
  await panes.nth(0).locator(".xterm-helper-textarea").focus();
  await page.evaluate(event => window.__TAURI_INTERNALS__.invoke("plugin:event|emit",
    { event, payload: "\r\nREPLACEDONLY\r\n" }), ptyOutput("ses-adhoc-3"));
  await page.keyboard.press("Control+Shift+f");
  const input = panes.nth(0).getByRole("search").locator("input");
  await input.fill("REPLACEDONLY");
  await input.press("Enter");
  await expect(panes.nth(0).getByLabel("Treffer", { exact: true })).toHaveText("1/1");
  const boundary = await page.evaluate(() => window.splitCalls.length);
  await page.locator("#terminal-tab-ses-adhoc-1").click();
  await expect(page.locator("#terminal-panel-ses-adhoc-1 .xterm")).toHaveCount(1);
  await expect(panes.nth(0).getByRole("search")).toHaveCount(0);
  await panes.nth(0).locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Shift+f");
  await expect(input).toHaveValue("");
  await expect(panes.nth(0).getByLabel("Treffer", { exact: true })).toHaveText("0/0");
  await input.press("Escape");
  const nodes = await panes.locator(".xterm").elementHandles();
  await panes.nth(1).locator(".xterm-helper-textarea").focus();
  await expect(page.locator("#terminal-tab-ses-adhoc-2")).toHaveAttribute("aria-selected", "true");
  await panes.nth(0).locator(".xterm-helper-textarea").focus();
  const delta = await page.evaluate(start => window.splitCalls.slice(start), boundary);
  assert.deepEqual(delta.filter(c => c.command === "get_scrollback").map(c => c.args.sessionId), ["ses-adhoc-1"]);
  assert.deepEqual(delta.filter(c => c.command === "plugin:event|listen" &&
    [ptyOutput("ses-adhoc-1"), ptyOutput("ses-adhoc-2"), ptyOutput("ses-adhoc-3")].includes(c.args.event)).map(c => c.args.event), [ptyOutput("ses-adhoc-1")]);
  assert.deepEqual(delta.filter(c => c.command === "plugin:event|unlisten" &&
    [ptyOutput("ses-adhoc-1"), ptyOutput("ses-adhoc-2"), ptyOutput("ses-adhoc-3")].includes(c.args.event)).map(c => c.args.event), [ptyOutput("ses-adhoc-3")]);
  for (let i = 0; i < 2; i++) assert.ok(await nodes[i].evaluate((el, index) =>
    el === document.querySelectorAll(".g-terminal .xterm")[index], i));
}));

test("reports pressed state only while two split panes are visible", () => withSplit(async ({ page, panes }) => {
  const toggle = page.getByRole("button", { name: "Split schließen", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (command, args, ...rest) => {
      if (command !== "list_workers") return original(command, args, ...rest);
      window.__TAURI_INTERNALS__.invoke = original;
      return new Promise(resolve => { window.finishSplitLookup = () => resolve(original(command, args, ...rest)); });
    };
    location.hash = "#/leitstand/terminal?worker=restore-demo";
  });
  await expect(toggle).toBeDisabled();
  await expect(panes).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => window.finishSplitLookup());
  await expect(page.locator("#terminal-panel-restore\\:restore-demo")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.locator("#terminal-tab-ses-adhoc-3").click();
  await expect(panes).toHaveCount(2);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}));
