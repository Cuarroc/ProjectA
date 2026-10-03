import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProfilePicker from "./ProfilePicker";
import TabBar from "./TabBar";
import ViewBar from "./ViewBar";

describe("German UI wording", () => {
  it("labels the TabBar in German", () => {
    render(
      <TabBar
        sessions={[]}
        activeSessionId={null}
        splitOpen={false}
        splitEnabled={true}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onToggleSplit={vi.fn()}
        onNew={vi.fn()}
        newDisabled={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Neue Sitzung" })).toBeInTheDocument();
  });

  it("labels the ViewBar action in German", () => {
    render(
      <ViewBar
        goal="work"
        workSurface="dialog"
        onChange={vi.fn()}
        questionCount={0}
        questionsFleetWide={false}
        onNewWorker={vi.fn()}
        newWorkerDisabled={false}
        railOpen={false}
        onToggleRail={vi.fn()}
        projectName={null}
        workerCount={0}
      />,
    );
    expect(screen.getByRole("button", { name: "Neuer Worker" })).toBeInTheDocument();
    expect(screen.getByText("Kein Projekt")).toBeInTheDocument();
  });

  it("labels the worker count in German", () => {
    render(
      <ViewBar
        goal="work"
        workSurface="dialog"
        onChange={vi.fn()}
        questionCount={0}
        questionsFleetWide={false}
        onNewWorker={vi.fn()}
        newWorkerDisabled={false}
        railOpen={false}
        onToggleRail={vi.fn()}
        projectName="Project A"
        workerCount={2}
      />,
    );
    expect(screen.getByText("2 Worker")).toBeInTheDocument();
  });

  it("words the ProfilePicker in German", () => {
    render(
      <ProfilePicker
        profiles={[]}
        loading={false}
        error={null}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Agent-Profil wählen" })).toBeInTheDocument();
    expect(screen.getByText("Neue Sitzung")).toBeInTheDocument();
    expect(screen.getByText("Keine Agent-Profile eingerichtet.")).toBeInTheDocument();
  });
});
