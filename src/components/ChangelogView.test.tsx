import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  it("opens with a Neuigkeiten view head", () => {
    const { container } = render(<ChangelogView />);
    expect(container.querySelector(".view-head h2")).toHaveTextContent("Neuigkeiten");
  });

  it("shows a calm German empty state when no release parses", () => {
    const { container } = render(<ChangelogView source="" />);
    expect(container.querySelector(".view-head h2")).toHaveTextContent("Neuigkeiten");
    expect(screen.getByRole("status")).toHaveTextContent("Keine Neuigkeiten vorhanden");
    expect(screen.queryByRole("list", { name: "Legende" })).toBeNull();
  });

  it("does not print an impossible release date", () => {
    render(<ChangelogView source={"## v9.9.9 — 99.99.2026\n\n- **Neu:** Etwas Neues.\n"} />);
    const time = screen.getByText("Datum unbekannt");
    expect(time).not.toHaveAttribute("datetime");
    expect(screen.queryByText("99.99.2026")).toBeNull();
  });

  it("offers older versions as a bordered secondary button", () => {
    render(<ChangelogView />);
    expect(screen.getByRole("button", { name: /Ältere Versionen anzeigen/ })).toHaveClass("button-subtle");
  });
});

const stylesSource = readFileSync(resolve(__dirname, "../styles.css"), "utf8").replace(/\r\n/g, "\n");
const section = stylesSource.slice(stylesSource.indexOf("/* Changelog (Neuigkeiten) */"));
const rule = (selector: string): string => {
  const at = section.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return section.slice(at, section.indexOf("}", at));
};

describe("Changelog styles", () => {
  it("keeps off-scale literals out of the changelog block", () => {
    expect(section).not.toMatch(/(?:^|[\s:])(?:28|14|7|20)px/m);
    expect(section).not.toMatch(/letter-spacing:\s*0?\.06em|line-height:\s*1\.(?:1|5)\b/);
    expect(rule(".changelog-rail h2")).toContain("var(--text-2xl");
  });

  it("uses the mono font only for pull request references", () => {
    expect(section.match(/--font-mono/g)).toHaveLength(1);
    expect(rule(".changelog-refs")).toContain("--font-mono");
  });

  it("keeps tag chips and pills neutral except the Sicherheit text", () => {
    expect(section).not.toMatch(/\.changelog-(?:tag-(?:new|improved|fix|internal)|pill-beta)[^{]*\{[^}]*--state-/);
    expect(rule(".changelog-tag-security")).toContain("color: var(--state-danger-fg)");
    expect(rule(".changelog-tag-security")).not.toContain("--state-danger-bg");
  });

  it("does not tint the lead card like a selection", () => {
    expect(section).not.toMatch(/\.changelog-card-lead[^{]*\{[^}]*accent/);
  });
});
