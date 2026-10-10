import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Icon, { ICON_NAMES, type IconName } from "./Icon";
import StatusBar from "./StatusBar";
import TabBar from "./TabBar";
import ViewBar from "./ViewBar";
import Sidebar from "./Sidebar";
import type { Project, TerminalSession } from "../types";

vi.mock("../lib/useSharpening", () => ({
  useSharpening: () => ({
    phase: "idle",
    active: false,
    error: null,
    open: [],
    start: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock("../lib/settings", () => ({
  isMasterPromptEnabled: () => false,
  loadMasterPrompt: () => "",
}));

const here = dirname(fileURLToPath(import.meta.url));

/** Glyphs the contract bans as JSX icon text in the four owned chrome files. */
const LEGACY_GLYPH = /[▤⧉⤢↻⚙×‹▸▾▴↗🔌]/u;

const CHROME_FILES = ["ViewBar.tsx", "TabBar.tsx", "StatusBar.tsx", "Sidebar.tsx"] as const;

const session: TerminalSession = {
  sessionId: "s1",
  profileId: "claude",
  profileName: "Claude",
  workerId: null,
  projectId: "p1",
  kind: "orchestrator",
  title: "Orchestrator",
  exited: false,
  exitCode: null,
};

const project: Project = {
  id: "p1",
  name: "Alpha",
  repoPath: "/tmp/alpha",
  createdAt: 1,
  githubRemote: false,
  maxWorkers: null,
  testCommand: null,
};

describe("Icon set (V161-UI-I1)", () => {
  it("exports the fourteen contract icon names", () => {
    expect([...ICON_NAMES].sort()).toEqual(
      [
        "check",
        "chevronDown",
        "chevronLeft",
        "chevronRight",
        "chevronUp",
        "close",
        "expand",
        "external",
        "gear",
        "more",
        "plug",
        "rail",
        "refresh",
        "split",
      ].sort(),
    );
  });

  it.each([...ICON_NAMES] as IconName[])(
    "renders %s as a 16-viewBox stroke SVG in currentColor",
    (name) => {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("viewBox", "0 0 16 16");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("stroke", "currentColor");
      expect(svg?.getAttribute("stroke-width") ?? svg?.getAttribute("strokeWidth")).toMatch(
        /1\.5/,
      );
    },
  );

  it("keeps ViewBar TabBar StatusBar Sidebar free of legacy icon glyphs", () => {
    for (const file of CHROME_FILES) {
      const src = readFileSync(resolve(here, file), "utf8");
      const match = src.match(LEGACY_GLYPH);
      expect(match, `${file} still contains glyph ${match?.[0] ?? "?"}`).toBeNull();
    }
  });

  it("gives every icon-only chrome control an accessible name", () => {
    render(
      <ViewBar
        goal="work"
        workSurface="dialog"
        onChange={vi.fn()}
        projectName="Alpha"
        workerCount={1}
        questionCount={0}
        questionsFleetWide={false}
        onNewWorker={vi.fn()}
        newWorkerDisabled={false}
        railOpen={false}
        onToggleRail={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Board-Leiste/ })).toBeInTheDocument();

    render(
      <TabBar
        sessions={[session]}
        activeSessionId="s1"
        splitOpen={false}
        splitEnabled
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onToggleSplit={vi.fn()}
        onNew={vi.fn()}
        newDisabled={false}
      />,
    );
    expect(screen.getByRole("button", { name: /Sitzung schließen/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Terminal teilen/ })).toBeInTheDocument();

    render(
      <StatusBar
        session={session}
        error={null}
        attentionCount={0}
        onOpenBoard={vi.fn()}
        onDismissError={vi.fn()}
        onOpenProviders={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Provider-Übersicht öffnen" })).toBeInTheDocument();

    render(
      <Sidebar
        projects={[project]}
        activeProjectId="p1"
        loading={false}
        error={null}
        onCreate={vi.fn(async () => true)}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onOpenOrchestrator={vi.fn()}
        liveOrchestratorProjectIds={[]}
        busyOrchestratorProjectId={null}
        onRefreshProjects={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Skill-Packs von Alpha bearbeiten" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Projekt Alpha entfernen" })).toBeInTheDocument();
  });
});
