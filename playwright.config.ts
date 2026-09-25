import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // G-2 (src-tauri/.config/nextest.toml): ein Test, der beim zweiten
  // Versuch gruen wird, ist kaputt und nicht gruen. Das galt bis zum
  // 09.09. nur fuer die Rust-Suite; unter CI bekam der Browser-Smoke
  // genau den zweiten Versuch, den die Regel verbietet — und der lokale
  // Lauf war damit strenger als CI. Stabilitaet belegt scripts/flake.sh,
  // nicht eine stille Wiederholung. Beleg: src/e2e-retries.test.ts
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    env: { VITE_TAURI_MOCKS: "true" },
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
