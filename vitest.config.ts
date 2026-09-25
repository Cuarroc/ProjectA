import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// Vitest normally supplies this value itself, but an inherited production
// environment wins over that default and makes React load its production
// build. Testing Library's act() support then fails before tests can run.
process.env.NODE_ENV = "test";

// JUnit fuer Mergify Test Insights (CI-01). Nur wenn der CI-Job `gates
// (linux)` PA_JUNIT=1 setzt - lokal und in red-first bleibt die Ausgabe
// unveraendert (red-first liest die Zusammenfassung des default-Reporters).
// `github-actions` steht mit drin, weil eine explizite Reporter-Liste den
// automatisch aktivierten Annotations-Reporter sonst verdraengen wuerde.
const junitReporters =
  process.env.PA_JUNIT === "1"
    ? {
        reporters: ["default", "github-actions", "junit"],
        outputFile: { junit: ".junit/vitest.xml" },
      }
    : {};

export default defineConfig({
  plugins: [react()],
  test: {
    ...junitReporters,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Git-Worktrees liegen hier *innerhalb* des Repos (`.worktrees/`,
    // `.claude/worktrees/`) und tragen ihre eigenen, fremden Testdateien. Ohne
    // diese Grenze haengt `npm test` davon ab, woran gerade eine andere Sitzung
    // arbeitet: ein halbfertiger Worktree faerbt das Gate rot, ein geloeschter
    // aendert die Testzahl. Ein Gate, dessen Ergebnis von fremder Arbeit
    // abhaengt, belegt nichts.
    // Node parser tests under scripts/lib use `node:test` (`npm run test:hq`).
    exclude: [
      ...configDefaults.exclude,
      "**/.worktrees/**",
      "**/.claude/worktrees/**",
      "scripts/**",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/__tests__/**", "src/test/**"],
      thresholds: {
        // T-3 ratchet, measured 2026-09-06 across every production TS/TSX file.
        // Raise these values with coverage gains; never lower them.
        statements: 40.45,
        branches: 30.03,
        functions: 30.46,
        lines: 43.36,
      },
    },
  },
});
