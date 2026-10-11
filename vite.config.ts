import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { devCsp } from "./src/dev-csp";

// `TAURI_DEV_HOST` is set by the Tauri CLI when developing against a device on
// the local network. Everything else is a plain Vite setup.
const host = process.env.TAURI_DEV_HOST;

function buildSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "lokal"; }
}

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), devCsp()],
  // Tauri's CLI owns the terminal output during `tauri dev`.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // The Rust core is watched by cargo, not by Vite.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: "dist",
    target: "esnext",
    // Keine Sourcemaps im Produktions-Bundle: der NSIS-Installer wird über das
    // öffentliche Mirror-Repo verteilt, der Quellcode bleibt privat.
    sourcemap: false,
  },
});
