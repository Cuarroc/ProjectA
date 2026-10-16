import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { cancelUpdateDownload, installUpdateWhenIdle, listLiveSessions, type CancelUpdateResult } from "../../lib/ipc";
import { VersionUpdates } from "./VersionUpdates";
import { T } from "./texts";
import { de } from "../../i18n/de";
import { GALLERY_PATH } from "../../shell/mount/routing";

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
vi.mock("../../lib/ipc", () => ({
  describeError: String,
  listLiveSessions: vi.fn(),
  installUpdateWhenIdle: vi.fn(),
  cancelUpdateDownload: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getVersion).mockReset();
  vi.mocked(check).mockReset();
  vi.mocked(listLiveSessions).mockReset().mockResolvedValue([]);
  vi.mocked(installUpdateWhenIdle).mockReset();
  vi.mocked(cancelUpdateDownload).mockReset();
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

describe("VersionUpdates version re-read on check", () => {
  it("reads the version again when the user checks for updates", async () => {
    vi.mocked(getVersion).mockRejectedValueOnce(new Error("gone")).mockResolvedValue("1.2.3");
    vi.mocked(check).mockResolvedValue(null);
    render(<VersionUpdates />);
    await screen.findByText("Nur in der Desktop-App verfügbar.");
    fireEvent.click(screen.getByRole("button", { name: "Nach Updates suchen" }));
    expect(await screen.findByText("ProjectA 1.2.3")).toBeTruthy();
  });

  it("turns a failed version read into the version after a successful check", async () => {
    vi.mocked(getVersion).mockRejectedValueOnce(new Error("gone")).mockResolvedValue("1.2.3");
    vi.mocked(check).mockResolvedValue(null);
    render(<VersionUpdates />);
    expect(await screen.findByText("Nur in der Desktop-App verfügbar.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nach Updates suchen" }));
    await screen.findByText("ProjectA 1.2.3");
    expect(screen.queryByText("Nur in der Desktop-App verfügbar.")).toBeNull();
  });
});

describe("VersionUpdates install and cancel", () => {
  const install = () => screen.findByRole("button", { name: "Installieren" });
  // Checks once and waits for the install button, the way a user reaches it.
  const available = async () => {
    vi.mocked(getVersion).mockResolvedValue("1.2.3");
    vi.mocked(check).mockResolvedValue({ available: true, version: "2.0.0", rid: 7 } as unknown as Update);
    render(<VersionUpdates />);
    fireEvent.click(await screen.findByRole("button", { name: "Nach Updates suchen" }));
    return install();
  };
  // A download that stays in flight until the test settles it.
  const download = () => {
    const flight = deferred<void>();
    vi.mocked(installUpdateWhenIdle).mockReturnValue(flight.promise);
    return flight;
  };
  const cancel = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));
  };

  it("offers Installieren for an available update", async () => {
    expect(await available()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
  });

  it("installs with the update handle and asks to restart", async () => {
    fireEvent.click(await available());
    expect(await screen.findByText(/Version 2\.0\.0 ist installiert/)).toBeTruthy();
    expect(installUpdateWhenIdle).toHaveBeenCalledWith(7);
  });

  it("shows Abbrechen while downloading", async () => {
    download();
    fireEvent.click(await available());
    expect(await screen.findByRole("button", { name: "Abbrechen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Installieren" })).toBeNull();
  });

  it("shows the too-late text when the cancel comes too late", async () => {
    download();
    vi.mocked(cancelUpdateDownload).mockResolvedValue("tooLate");
    fireEvent.click(await available());
    await cancel();
    expect(await screen.findByText(/lässt sich nicht mehr abbrechen/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
  });

  it("takes the tooLate branch by variant even when its label is missing", async () => {
    const labels = T.cancelResult as Record<string, string | undefined>;
    const text = labels.tooLate;
    delete labels.tooLate;
    try {
      download();
      vi.mocked(cancelUpdateDownload).mockResolvedValue("tooLate");
      fireEvent.click(await available());
      await cancel();
      await act(async () => { await vi.mocked(cancelUpdateDownload).mock.results[0]?.value; });
      // The branch clears `cancelling`; a label lookup would leave the button off.
      expect((screen.getByRole("button", { name: "Abbrechen" }) as HTMLButtonElement).disabled).toBe(false);
    } finally {
      labels.tooLate = text;
    }
  });

  it("returns to the install offer when the cancel succeeds", async () => {
    const flight = download();
    vi.mocked(cancelUpdateDownload).mockResolvedValue("cancelled");
    fireEvent.click(await available());
    await cancel();
    expect(await install()).toBeTruthy();
    expect(screen.getByText(/Der Download wurde abgebrochen/)).toBeTruthy();
    await act(async () => { flight.reject(new Error("aborted")); await flight.promise.catch(() => undefined); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // A cancel verdict that stays in flight until the test settles it.
  const verdict = () => {
    const flight = deferred<CancelUpdateResult>();
    vi.mocked(cancelUpdateDownload).mockReturnValue(flight.promise);
    return flight;
  };
  const rejectDownload = (flight: { promise: Promise<void>; reject: (e: unknown) => void }, e: unknown) =>
    act(async () => { flight.reject(e); await flight.promise.catch(() => undefined); });

  it("treats an install rejection that beats the cancel verdict as the abort", async () => {
    const flight = download();
    const answer = verdict();
    fireEvent.click(await available());
    await cancel();
    await rejectDownload(flight, new Error("aborted"));
    await act(async () => { answer.resolve("cancelled"); await answer.promise; });
    expect(await install()).toBeTruthy();
    expect(screen.getByText(/Der Download wurde abgebrochen/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an install rejection that beats a tooLate verdict as an error", async () => {
    const flight = download();
    const answer = verdict();
    fireEvent.click(await available());
    await cancel();
    await rejectDownload(flight, new Error("disk full"));
    await act(async () => { answer.resolve("tooLate"); await answer.promise; });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Installieren" })).toBeNull();
  });

  it("keeps Abbrechen disabled after notRunning until the install settles", async () => {
    const flight = download();
    vi.mocked(cancelUpdateDownload).mockResolvedValue("notRunning");
    fireEvent.click(await available());
    await cancel();
    await act(async () => { await vi.mocked(cancelUpdateDownload).mock.results[0]?.value; });
    expect((screen.getByRole("button", { name: "Abbrechen" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { flight.resolve(); await flight.promise; });
    expect(await screen.findByText(/Version 2\.0\.0 ist installiert/)).toBeTruthy();
  });

  it("shows an install failure after a notRunning verdict as an error", async () => {
    const flight = download();
    vi.mocked(cancelUpdateDownload).mockResolvedValue("notRunning");
    fireEvent.click(await available());
    await cancel();
    await act(async () => { await vi.mocked(cancelUpdateDownload).mock.results[0]?.value; });
    await rejectDownload(flight, new Error("disk full"));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("shows an install failure as an error", async () => {
    vi.mocked(installUpdateWhenIdle).mockRejectedValue(new Error("disk full"));
    fireEvent.click(await available());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/Version 2\.0\.0 ist installiert/)).toBeNull();
  });

  it("shows a failing cancel as an error", async () => {
    download();
    vi.mocked(cancelUpdateDownload).mockRejectedValue(new Error("ipc down"));
    fireEvent.click(await available());
    await cancel();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("does not offer Installieren while workers are running", async () => {
    vi.mocked(listLiveSessions).mockResolvedValue(["w1"]);
    vi.mocked(getVersion).mockResolvedValue("1.2.3");
    vi.mocked(check).mockResolvedValue({ available: true, version: "2.0.0", rid: 7 } as unknown as Update);
    render(<VersionUpdates />);
    fireEvent.click(await screen.findByRole("button", { name: "Nach Updates suchen" }));
    expect(await screen.findByText(/1 Worker läuft/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Installieren" })).toBeNull();
  });

  it("re-checks the workers at click time and then does not download", async () => {
    const button = await available();
    vi.mocked(listLiveSessions).mockResolvedValue(["w1"]);
    fireEvent.click(button);
    expect(await screen.findByText(/1 Worker läuft/)).toBeTruthy();
    expect(installUpdateWhenIdle).not.toHaveBeenCalled();
  });
});

describe("design gallery link (DS-X-15)", () => {
  it("the gallery is reachable from Einstellungen Version", () => {
    vi.mocked(getVersion).mockResolvedValue("1.0.0");
    render(<VersionUpdates />);
    expect(screen.getByRole("link", { name: de["gallery.open"] }).getAttribute("href")).toBe(`#${GALLERY_PATH}`);
  });
});
