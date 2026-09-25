import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TerminalSession } from "../types";
import TabBar from "./TabBar";

describe("TabBar", () => {
  it("renders orchestrators first and selects a worker tab", () => {
    const onSelect = vi.fn();
    const sessions: TerminalSession[] = [
      {
        sessionId: "worker-1",
        profileId: "codex",
        profileName: "Codex",
        workerId: "worker-1",
        projectId: "project-1",
        kind: "worker",
        title: "Build tests",
        exited: false,
        exitCode: null,
      },
      {
        sessionId: "orchestrator-1",
        profileId: "claude",
        profileName: "Claude",
        workerId: null,
        projectId: "project-1",
        kind: "orchestrator",
        title: "Orchestrator",
        exited: false,
        exitCode: null,
      },
    ];

    render(
      <TabBar
        sessions={sessions}
        activeSessionId="orchestrator-1"
        splitOpen={false}
        splitEnabled={true}
        onSelect={onSelect}
        onClose={vi.fn()}
        onToggleSplit={vi.fn()}
        onNew={vi.fn()}
        newDisabled={false}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Orchestrator", "Build tests"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.click(tabs[1]);
    expect(onSelect).toHaveBeenCalledWith("worker-1");
  });
});

describe("TabBar keyboard pattern (APP-5 / APP-9)", () => {
  const sessions: TerminalSession[] = [
    { sessionId: "orchestrator-1", profileId: "claude", profileName: "Claude", workerId: null, projectId: "p", kind: "orchestrator", title: "Orchestrator", exited: false, exitCode: null },
    { sessionId: "worker-1", profileId: "codex", profileName: "Codex", workerId: "worker-1", projectId: "p", kind: "worker", title: "Build tests", exited: false, exitCode: null },
  ];
  const props = {
    sessions,
    activeSessionId: "orchestrator-1",
    splitOpen: false,
    splitEnabled: true,
    onClose: vi.fn(),
    onToggleSplit: vi.fn(),
    onNew: vi.fn(),
    newDisabled: false,
  };

  it("the close control is not nested inside the tab and stays out of the tab order and Delete closes", () => {
    const onClose = vi.fn();
    render(<TabBar {...props} onSelect={vi.fn()} onClose={onClose} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.every((tab) => tab.tagName === "BUTTON")).toBe(true);
    const close = screen.getByRole("button", { name: "Detach Build tests" });
    expect(tabs.some((tab) => tab.contains(close))).toBe(false);
    expect(close.tabIndex).toBe(-1);
    expect(close.parentElement).toHaveAttribute("role", "presentation");
    fireEvent.keyDown(tabs[1], { key: "Delete" });
    expect(onClose).toHaveBeenCalledWith("worker-1");
  });

  it("only the active tab is a tab stop and the arrow keys walk the list", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<TabBar {...props} onSelect={onSelect} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    tabs[0].focus();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("worker-1");
    expect(document.activeElement).toBe(tabs[1]);
    // The parent owns the selection; once it follows, the tab stop moves too.
    rerender(<TabBar {...props} activeSessionId="worker-1" onSelect={onSelect} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("orchestrator-1");
  });
});
