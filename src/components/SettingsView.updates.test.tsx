import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import SettingsView from "./SettingsView";
import type { FontSettings } from "../lib/settings";

type MockUpdaterState =
  | { phase: "idle" }
  | { phase: "ready"; version: string };

// -- Tauri bridges -------------------------------------------------------------

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("1.2.3")),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve(null)),
}));

// -- IPC module under test ----------------------------------------------------

vi.mock("../lib/ipc", async () => {
  const actual = await vi.importActual("../lib/ipc");
  return {
    ...actual,
    describeError: (e: unknown) => String(e),
    listLiveSessions: vi.fn(() => Promise.resolve([])),
    installUpdateWhenIdle: vi.fn(() => Promise.resolve()),
    cancelUpdateDownload: vi.fn(() => Promise.resolve("notRunning" as const)),
    getUpdaterState: vi.fn(() => Promise.resolve({ phase: "idle" as const })),
    setUpdaterState: vi.fn(() => Promise.resolve()),
    getVersion: vi.fn(() => Promise.resolve("1.2.3")),
    getRoutingStatus: vi.fn(() =>
      Promise.resolve({
        mode: "cheap" as const,
        reviewIndependent: false,
        reviewDetail: "auto/review is not a known combo (O-0 400)",
      }),
    ),
    getStuckAfterMinutes: vi.fn(() => Promise.resolve(null)),
    getDigestEnabled: vi.fn(() => Promise.resolve(true)),
  };
});

vi.mock("../lib/settings", async () => {
  const actual = await vi.importActual("../lib/settings");
  return {
    ...actual,
    loadMasterPrompt: vi.fn(() => ""),
  };
});

// -- The check() mock from the updater plugin ----------------------------------

const { check } = await import("@tauri-apps/plugin-updater");
const ipc = await import("../lib/ipc");
const { listLiveSessions, installUpdateWhenIdle, cancelUpdateDownload } = ipc;
const getUpdaterState = vi.mocked(
  (ipc as typeof ipc & { getUpdaterState: () => Promise<MockUpdaterState> })
    .getUpdaterState,
);
const setUpdaterState = vi.mocked(
  (ipc as typeof ipc & { setUpdaterState: (state: { phase: string }) => Promise<void> })
    .setUpdaterState,
);
const mocks = { check: vi.mocked(check) };

interface TestProps {
  density: "comfortable";
  onDensityChange: (density: "comfortable" | "compact") => void;
  fonts: FontSettings;
  onFontsChange: (fonts: FontSettings) => void;
  profiles: [];
  project: null;
  onSaveTestCommand: (command: string | null) => Promise<void>;
  onSaveMaxWorkers: (max: number | null) => Promise<void>;
}

