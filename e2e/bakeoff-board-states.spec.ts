import { expect, test, type Page } from "@playwright/test";

// UI bake-off evidence: the board's three card-less states (empty, loading,
// error) in the real app on mocked IPC, at two window sizes and both themes.
// Screenshots are only written with BAKEOFF_SHOTS=1; the assertions always run.

type BoardMode = "empty" | "loading" | "error";

// The rich fixture gives an active project; this wraps the mock's `invoke`
// (set by `mockIPC` after this script runs) so the board call answers with
// the state under test and the project has no workers.
async function stubBoard(page: Page, mode: BoardMode) {
  await page.addInitScript((boardMode: BoardMode) => {
    window.__PROJECTA_E2E_RICH__ = true;
    let inner: ((cmd: string, args: unknown, options: unknown) => Promise<unknown>) | undefined;
    const internals = {} as Record<string, unknown>;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      set(fn) {
        inner = fn;
      },
      get() {
        return (cmd: string, args: unknown, options: unknown) => {
          if (cmd === "list_workers") return Promise.resolve([]);
          if (cmd === "get_board_state") {
            if (boardMode === "loading") return new Promise(() => undefined);
            if (boardMode === "error") return Promise.reject("database is locked");
            return Promise.resolve({ cards: [], coordinators: [] });
          }
          return inner!(cmd, args, options);
        };
      },
    });
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = internals;
  }, mode);
}

const EXPECTED: Record<BoardMode, (page: Page) => ReturnType<Page["getByText"]>> = {
  empty: (page) => page.getByRole("button", { name: "Ersten Worker starten" }),
  loading: (page) => page.getByRole("status").filter({ hasText: "Board wird geladen" }),
  error: (page) => page.getByText("Das Board konnte nicht geladen werden"),
};

for (const mode of ["empty", "loading", "error"] as const) {
  for (const [width, height] of [
    [1280, 800],
    [1024, 768],
  ] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`board ${mode} state at ${width} in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await stubBoard(page, mode);
        await page.goto("/");
        // The work goal opens on the conversation; the rail's button opens the board.
        await page.getByRole("complementary", { name: "Board" }).getByRole("button", { name: "Board" }).click();
        await expect(EXPECTED[mode](page)).toBeVisible();
        if (process.env.BAKEOFF_SHOTS === "1") {
          await page.screenshot({ path: `bakeoff-shots/${mode}-${width}-${theme}.png` });
        }
      });
    }
  }
}
