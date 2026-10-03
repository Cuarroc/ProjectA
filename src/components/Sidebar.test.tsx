import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Project } from "../types";
import Sidebar from "./Sidebar";

vi.mock("../lib/useSharpening", () => ({
  useSharpening: () => ({
    phase: "thinking",
    active: true,
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

const project: Project = {
  id: "project-a",
  name: "Project A",
  repoPath: "/tmp/project-a",
  createdAt: 1,
  githubRemote: false,
  maxWorkers: null,
  testCommand: null,
};

describe("Sidebar", () => {
  it("F-7 does not discard an active sharpening round through Starten", () => {
    const onOpenOrchestrator = vi.fn();
    render(
      <Sidebar
        projects={[project]}
        activeProjectId="project-a"
        loading={false}
        error={null}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onOpenOrchestrator={onOpenOrchestrator}
        liveOrchestratorProjectIds={[]}
        busyOrchestratorProjectId={null}
        onRefreshProjects={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: /Orchestrator/i }));
    const start = screen.getByRole("button", { name: "Starten" });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(onOpenOrchestrator).not.toHaveBeenCalled();
  });

  it("creates a project from trimmed form values and closes the form", async () => {
    const onCreate = vi.fn(async () => true);
    render(
      <Sidebar
        projects={[]}
        activeProjectId={null}
        loading={false}
        error={null}
        onCreate={onCreate}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onOpenOrchestrator={vi.fn()}
        liveOrchestratorProjectIds={[]}
        busyOrchestratorProjectId={null}
        onRefreshProjects={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Projekt hinzufügen" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Demo  " } });
    fireEvent.change(screen.getByLabelText("Repo-Pfad"), {
      target: { value: "  /repos/demo  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Projekt hinzufügen" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Demo", "/repos/demo"));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("requires confirmation before removing a project", () => {
    const onRemove = vi.fn();
    render(
      <Sidebar
        projects={[project]}
        activeProjectId="project-a"
        loading={false}
        error={null}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onRemove={onRemove}
        onOpenOrchestrator={vi.fn()}
        liveOrchestratorProjectIds={[]}
        busyOrchestratorProjectId={null}
        onRefreshProjects={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Project A" }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    expect(onRemove).toHaveBeenCalledWith("project-a");
  });
});

describe("Sidebar accessibility (ui-ux-pro-max audit)", () => {
  const base = {
    projects: [project],
    activeProjectId: "project-a",
    loading: false,
    error: null,
    onCreate: vi.fn(),
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onOpenOrchestrator: vi.fn(),
    liveOrchestratorProjectIds: [],
    busyOrchestratorProjectId: null,
    onRefreshProjects: vi.fn(),
  };

  it("APP-4 / APP-6: the add-project control and its fields carry real names", () => {
    render(<Sidebar {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Projekt hinzufügen" }));
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Repo-Pfad")).toBeInTheDocument();
  });

  it("APP-19: the sidebar landmark is distinguishable from the board rail", () => {
    render(<Sidebar {...base} />);
    expect(screen.getByRole("complementary", { name: "Projekte und Panels" })).toBeInTheDocument();
  });

  it("APP-12 a load error is announced and not just painted", () => {
    render(<Sidebar {...base} error="Projektliste nicht erreichbar" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Projektliste nicht erreichbar");
  });
});

describe("Sidebar heading outline (APP-15)", () => {
  it("the brand is the page's h1 and the section title an h2", () => {
    render(
      <Sidebar
        projects={[project]}
        activeProjectId="project-a"
        loading={false}
        error={null}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onOpenOrchestrator={vi.fn()}
        liveOrchestratorProjectIds={[]}
        busyOrchestratorProjectId={null}
        onRefreshProjects={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "ProjectA" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Projekte" })).toBeInTheDocument();
  });
});