describe("SettingsView updates tab", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.check.mockResolvedValue(null);
    vi.mocked(listLiveSessions).mockReset().mockResolvedValue([]);
    vi.mocked(installUpdateWhenIdle).mockReset().mockResolvedValue();
    vi.mocked(cancelUpdateDownload).mockReset().mockResolvedValue("notRunning");
    getUpdaterState.mockReset().mockResolvedValue({ phase: "idle" });
    setUpdaterState.mockReset().mockResolvedValue();
  });

  const defaultProps: TestProps = {
    density: "comfortable",
    onDensityChange: vi.fn(),
    fonts: { uiFontSize: "normal", terminalFont: "cascadia", terminalFontSize: 13 },
    onFontsChange: vi.fn(),
    profiles: [],
    project: null,
    onSaveTestCommand: vi.fn(() => Promise.resolve()),
    onSaveMaxWorkers: vi.fn(() => Promise.resolve()),
  };

  /**
   * Render wrapped so each test case can override props minimally.
   */
  function renderSettings(props?: Partial<TestProps>) {
    return render(<SettingsView {...defaultProps} {...props} />);
  }

  it("restores the backend updater state after remount", async () => {
    const first = renderSettings();
    await waitFor(() => expect(getUpdaterState).toHaveBeenCalledTimes(1));
    first.unmount();

    getUpdaterState.mockResolvedValueOnce({ phase: "ready", version: "1.3.1" });
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));

    expect(await screen.findByText(/Version 1.3.1 is installed/)).toBeInTheDocument();
  });

  it("does not let a late updater check from an unmounted view overwrite the backend", async () => {
    let finishCheck!: (update: Awaited<ReturnType<typeof check>>) => void;
    mocks.check.mockImplementationOnce(() => new Promise((resolve) => { finishCheck = resolve; }));
    const first = renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(setUpdaterState).toHaveBeenCalledWith({ phase: "checking" }));
    first.unmount();

    getUpdaterState.mockResolvedValueOnce({ phase: "ready", version: "1.3.0" });
    renderSettings();
    finishCheck({
      rid: 42, available: true, version: "1.3.1", body: "Fixture update",
    } as unknown as Awaited<ReturnType<typeof check>>);

    await waitFor(() => expect(listLiveSessions).toHaveBeenCalled());
    expect(setUpdaterState).not.toHaveBeenCalledWith(expect.objectContaining({ phase: "available" }));
  });

  it("publishes updater transitions for the shared HQ state", async () => {
    mocks.check.mockResolvedValue({
      rid: 42, available: true, version: "1.3.1", body: "Fixture update",
    } as unknown as Awaited<ReturnType<typeof check>>);
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await screen.findByText(/Version 1.3.1 is available/);
    fireEvent.click(screen.getByRole("button", { name: "Download and install" }));
    await screen.findByRole("button", { name: "Restart to apply" });

    await waitFor(() => expect(setUpdaterState.mock.calls.map(([state]) => state.phase)).toEqual([
      "checking", "available", "installing", "ready",
    ]));
  });

  it("shows a failed updater state write instead of swallowing it", async () => {
    setUpdaterState.mockRejectedValue(new Error("state store unavailable"));
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText(/state store unavailable/)).toBeInTheDocument();
  });

  it.each(["check", "install"] as const)("refuses update when session inventory fails during %s", async (stage) => {
    const install = vi.fn();
    mocks.check.mockResolvedValue({
      available: true, version: "1.3.1", body: "Fixture update", downloadAndInstall: install,
    } as unknown as Awaited<ReturnType<typeof check>>);
    if (stage === "install") vi.mocked(listLiveSessions).mockResolvedValueOnce([]);
    vi.mocked(listLiveSessions).mockRejectedValueOnce(new Error("session registry unavailable"));
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    if (stage === "install") {
      fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));
    }
    expect(await screen.findByText(/session registry unavailable/)).toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();
    expect(installUpdateWhenIdle).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Download and install" })).not.toBeInTheDocument();
  });

  it("refuses installation when a session becomes reserved after the update check", async () => {
    const install = vi.fn();
    mocks.check.mockResolvedValue({
      available: true, version: "1.3.1", body: "Fixture update", downloadAndInstall: install,
    } as unknown as Awaited<ReturnType<typeof check>>);
    vi.mocked(listLiveSessions).mockResolvedValueOnce([]).mockResolvedValueOnce(["reserved-1"]);
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));
    expect(await screen.findByText(/active — updates install only/)).toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();
    expect(installUpdateWhenIdle).not.toHaveBeenCalled();
  });

  it.each([false, true])("uses the guarded backend installer (rejected: %s)", async (rejected) => {
    const directInstall = vi.fn();
    mocks.check.mockResolvedValue({
      rid: 42, available: true, version: "1.3.1", body: "Fixture update", downloadAndInstall: directInstall,
    } as unknown as Awaited<ReturnType<typeof check>>);
    if (rejected) vi.mocked(installUpdateWhenIdle).mockRejectedValueOnce(new Error("Sessions are active or starting"));
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));
    await waitFor(() => expect(installUpdateWhenIdle).toHaveBeenCalledWith(42));
    if (rejected) {
      expect(await screen.findByText(/Sessions are active or starting/)).toBeInTheDocument();
      expect(screen.queryByText(/is installed/)).not.toBeInTheDocument();
    } else {
      expect(await screen.findByText(/is installed/)).toBeInTheDocument();
    }
    expect(directInstall).not.toHaveBeenCalled();
  });

  it("renders the check button without any stored token", () => {
    renderSettings();
    // open the updates tab
    const updatesTabButton = screen.getByRole("tab", { name: "Updates" });
    fireEvent.click(updatesTabButton);
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeInTheDocument();
  });

  it("checks anonymously — check() called without options/header",
    async () => {
      renderSettings();
      const updatesTabButton = screen.getByRole("tab", { name: "Updates" });
      fireEvent.click(updatesTabButton);

      fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
      await waitFor(() => expect(mocks.check).toHaveBeenCalled());
      expect(mocks.check).toHaveBeenCalledWith(); // no argument, no headers
    });

  it("no longer offers a GitHub token field", () => {
    renderSettings();
    const updatesTabButton = screen.getByRole("tab", { name: "Updates" });
    fireEvent.click(updatesTabButton);

    expect(
      screen.queryByLabelText(/github token/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/github_pat/)).not.toBeInTheDocument();
  });

  it("copys that the feed is the public mirror (no token text)", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    expect(
      screen.getByText(/update checks run anonymously/i),
    ).toBeInTheDocument();
  });

  async function startDownloadAndHoldInstall() {
    let finishInstall!: () => void;
    let rejectInstall!: (reason?: unknown) => void;
    vi.mocked(installUpdateWhenIdle).mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          finishInstall = () => resolve();
          rejectInstall = reject;
        }),
    );
    mocks.check.mockResolvedValue({
      rid: 42, available: true, version: "1.3.1", body: "Fixture update",
    } as unknown as Awaited<ReturnType<typeof check>>);
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));
    await waitFor(() => expect(installUpdateWhenIdle).toHaveBeenCalledWith(42));
    expect(await screen.findByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
    return { finishInstall, rejectInstall };
  }

  it("shows cancel while downloading and returns to available after cancelled", async () => {
    const { rejectInstall } = await startDownloadAndHoldInstall();
    vi.mocked(cancelUpdateDownload).mockResolvedValueOnce("cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    rejectInstall(new Error("Update download cancelled"));
    expect(await screen.findByText(/Download wurde abgebrochen/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Download and install" })).toBeInTheDocument();
    expect(screen.queryByText(/Update download cancelled/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument();
  });

  it("too late cancel keeps install flow and hides the button", async () => {
    const { finishInstall } = await startDownloadAndHoldInstall();
    vi.mocked(cancelUpdateDownload).mockResolvedValueOnce("tooLate");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByText(/lässt sich nicht mehr abbrechen/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument();
    finishInstall();
    expect(await screen.findByRole("button", { name: "Restart to apply" })).toBeInTheDocument();
  });

  it("not running cancel shows no error", async () => {
    const { finishInstall } = await startDownloadAndHoldInstall();
    vi.mocked(cancelUpdateDownload).mockResolvedValueOnce("notRunning");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(cancelUpdateDownload).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    finishInstall();
    expect(await screen.findByRole("button", { name: "Restart to apply" })).toBeInTheDocument();
  });

  it("cancel button is disabled while the cancel is pending", async () => {
    await startDownloadAndHoldInstall();
    let finishCancel!: (value: "cancelled" | "tooLate" | "notRunning") => void;
    vi.mocked(cancelUpdateDownload).mockImplementationOnce(
      () => new Promise((resolve) => { finishCancel = resolve; }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByRole("button", { name: "Abbrechen" })).toBeDisabled();
    finishCancel("cancelled");
    expect(await screen.findByRole("button", { name: "Download and install" })).toBeInTheDocument();
  });

  it("cancelled while a worker is live shows the worker guard not the install button", async () => {
    const { rejectInstall } = await startDownloadAndHoldInstall();
    vi.mocked(listLiveSessions).mockResolvedValueOnce(["live-during-download"]);
    vi.mocked(cancelUpdateDownload).mockResolvedValueOnce("cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    rejectInstall(new Error("Update download cancelled"));
    expect(await screen.findByText(/Download wurde abgebrochen/i)).toBeInTheDocument();
    expect(await screen.findByText(/1 worker is active/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download and install" })).not.toBeInTheDocument();
  });

  it("clears a stale cancel note when checking for updates again", async () => {
    const { rejectInstall } = await startDownloadAndHoldInstall();
    vi.mocked(cancelUpdateDownload).mockResolvedValueOnce("cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    rejectInstall(new Error("Update download cancelled"));
    expect(await screen.findByText(/Download wurde abgebrochen/i)).toBeInTheDocument();

    mocks.check.mockResolvedValue({
      rid: 43, available: true, version: "1.3.2", body: "Next update",
    } as unknown as Awaited<ReturnType<typeof check>>);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText(/Version 1.3.2 is available/)).toBeInTheDocument();
    expect(screen.queryByText(/Download wurde abgebrochen/i)).not.toBeInTheDocument();
  });

  it("shows a fixed error when cancelUpdateDownload rejects", async () => {
    await startDownloadAndHoldInstall();
    vi.mocked(cancelUpdateDownload).mockRejectedValueOnce(new Error("cancel ipc failed"));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    const error = await screen.findByText(/cancel ipc failed/);
    expect(error).toBeInTheDocument();
    expect(error.closest(".settings-error")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument();
    expect(screen.queryByText(/at Object\./)).not.toBeInTheDocument();
  });

  it("surfaces a late install rejection after tooLate exactly once", async () => {
    const { rejectInstall } = await startDownloadAndHoldInstall();
    vi.mocked(cancelUpdateDownload).mockResolvedValueOnce("tooLate");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByText(/lässt sich nicht mehr abbrechen/i)).toBeInTheDocument();
    rejectInstall(new Error("install failed after too late"));
    expect(await screen.findByText(/install failed after too late/)).toBeInTheDocument();
    expect(screen.getAllByText(/install failed after too late/)).toHaveLength(1);
  });

  it("ignores a late cancelled answer after install already finished", async () => {
    const { finishInstall } = await startDownloadAndHoldInstall();
    let finishCancel!: (value: "cancelled" | "tooLate" | "notRunning") => void;
    vi.mocked(cancelUpdateDownload).mockImplementationOnce(
      () => new Promise((resolve) => { finishCancel = resolve; }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    finishInstall();
    expect(await screen.findByRole("button", { name: "Restart to apply" })).toBeInTheDocument();
    finishCancel("cancelled");
    await waitFor(() => expect(cancelUpdateDownload).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Restart to apply" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download and install" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Download wurde abgebrochen/i)).not.toBeInTheDocument();
  });

  it("can download and install again after a cancel", async () => {
    const { rejectInstall } = await startDownloadAndHoldInstall();
    vi.mocked(cancelUpdateDownload).mockResolvedValueOnce("cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    rejectInstall(new Error("Update download cancelled"));
    expect(await screen.findByRole("button", { name: "Download and install" })).toBeInTheDocument();

    vi.mocked(installUpdateWhenIdle).mockResolvedValueOnce();
    fireEvent.click(screen.getByRole("button", { name: "Download and install" }));
    expect(await screen.findByRole("button", { name: "Restart to apply" })).toBeInTheDocument();
    expect(installUpdateWhenIdle).toHaveBeenCalledTimes(2);
  });

  it("surfaces an install rejection after check resets cancel refs", async () => {
    const { rejectInstall } = await startDownloadAndHoldInstall();
    let finishCancel!: (value: "cancelled" | "tooLate" | "notRunning") => void;
    vi.mocked(cancelUpdateDownload).mockImplementationOnce(
      () => new Promise((resolve) => { finishCancel = resolve; }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByRole("button", { name: "Abbrechen" })).toBeDisabled();

    mocks.check.mockResolvedValue({
      rid: 43, available: true, version: "1.3.2", body: "Next update",
    } as unknown as Awaited<ReturnType<typeof check>>);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText(/Version 1.3.2 is available/)).toBeInTheDocument();

    rejectInstall(new Error("stale install rejection after check"));
    expect(await screen.findByText(/stale install rejection after check/)).toBeInTheDocument();
    finishCancel("notRunning");
    expect(screen.getAllByText(/stale install rejection after check/)).toHaveLength(1);
  });

  it("drops a deferred install error when a new update check starts", async () => {
    const { rejectInstall } = await startDownloadAndHoldInstall();
    let finishCancel!: (value: "cancelled" | "tooLate" | "notRunning") => void;
    vi.mocked(cancelUpdateDownload).mockImplementationOnce(
      () => new Promise((resolve) => { finishCancel = resolve; }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByRole("button", { name: "Abbrechen" })).toBeDisabled();

    // Reject while cancel is still pending → error is parked in pendingInstallErrorRef.
    rejectInstall(new Error("deferred install error before check"));
    await waitFor(() => expect(cancelUpdateDownload).toHaveBeenCalled());
    expect(screen.queryByText(/deferred install error before check/)).not.toBeInTheDocument();

    mocks.check.mockResolvedValue({
      rid: 43, available: true, version: "1.3.2", body: "Next update",
    } as unknown as Awaited<ReturnType<typeof check>>);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText(/Version 1.3.2 is available/)).toBeInTheDocument();

    // Check cleared the parked error; notRunning would otherwise surface it.
    finishCancel("notRunning");
    await waitFor(() => expect(cancelUpdateDownload).toHaveBeenCalled());
    expect(screen.queryByText(/deferred install error before check/)).not.toBeInTheDocument();
    expect(screen.getByText(/Version 1.3.2 is available/)).toBeInTheDocument();
  });

  it("clears suppress and cancelled note when install finishes during cancel live-session re-check", async () => {
    let rejectInstall!: (reason?: unknown) => void;
    vi.mocked(installUpdateWhenIdle).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectInstall = reject;
        }),
    );
    // Leave the install promise pending while flipping phase via a late
    // setUpdaterState rejection — that hits the early return after listLiveSessions
    // without the success path clearing cancelNote.
    let rejectInstallingState!: (reason: Error) => void;
    setUpdaterState.mockImplementation((state: { phase: string }) => {
      if (state.phase === "installing") {
        return new Promise<void>((_resolve, reject) => {
          rejectInstallingState = (reason) => reject(reason);
        });
      }
      return Promise.resolve();
    });

    mocks.check.mockResolvedValue({
      rid: 42, available: true, version: "1.3.1", body: "Fixture update",
    } as unknown as Awaited<ReturnType<typeof check>>);
    renderSettings();
    fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));
    await waitFor(() => expect(installUpdateWhenIdle).toHaveBeenCalledWith(42));
    expect(await screen.findByRole("button", { name: "Abbrechen" })).toBeInTheDocument();

    let releaseSessions!: (sessions: string[]) => void;
    vi.mocked(listLiveSessions).mockImplementationOnce(
      () => new Promise((resolve) => { releaseSessions = resolve; }),
    );
    vi.mocked(cancelUpdateDownload).mockResolvedValueOnce("cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(cancelUpdateDownload).toHaveBeenCalled());
    await waitFor(() => expect(listLiveSessions).toHaveBeenCalledTimes(3));

    rejectInstallingState(new Error("state store unavailable"));
    await waitFor(() => expect(screen.getByText(/state store unavailable/)).toBeInTheDocument());

    releaseSessions([]);
    // Early-return path must clear suppress + cancelled note; otherwise the
    // still-pending install rejection is swallowed and the note stays set.
    rejectInstall(new Error("deferred install failure after phase flip"));
    expect(
      await screen.findByText(/deferred install failure after phase flip/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Download wurde abgebrochen/i)).not.toBeInTheDocument();
  });
});

describe("SettingsView routing radiogroup", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("names the product-mode group and announces the review block", async () => {
    render(
      <SettingsView
        density="comfortable"
        onDensityChange={vi.fn()}
        fonts={{ uiFontSize: "normal", terminalFont: "cascadia", terminalFontSize: 13 }}
        onFontsChange={vi.fn()}
        profiles={[]}
        project={null}
        onSaveTestCommand={async () => undefined}
        onSaveMaxWorkers={async () => undefined}
      />,
    );

    const group = await screen.findByRole("radiogroup", {
      name: /Produktmodus \(OmniRoute\)/,
    });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Reliable" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Cheap" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Review" })).toBeInTheDocument();
    const block = await screen.findByRole("status", { name: "Review-Blockade" });
    expect(block).toHaveAttribute("aria-live", "polite");
    expect(block).toHaveTextContent(/Review ist blockiert/);
  });
});
