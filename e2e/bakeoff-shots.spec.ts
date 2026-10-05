import { test } from "@playwright/test";

// Throwaway bake-off evidence: renders the three board states from mock data.
type State = "empty" | "loading" | "error";
const SIZES = [
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
] as const;

for (const state of ["empty", "loading", "error"] as const satisfies readonly State[]) {
  for (const size of SIZES) {
    for (const theme of ["light", "dark"] as const) {
      test(`${state}-${size.w}-${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((mode: State) => {
          window.__PROJECTA_E2E_RICH__ = true;
          const internals: Record<string, unknown> = {};
          let real: ((cmd: string, args?: unknown) => Promise<unknown>) | undefined;
          Object.defineProperty(internals, "invoke", {
            configurable: true,
            get: () => (cmd: string, args?: unknown) => {
              if (cmd === "get_board_state") {
                if (mode === "empty") return Promise.resolve({ cards: [], coordinators: [] });
                if (mode === "loading") return new Promise(() => undefined);
                return Promise.reject("network timed out");
              }
              return real?.(cmd, args);
            },
            set: (fn) => {
              real = fn;
            },
          });
          (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals;
        }, state);
        await page.goto("/");
        await page
          .getByRole("complementary", { name: "Board" })
          .getByRole("button", { name: "Board", exact: true })
          .click();
        await page.locator(state === "loading" ? ".board-loading" : ".board-state").waitFor();
        await page.addStyleTag({ content: "*{animation:none!important}" });
        await page.screenshot({ path: `bakeoff-shots/${state}-${size.w}-${theme}.png` });
      });
    }
  }
}
