import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getProviderOverview, getQuotaState } from "../../lib/ipc";
import type { Provider, QuotaState } from "../../types";
import { QuotaBar } from "./QuotaBell";

vi.mock("../../lib/ipc", () => ({ getProviderOverview: vi.fn(), getQuotaState: vi.fn(), describeError: String }));
const provider = (changes: Partial<Provider> = {}): Provider => ({
  id: "sample", name: "Beispiel", kind: "subscription", connected: true,
  detail: null, quotaState: "ok", blockedUntil: null, omniRouteOnline: false,
  vaultError: null, usage: null, ...changes,
});
const quota = (state: QuotaState["state"]): QuotaState => ({
  profileId: "sample", state, blockedUntil: null, reason: null, omniRouteOnline: false,
});
const usage = (percent: number | null, windowLabel = "5 Stunden") => ({
  percent, windowLabel, used: null, limit: null, resetsAt: null,
  source: "hook", observedAt: Date.now() / 1000,
});
const link = () => screen.getByRole("link", { name: /Kontingente/ });
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
beforeEach(() => {
  localStorage.setItem("projecta.settings.featureFlag.weitere_bereiche", "1");
  vi.useFakeTimers();
  vi.mocked(getQuotaState).mockReset().mockResolvedValue([]);
  vi.mocked(getProviderOverview).mockReset().mockResolvedValue([]);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

it("shows observed quota blocks in the header instead of a placeholder", async () => {
  vi.mocked(getQuotaState).mockResolvedValue([quota("blocked")]);
  vi.mocked(getProviderOverview).mockResolvedValue([provider({ usage: usage(10) })]);
  await act(async () => { render(<QuotaBar />); });
  expect(link()).toHaveTextContent(/Blockiert/);
  expect(link()).toHaveAttribute("href", "#/steuerung");
  expect(screen.queryByRole("meter")).toBeNull();
  vi.mocked(getQuotaState).mockResolvedValue([quota("ok")]);
  vi.mocked(getProviderOverview).mockResolvedValue([provider({ quotaState: "blocked" })]);
  await poll();
  expect(link()).toHaveTextContent(/Blockiert/);
  vi.mocked(getProviderOverview).mockResolvedValue([provider()]);
  await poll();
  expect(link()).toHaveTextContent(/Verfügbar/);
  expect(screen.queryByRole("meter")).toBeNull();
  vi.mocked(getProviderOverview).mockResolvedValue([provider({ usage: usage(null) })]);
  await poll();
  expect(link()).toHaveTextContent(/Verfügbar/);
  expect(screen.queryByRole("meter")).toBeNull();
  vi.mocked(getProviderOverview).mockResolvedValue([provider({ usage: usage(0) })]);
  await poll();
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  expect(link()).toHaveTextContent("Beispiel · 5 Stunden · 0 % verbraucht");
  vi.mocked(getProviderOverview).mockResolvedValue([
    provider({ usage: usage(25) }),
    provider({ id: "other", name: "Weiterer", usage: usage(60, "7 Tage") }),
  ]);
  await poll();
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "60");
  expect(link()).toHaveTextContent("Weiterer · 7 Tage · 60 % verbraucht");
  expect(link()).not.toHaveTextContent("85");
  expect(getQuotaState).toHaveBeenCalledTimes(6);
  expect(getProviderOverview).toHaveBeenCalledTimes(6);
});

it("never renders unknown or failed quota data as zero percent", async () => {
  await act(async () => { render(<QuotaBar />); });
  expect(link()).toHaveTextContent(/unbekannt/i);
  expect(screen.queryByRole("meter")).toBeNull();
  for (const percent of [null, NaN, -1, 101, Infinity]) {
    vi.mocked(getProviderOverview).mockResolvedValue([provider({ quotaState: "unknown", usage: usage(percent) })]);
    await poll();
    expect(link()).toHaveTextContent(/unbekannt/i);
    expect(link()).not.toHaveTextContent(/0 %/);
    expect(screen.queryByRole("meter")).toBeNull();
  }
  vi.mocked(getProviderOverview).mockResolvedValue([provider({ usage: { ...usage(40), observedAt: Date.now() / 1000 - 301 } })]);
  await poll();
  expect(link()).toHaveTextContent(/unbekannt/i);
  expect(screen.queryByRole("meter")).toBeNull();
  vi.mocked(getProviderOverview).mockResolvedValue([provider({ usage: usage(40) })]);
  await poll();
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "40");
  vi.mocked(getProviderOverview).mockRejectedValue(new Error("offline"));
  await poll();
  expect(link()).toHaveTextContent(/unbekannt/i);
  expect(screen.queryByRole("meter")).toBeNull();
  vi.mocked(getProviderOverview).mockResolvedValue([provider({ usage: usage(40) })]);
  vi.mocked(getQuotaState).mockRejectedValue(new Error("offline"));
  await poll();
  expect(link()).toHaveTextContent(/unbekannt/i);
  expect(screen.queryByRole("meter")).toBeNull();
  vi.mocked(getQuotaState).mockResolvedValue([quota("blocked")]);
  await poll();
  vi.mocked(getQuotaState).mockRejectedValue(new Error("offline"));
  await poll();
  expect(link()).toHaveTextContent(/Blockiert.*letzter Stand/);
  expect(screen.queryByRole("meter")).toBeNull();
});
