import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { VersionUpdates } from "./VersionUpdates";

// Counts every state update, so "no update after unmount" is observable (React itself stays silent).
const updates = vi.hoisted(() => ({ count: 0 }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const [value, set] = actual.useState(init);
      return [value, (next: unknown) => { updates.count += 1; (set as (n: unknown) => void)(next); }];
    },
  };
});
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("../../lib/ipc", () => ({ describeError: String }));

beforeEach(() => {
  vi.mocked(getVersion).mockReset();
  vi.mocked(check).mockReset();
  updates.count = 0;
});
afterEach(cleanup);

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe("VersionUpdates after unmount", () => {
  it("drops a late getVersion result without a state update", async () => {
    const late = deferred<string>();
    vi.mocked(getVersion).mockReturnValue(late.promise);
    const { unmount } = render(<VersionUpdates />);
    unmount();
    const before = updates.count;
    await act(async () => { late.resolve("1.2.3"); await late.promise; });
    expect(updates.count).toBe(before);
  });

  it("drops a late getVersion failure without a state update", async () => {
    const late = deferred<string>();
    vi.mocked(getVersion).mockReturnValue(late.promise);
    const { unmount } = render(<VersionUpdates />);
    unmount();
    const before = updates.count;
    await act(async () => { late.reject(new Error("gone")); await late.promise.catch(() => undefined); });
    expect(updates.count).toBe(before);
  });

  it("drops a late updater check without a state update", async () => {
    vi.mocked(getVersion).mockResolvedValue("1.2.3");
    const late = deferred<null>();
    vi.mocked(check).mockReturnValue(late.promise);
    const { unmount } = render(<VersionUpdates />);
    await screen.findByText("ProjectA 1.2.3");
    fireEvent.click(screen.getByRole("button", { name: "Nach Updates suchen" }));
    unmount();
    const before = updates.count;
    await act(async () => { late.resolve(null); await late.promise; });
    expect(updates.count).toBe(before);
  });

  it("drops a late updater failure without a state update", async () => {
    vi.mocked(getVersion).mockResolvedValue("1.2.3");
    const late = deferred<null>();
    vi.mocked(check).mockReturnValue(late.promise);
    const { unmount } = render(<VersionUpdates />);
    await screen.findByText("ProjectA 1.2.3");
    fireEvent.click(screen.getByRole("button", { name: "Nach Updates suchen" }));
    unmount();
    const before = updates.count;
    await act(async () => { late.reject(new Error("offline")); await late.promise.catch(() => undefined); });
    expect(updates.count).toBe(before);
  });
});
