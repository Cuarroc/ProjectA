import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import SettingsView from "./SettingsView";

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
const { listLiveSessions, installUpdateWhenIdle } = await import("../lib/ipc");
const mocks = { check: vi.mocked(check) };

interface TestProps {
  density: "comfortable";
  onDensityChange: (density: "comfortable" | "compact") => void;
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
  });

  const defaultProps: TestProps = {
    density: "comfortable",
    onDensityChange: vi.fn(),
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
