// @vitest-environment node
import { chromium, expect as browserExpect, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let url: string;

// The server and browser belong to this foreground test run and are closed even on failure.
beforeAll(async () => {
  server = await createServer({
    define: { "import.meta.env.VITE_TAURI_MOCKS": JSON.stringify("true") },
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  url = server.resolvedUrls!.local[0];
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  try { await browser?.close(); } finally { await server?.close(); }
});

async function checkTab(path: string) {
  const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.addInitScript(() => {
      localStorage.setItem("projecta.settings.featureFlag.d1_neue_oberflaeche", "1");
      localStorage.setItem("projecta.settings.featureFlag.weitere_bereiche", "0");
    });
    await page.goto(`${url}#${path}`);
    const shell = page.locator(".g-shell");
    await browserExpect(shell).toBeVisible();
    await browserExpect(page.locator(".g-shell-content")).not.toBeEmpty();
    expect(new URL(page.url()).hash).toBe(`#${path}`);
    const navigation = shell.getByRole("navigation", { name: "Hauptnavigation" });
    const first = navigation.getByRole("link", { name: "Leitstand", exact: true });
    const second = navigation.getByRole("link", { name: "Einstellungen", exact: true });
    await page.keyboard.press("Tab");
    await browserExpect(first).toBeFocused();
    await browserExpect(first).toBeVisible();
    await page.keyboard.press("Tab");
    await browserExpect(second).toBeFocused();
    await browserExpect(second).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await browserExpect(first).toBeFocused();
  } finally {
    await page.close();
  }
}

it("Tab enters the shell and Shift-Tab returns at /leitstand", () => checkTab("/leitstand"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /leitstand/verlauf", () => checkTab("/leitstand/verlauf"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /leitstand/betrieb", () => checkTab("/leitstand/betrieb"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /leitstand/klassisch", () => checkTab("/leitstand/klassisch"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /leitstand/werkzeuge", () => checkTab("/leitstand/werkzeuge"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /leitstand/terminal", () => checkTab("/leitstand/terminal"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /einstellungen", () => checkTab("/einstellungen"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /einstellungen/mcp", () => checkTab("/einstellungen/mcp"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /einstellungen/benachrichtigungen", () => checkTab("/einstellungen/benachrichtigungen"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /einstellungen/projekt", () => checkTab("/einstellungen/projekt"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /einstellungen/klassisch", () => checkTab("/einstellungen/klassisch"), 15_000);
it("Tab enters the shell and Shift-Tab returns at /start", () => checkTab("/start"), 15_000);
