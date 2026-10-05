import { expect, test } from "@playwright/test";

// Renders the board's three placeholder states through the real app with the
// mocked Tauri IPC (src/test/tauriBrowserMock.ts). Mock data only.
//   npx playwright test --config e2e/bakeoff.config.ts
const STATES = ["loading", "empty", "error"] as const;
const SIZES = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
];
const THEMES = ["light", "dark"] as const;

for (const state of STATES) {
  for (const { width, height } of SIZES) {
    for (const theme of THEMES) {
      test(`${state} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.addInitScript((wanted) => {
          const w = window as unknown as Record<string, unknown>;
          w.__PROJECTA_E2E_RICH__ = true;
          // Wrap `invoke` the moment the mock installs it: the rich fixtures
          // hold one worker, but this project has none, and the board call is
          // the one that must hang or fail.
          let internals: unknown;
          Object.defineProperty(window, "__TAURI_INTERNALS__", {
            configurable: true,
            get: () => internals,
            set: (value: object) => {
              internals = new Proxy(value, {
                set(target, key, fn) {
                  const original = fn as (...a: unknown[]) => Promise<unknown>;
                  (target as Record<string | symbol, unknown>)[key] =
                    key !== "invoke"
                      ? fn
                      : (cmd: string, ...rest: unknown[]) => {
                          if (cmd === "list_workers") return Promise.resolve([]);
                          if (cmd === "list_projects") {
                            return (original(cmd, ...rest) as Promise<{ repoPath: string }[]>).then(
                              (projects) => projects.map((p) => ({ ...p, repoPath: "/work/demo" })),
                            );
                          }
                          if (cmd !== "get_board_state") return original(cmd, ...rest);
                          if (wanted === "loading") return new Promise(() => undefined);
                          if (wanted === "error") return Promise.reject("database is locked");
                          return Promise.resolve({ cards: [], coordinators: [] });
                        };
                  return true;
                },
              });
            },
          });
        }, state);

        await page.goto("/");
        await page.getByTitle("Ganzes Board öffnen").click();
        const board = page.locator(".board-placeholder");
        await expect(board).toBeVisible();
        if (state === "loading") await expect(board).toHaveAttribute("aria-busy", "true");
        if (state === "empty") {
          const action = board.getByRole("button", { name: "Neuer Worker" });
          await page.keyboard.press("Tab");
          await action.focus();
          await expect(action).toHaveCSS("outline-style", "solid");
        }
        if (state === "error") await expect(board.getByRole("alert")).toBeVisible();
        await page.screenshot({ path: `bakeoff-shots/${state}-${width}-${theme}.png` });
      });
    }
  }
}
