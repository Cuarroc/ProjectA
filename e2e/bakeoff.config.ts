import { defineConfig } from "@playwright/test";

import base from "../playwright.config";

// The shared config pins port 1420 and refuses to reuse a server, so two
// worktrees cannot screenshot at once. Same setup, own port, only the shots.
const port = 14520;

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "bakeoff-board.shots.ts",
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...(base.webServer as object),
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
  },
});
