import { defineConfig, devices } from '@playwright/test';

// Same Chromium install as setup-linux / e2e (npx playwright install chromium).
// HQ_CHROMIUM mirrors hq-visual when a preinstalled binary is preferred.
const executablePath = process.env.HQ_CHROMIUM || undefined;

export default defineConfig({
  testDir: './',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
