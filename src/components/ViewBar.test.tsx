import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ViewBar from "./ViewBar";
import { APP_GOALS, GOAL_LABELS, RETIRED_NAV_LABELS } from "../lib/goals";

const props = {
  goal: "work" as const,
  workSurface: "dialog" as const,
  onChange: vi.fn(),
  questionCount: 0,
  questionsFleetWide: false,
  onNewWorker: vi.fn(),
  newWorkerDisabled: false,
  railOpen: false,
  onToggleRail: vi.fn(),
};

describe("ViewBar", () => {
  it("C-5 does not relabel the previous project's worker count after a project switch", () => {
    const { rerender } = render(<ViewBar {...props} projectName="Project A" workerCount={7} />);
    rerender(<ViewBar {...props} projectName="Project B" workerCount={7} />);

    expect(screen.getByText("Project B")).toBeInTheDocument();
    expect(screen.queryByText("7 workers")).not.toBeInTheDocument();
  });

  it("offers exactly the six Rev-9 goals and none of the retired labels", () => {
    render(<ViewBar {...props} projectName="Alpha" workerCount={1} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.replace(/\d+$/, "").trim())).toEqual(
      APP_GOALS.map((id) => GOAL_LABELS[id]),
    );
    for (const retired of RETIRED_NAV_LABELS) {
      expect(screen.queryByRole("tab", { name: retired })).not.toBeInTheDocument();
    }
  });

  it("keeps the attention badge on Attention, not on a retired Fragen tab", () => {
    render(
      <ViewBar
        {...props}
        projectName="Alpha"
        workerCount={1}
        questionCount={3}
        questionsFleetWide
      />,
    );
    const attention = screen.getByRole("tab", { name: /Attention/ });
    expect(attention).toHaveTextContent("3");
    fireEvent.click(attention);
    expect(props.onChange).toHaveBeenCalledWith("attention");
  });

  it("blocks the board rail only while Work shows the full board", () => {
    const { rerender } = render(
      <ViewBar {...props} projectName="Alpha" workerCount={1} workSurface="dialog" railOpen />,
    );
    expect(screen.getByRole("button", { name: /Board-Leiste/ })).not.toBeDisabled();
    rerender(
      <ViewBar
        {...props}
        projectName="Alpha"
        workerCount={1}
        goal="work"
        workSurface="board"
        railOpen
      />,
    );
    expect(
      screen.getByRole("button", { name: /Das Board ist hier ganz offen/ }),
    ).toBeDisabled();
  });
});

describe("ViewBar keyboard pattern (APP-5)", () => {
  it("one tab stop and arrow keys move the goal and the focus and Home and End jump", () => {
    const onChange = vi.fn();
    render(<ViewBar {...props} goal="work" onChange={onChange} projectName="Alpha" workerCount={1} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    const tablist = screen.getByRole("tablist", { name: "Hauptziele" });
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(APP_GOALS[APP_GOALS.indexOf("work") + 1]);
    expect(document.activeElement).toBe(tabs[APP_GOALS.indexOf("work") + 1]);
    fireEvent.keyDown(tablist, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(APP_GOALS[APP_GOALS.length - 1]);
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(APP_GOALS[0]);
  });
});

describe("ViewBar tab/panel linkage (review A-6, sharpened in round 2 finding A-3)", () => {
  it("every goal tab has an id and points at the goal panel", () => {
    render(<ViewBar {...props} goal="work" projectName="Alpha" workerCount={1} />);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.id).toMatch(/^goal-tab-/);
    }
    // Round 2 (finding A-3): only the ACTIVE tab carries aria-controls —
    // App.tsx renders id="goal-panel" only in the active branch.
    expect(screen.getByRole("tab", { selected: true })).toHaveAttribute(
      "aria-controls",
      "goal-panel",
    );
  });

  it("the active tab points at the goal panel, inactive tabs carry no dangling aria-controls", () => {
    render(<ViewBar {...props} goal="work" projectName="Alpha" workerCount={1} />);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.id).toMatch(/^goal-tab-/);
      if (tab.id === "goal-tab-work") {
        expect(tab).toHaveAttribute("aria-controls", "goal-panel");
      } else {
        // App.tsx renders only the active branch with id="goal-panel"; an
        // aria-controls on an inactive tab would point into the void.
        expect(tab).not.toHaveAttribute("aria-controls");
      }
    }
  });
});
