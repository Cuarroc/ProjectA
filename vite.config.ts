import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `TAURI_DEV_HOST` is set by the Tauri CLI when developing against a device on
// the local network. Everything else is a plain Vite setup.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
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
