import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsView from "./SettingsView";
import { deleteSessionBuffers } from "../lib/ipc";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("1.2.4")),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../lib/ipc", async () => {
  const actual = await vi.importActual("../lib/ipc");
  return {
    ...actual,
    describeError: (e: unknown) => String(e),
    listLiveSessions: vi.fn(() => Promise.resolve([])),
    getRoutingStatus: vi.fn(() =>
      Promise.resolve({
        mode: "cheap" as const,
        reviewIndependent: true,
        reviewDetail: "",
      }),
    ),
    getStuckAfterMinutes: vi.fn(() => Promise.resolve(null)),
    getDigestEnabled: vi.fn(() => Promise.resolve(true)),
    getLearningSettings: vi.fn(() => Promise.resolve({})),
    getBudgets: vi.fn(() => Promise.resolve([])),
    listAgentProfiles: vi.fn(() => Promise.resolve([])),
    deleteSessionBuffers: vi.fn(() => Promise.resolve(2)),
  };
});

describe("SettingsView session buffers", () => {
  beforeEach(() => {
    vi.mocked(deleteSessionBuffers).mockClear();
  });

  it("asks once more before wiping every session buffer", async () => {
    render(
      <SettingsView
        density="comfortable"
        onDensityChange={vi.fn()}
        profiles={[]}
        project={null}
        onSaveTestCommand={vi.fn(async () => undefined)}
        onSaveMaxWorkers={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sitzungspuffer löschen" }));
    expect(deleteSessionBuffers).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Wirklich alle Sitzungspuffer löschen" }),
    );
    await waitFor(() => expect(deleteSessionBuffers).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("2 Sitzungspuffer gelöscht.")).toBeInTheDocument();
  });
});
