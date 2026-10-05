/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression: drill 2026-10-05, installed v1.5.0. The main window carried
// "theme": "Dark", so WebView2 always reported prefers-color-scheme: dark
// and the light-mode block in src/styles.css never applied — switching
// Windows to light (AppsUseLightTheme=1) left the app dark. Without a
// theme, Tauri follows the system setting. node environment as in
// updater-config.test.ts: under jsdom fileURLToPath fails.
const here = dirname(fileURLToPath(import.meta.url));
const confPath = resolve(here, "..", "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8")) as {
  app?: { windows?: Array<{ label?: string; theme?: unknown }> };
};
const windows = conf.app?.windows ?? [];

describe("window theme (tauri.conf.json)", () => {
  it("declares the main window", () => {
    expect(windows.map((w) => w.label)).toContain("main");
  });

  it("no window forces a theme so the app follows the system setting", () => {
    const forced = windows
      .filter((w) => w.theme !== undefined)
      .map((w) => `${w.label ?? "?"}: ${String(w.theme)}`);
    expect(forced).toEqual([]);
  });
});
