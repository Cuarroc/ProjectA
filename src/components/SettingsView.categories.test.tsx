import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsView from "./SettingsView";
import fixture from "../test/fixtures/localStorage-v1.2.4.json";
import { loadAgentCategories } from "../lib/settings";
import type { AgentProfile } from "../types";

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
  };
});

const claude: AgentProfile = {
  id: "claude",
  name: "Claude",
  command: "claude",
  args: [],
  env: {},
  fallback: null,
  enabled: true,
};

describe("SettingsView agent categories", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const [key, value] of Object.entries(fixture)) {
      if (key === "_comment" || typeof value !== "string") continue;
      localStorage.setItem(key, value);
    }
  });

  it("hides Employee and shows Queen as historical, without dropping stored employee", () => {
    render(
      <SettingsView
        density="comfortable"
        onDensityChange={vi.fn()}
        profiles={[claude]}
        project={null}
        onSaveTestCommand={vi.fn(async () => undefined)}
        onSaveMaxWorkers={vi.fn(async () => undefined)}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Agent-Kategorien" }));

    expect(screen.queryByText("Employee")).not.toBeInTheDocument();
    expect(screen.getByText("Queen", { selector: ".category-name" })).toBeInTheDocument();
    expect(screen.getByLabelText("Queen historisch")).toHaveTextContent("Historisch");

    const queenRow = screen.getByText("Queen", { selector: ".category-name" }).closest("li");
    expect(queenRow).not.toBeNull();
    expect(within(queenRow!).queryByText("Aktiv")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Default Profile für Queen")).toBeDisabled();

    expect(loadAgentCategories().find((category) => category.id === "employee")).toMatchObject({
      active: true,
      defaultProfileId: "kimi",
    });
  });
});
