/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Die Retry-Regel gehoert zur Config; den Playwright-Runner muss dieser
// Unit-Test dafuer nicht laden. Die echte Config wird unten weiter importiert.
vi.mock("@playwright/test", () => ({
  defineConfig: <T>(config: T) => config,
  devices: { "Desktop Chrome": {} },
}));

// Regel G-2 (src-tauri/.config/nextest.toml, Sanierungsplan §0.1): "ein Test,
// der beim zweiten Versuch gruen wird, ist kaputt und nicht gruen". Die
// Rust-Suite haelt sich daran (`retries = 0` im ci-Profil), der Browser-Smoke
// tat es bis zum 09.09. nicht: `retries: process.env.CI ? 1 : 0` gab genau
// unter CI den zweiten Versuch, den die Regel verbietet.
//
// Zwei Schaeden in einem: ein flackernder e2e-Test wurde in CI stillschweigend
// gruen, und der lokale Lauf war STRENGER als CI — also konnte "lokal gruen"
// nicht mehr fuer "CI gruen" buergen und umgekehrt. Genau diese Aequivalenz
// ist der Zweck von scripts/ci/gates.sh.
//
// Der Test laedt die Config zweimal frisch, weil `process.env.CI` beim
// Modul-Laden gelesen wird — ein einmaliger Import wuerde die CI-Variante nie
// sehen.
async function loadRetries(ci: string | undefined): Promise<number | undefined> {
  const previous = process.env.CI;
  if (ci === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = ci;
  }
  try {
    vi.resetModules();
    const module = await import("../playwright.config");
    return module.default.retries;
  } finally {
    if (previous === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previous;
    }
  }
}

afterEach(() => {
  vi.resetModules();
});

describe("playwright.config.ts — Retry-Verbot (G-2)", () => {
  it("wiederholt lokal keinen fehlgeschlagenen Test", async () => {
    await expect(loadRetries(undefined)).resolves.toBe(0);
  });

  it("wiederholt auch unter CI=true keinen fehlgeschlagenen Test", async () => {
    await expect(loadRetries("true")).resolves.toBe(0);
  });

  it("verhaelt sich unter CI identisch zum lokalen Lauf", async () => {
    const local = await loadRetries(undefined);
    const ci = await loadRetries("true");
    expect(ci).toBe(local);
  });
});
