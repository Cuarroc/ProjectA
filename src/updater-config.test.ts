/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression: 2026-08-31 — der Updater-Endpoint zeigte auf das *private*
// Hauptrepo (raw.githubusercontent.com/Cuarroc/ProjectA/...). Die App sendet
// keinen Auth-Header, GitHub antwortet anonym mit 404 und der Updater meldet
// "Could not fetch a valid release JSON from the remote". Kanonischer Ort ist
// seitdem das oeffentliche Mirror-Repo Cuarroc/ProjectA-updates, latest.json
// als Release-Asset unter releases/latest/download/ (Tauri-Standard).
// Hinweis: node-Environment statt jsdom, damit import.meta.url eine
// file:-URL ist (unter jsdom scheitert fileURLToPath).
const here = dirname(fileURLToPath(import.meta.url));
const confPath = resolve(here, "..", "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8")) as {
  plugins?: { updater?: { endpoints?: string[] } };
};
const endpoints = conf.plugins?.updater?.endpoints ?? [];

const MIRROR_ENDPOINT =
  "https://github.com/Cuarroc/ProjectA-updates/releases/latest/download/latest.json";

describe("updater endpoints (tauri.conf.json)", () => {
  it("definiert mindestens einen Endpoint", () => {
    expect(endpoints.length).toBeGreaterThan(0);
  });

  it("ist exakt der oeffentliche Mirror-Kanal (latest/download-Asset)", () => {
    for (const endpoint of endpoints) {
      expect(endpoint).toBe(MIRROR_ENDPOINT);
    }
  });

  it("enthaelt keine URL-Form, die fuer die anonyme App scheitert", () => {
    for (const endpoint of endpoints) {
      expect(endpoint).not.toContain("api.github.com");
      expect(endpoint).not.toContain("raw.githubusercontent.com");
      // "Cuarroc/ProjectA/..." ohne das "-updates"-Suffix ist das private Repo.
      expect(endpoint).not.toMatch(/Cuarroc\/ProjectA(?!-updates)\//);
    }
  });
});
