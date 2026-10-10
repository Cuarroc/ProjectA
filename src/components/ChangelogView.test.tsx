import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ChangelogView from "./ChangelogView";
import SettingsView from "./SettingsView";

// SettingsView only has to mount; every read it starts stays in flight.
vi.mock("../lib/ipc", () => ({
  describeError: String,
  ...Object.fromEntries(
    ["getBudgets", "getAgentEnvIsolation", "getDigestEnabled", "getLearningSettings", "getRoutingStatus",
      "getStuckAfterMinutes", "getEmergencyStop", "getMaintenance", "getUpdaterState", "listAgentProfiles",
      "listLiveSessions", "getProjectSetupCommand"].map((name) => [name, () => new Promise(() => {})]),
  ),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => new Promise(() => {}) }));

describe("ChangelogView", () => {
  it("renders the newest release first with its Beta pill", () => {
    render(<ChangelogView currentVersion="1.6.0" />);
    const [first] = screen.getAllByRole("region", { name: /^v\d/ });
    expect(within(first).getByRole("heading", { level: 2 })).toHaveTextContent("v1.6.0");
    expect(within(first).getByText("Beta")).toBeInTheDocument();
    expect(within(first).getByText("Installiert")).toBeInTheDocument();
    expect(within(first).getByText("10.10.2026")).toHaveAttribute("datetime", "2026-10-10");
  });

  it("shows tag chips with German labels", () => {
    render(<ChangelogView />);
    const legend = screen.getByRole("list", { name: "Legende" });
    for (const label of ["Neu", "Verbessert", "Behoben", "Sicherheit", "Intern"]) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Sicherheit").length).toBeGreaterThan(1);
  });

  it("older releases are collapsed until requested", () => {
    render(<ChangelogView />);
    expect(screen.getAllByRole("region", { name: /^v\d/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: /Ältere Versionen anzeigen/ }));
    expect(screen.getAllByRole("region", { name: /^v\d/ }).length).toBeGreaterThan(5);
    expect(screen.queryByRole("button", { name: /Ältere Versionen/ })).toBeNull();
  });

  it("settings has a Neuigkeiten tab", () => {
    render(
      <SettingsView
        density="comfortable"
        fonts={{ uiFontSize: "normal", terminalFont: "cascadia", terminalFontSize: 13 }}
        onFontsChange={vi.fn()}
        onDensityChange={vi.fn()}
        profiles={[]}
        project={null}
        onSaveTestCommand={vi.fn()}
        onSaveMaxWorkers={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Neuigkeiten" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "settings-tab-neuigkeiten");
    expect(screen.getAllByRole("region", { name: /^v\d/ })[0]).toBeInTheDocument();
  });
});
