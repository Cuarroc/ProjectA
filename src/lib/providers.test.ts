import { describe, expect, it } from "vitest";

import { overviewVaultError, vaultErrorText } from "./providers";
import type { Provider } from "../types";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "openrouter",
    name: "OpenRouter",
    kind: "api_key",
    connected: false,
    detail: null,
    quotaState: "unknown",
    blockedUntil: null,
    omniRouteOnline: false,
    usage: null,
    vaultError: null,
    ...overrides,
  };
}

describe("overviewVaultError", () => {
  it("is null when no row carries a vault error", () => {
    expect(overviewVaultError([])).toBeNull();
    expect(overviewVaultError([provider(), provider({ id: "kimi" })])).toBeNull();
  });

  it("returns the error the core repeats on every row", () => {
    const error = "vault_corrupt: damaged";
    const rows = [provider({ vaultError: error }), provider({ id: "kimi", vaultError: error })];
    expect(overviewVaultError(rows)).toBe(error);
  });

  it("skips rows that carry nothing and finds the one that does", () => {
    const rows = [provider(), provider({ id: "kimi", vaultError: "vault_unreadable: denied" })];
    expect(overviewVaultError(rows)).toBe("vault_unreadable: denied");
  });
});

describe("vaultErrorText", () => {
  it("explains each known code in German without echoing the raw detail", () => {
    expect(vaultErrorText("vault_corrupt: line 1 column 2")).toContain("beschädigt");
    expect(vaultErrorText("vault_decrypt_failed: os error 13")).toContain("Windows-Konto");
    expect(vaultErrorText("vault_unreadable: permission denied")).toContain("nicht gelesen");
    // The raw English detail stays in the tooltip, not the banner text.
    expect(vaultErrorText("vault_corrupt: line 1 column 2")).not.toContain("column 2");
  });

  it("passes an unknown error through verbatim instead of relabeling it", () => {
    expect(vaultErrorText("vault_future_kind: something new")).toBe("vault_future_kind: something new");
  });
});
