/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// P2-F (Phase 2, 02.09.2026): `app.security.csp` in tauri.conf.json war `null`.
// index.html trug seit Phase 1 eine eigene Meta-CSP, die Tauri-Config keine -
// zwei Orte, ein Wert, kein Test. Diese Datei haelt beides zusammen:
// die Config-CSP ist gesetzt, restriktiv, und die Meta in index.html traegt
// dieselben Direktiven. Beide Traeger sind noetig (live belegt 02.09.):
// im Dev injiziert Tauri nichts, dort gilt nur die Meta; im Release haengt
// Tauri seine Config-CSP als ZWEITES Meta an (tauri-utils html.rs::inject_csp
// -> head.append), der Browser wendet die Schnittmenge an. Weichen die beiden
// ab, scheitert genau eine Umgebung, und zwar still in der Webview-Konsole.
//
// Inventar der webview-seitigen Verbindungen (P2-F-Vor-Schritt, 02.09.):
// kein fetch(, kein WebSocket/EventSource, kein new Image(, kein <img>,
// kein externer @import/url(); Fonts liegen lokal unter /fonts/*.otf;
// `window.open` nur als Fallback in ipc.ts::openExternal. Vite-HMR im Dev
// spricht ws://localhost:1420 (bzw. 1421 mit TAURI_DEV_HOST); Tauri-IPC
// braucht `ipc:` (Linux/macOS) und `http://ipc.localhost` (Windows).
const here = dirname(fileURLToPath(import.meta.url));
const conf = JSON.parse(
  readFileSync(resolve(here, "..", "src-tauri", "tauri.conf.json"), "utf8"),
) as { app?: { security?: { csp?: string | null } } };
const csp = conf.app?.security?.csp ?? null;

const indexHtml = readFileSync(resolve(here, "..", "index.html"), "utf8");
const metaMatch = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(indexHtml);
const metaCsp = metaMatch?.[1] ?? null;

function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    map.set(tokens[0], tokens.slice(1));
  }
  return map;
}

describe("content security policy (tauri.conf.json + index.html)", () => {
  it("is set in tauri.conf.json", () => {
    expect(typeof csp).toBe("string");
    expect((csp ?? "").length).toBeGreaterThan(0);
  });

  it("is the same policy in index.html - one value, two carriers", () => {
    // Parsed, not string-compared (Review P2-F, GLM-B6): directive order and
    // whitespace must not matter, a missing or extra source must.
    expect(metaCsp).not.toBeNull();
    const a = directives(csp ?? "");
    const b = directives(metaCsp ?? "");
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [name, sources] of a) {
      expect([...(b.get(name) ?? [])].sort()).toEqual([...sources].sort());
    }
  });

  it("names worker-src explicitly so a future blob: worker is a decision, not an accident", () => {
    expect(directives(csp ?? "").get("worker-src")).toEqual(["'self'"]);
  });

  it("starts from default-src 'self' and forbids eval and objects", () => {
    const d = directives(csp ?? "");
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(d.get("object-src")).toEqual(["'none'"]);
  });

  it("has no wildcard host anywhere", () => {
    for (const [, sources] of directives(csp ?? "")) {
      for (const source of sources) {
        expect(source).not.toBe("*");
        expect(source).not.toMatch(/^(https?|wss?):\/\/\*/);
        expect(source).not.toMatch(/^\*\./);
      }
    }
  });

  it("lets Tauri IPC through on every platform", () => {
    const connect = directives(csp ?? "").get("connect-src") ?? [];
    expect(connect).toEqual(expect.arrayContaining(["'self'", "ipc:", "http://ipc.localhost"]));
  });

  it("allows only what the inventory found: local fonts, data images, no blob", () => {
    const d = directives(csp ?? "");
    expect(d.get("font-src")).toEqual(["'self'"]);
    expect(d.get("img-src")).toEqual(["'self'", "data:"]);
    expect(csp).not.toContain("blob:");
  });
});
