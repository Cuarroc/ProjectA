/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression P2-J (Phase 2.9, 02.09.2026): `openExternal` in src/lib/ipc.ts
// ruft `plugin:opener|open_url`, aber das Plugin war nie registriert - weder
// in Cargo.toml noch in main.rs, und keine Capability erlaubte den Befehl.
// Jeder Aufruf scheiterte still und fiel auf `window.open` zurueck, das unter
// WebView2 unzuverlaessig ist (GitHub-Issues belegt). Diese drei Asserts
// halten die Verdrahtung zusammen: Crate, Registrierung, Permission mit
// URL-Scope. Faellt eines weg, ist der Fallback wieder der einzige Pfad.
//
// Scope-Entscheidung: http(s) statt einer GitHub-only-Whitelist, weil
// openExternal auch die Web-Interface-URLs (LAN, http://) und die Links aus
// Empfehlungen oeffnet; ipc.ts weist alles ausser http(s) ohnehin vorher ab.
const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = resolve(here, "..", "src-tauri");

const cargoToml = readFileSync(resolve(tauriDir, "Cargo.toml"), "utf8");
const mainRs = readFileSync(resolve(tauriDir, "src", "main.rs"), "utf8");

type ScopeEntry = { url?: string };
type Permission = string | { identifier: string; allow?: ScopeEntry[]; deny?: ScopeEntry[] };
const capability = JSON.parse(
  readFileSync(resolve(tauriDir, "capabilities", "default.json"), "utf8"),
) as { permissions: Permission[] };

const openerPermissions = capability.permissions.filter(
  (p): p is Exclude<Permission, string> =>
    typeof p === "object" && p.identifier === "opener:allow-open-url",
);

describe("opener plugin wiring (P2-J)", () => {
  it("declares the crate in Cargo.toml", () => {
    expect(cargoToml).toMatch(/^tauri-plugin-opener\s*=/m);
  });

  it("registers the plugin in main.rs", () => {
    expect(mainRs).toContain("tauri_plugin_opener::init()");
  });

  it("grants open_url exactly once, with an explicit URL scope", () => {
    expect(openerPermissions).toHaveLength(1);
    const allow = openerPermissions[0].allow ?? [];
    expect(allow.length).toBeGreaterThan(0);
  });

  it("scopes open_url to web URLs only - no mailto, tel, file or wildcard", () => {
    const urls = (openerPermissions[0]?.allow ?? []).map((e) => e.url ?? "");
    expect(urls).toEqual(expect.arrayContaining(["https://*", "http://*"]));
    for (const url of urls) {
      expect(url).toMatch(/^https?:\/\//);
    }
  });

  it("does not fall back to the unscoped default permission set", () => {
    const flat = capability.permissions.filter((p): p is string => typeof p === "string");
    expect(flat).not.toContain("opener:default");
    expect(flat).not.toContain("opener:allow-default-urls");
    expect(flat).not.toContain("opener:allow-open-url");
  });
});
