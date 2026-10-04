import type { Plugin } from "vite";

// The Vite dev server talks HMR over ws://localhost:1420 (1421 with
// TAURI_DEV_HOST). Those sources belong to `tauri dev` only: index.html and
// `app.security.csp` carry the release policy, `app.security.devCsp` and this
// plugin add the websockets while serving (INV-SEC-CSP-SPLIT).
export const DEV_HMR_SOURCES = ["ws://localhost:1420", "ws://localhost:1421"];

export function withDevConnectSources(html: string): string {
  return html.replace(
    /(http-equiv="Content-Security-Policy"\s+content="[^"]*?connect-src[^";]*)/,
    `$1 ${DEV_HMR_SOURCES.join(" ")}`,
  );
}

export function devCsp(): Plugin {
  return {
    name: "projecta-dev-csp",
    apply: "serve",
    transformIndexHtml: { order: "pre", handler: withDevConnectSources },
  };
}
