import { useEffect, useRef } from "react";

import { APP_GOALS, GOAL_LABELS, GOAL_TITLES, type AppGoal } from "../lib/goals";
import { handleTablistKey, tabStop } from "../lib/tabs";

interface ViewBarProps {
  goal: AppGoal;
  onChange: (goal: AppGoal) => void;
  /** Dialog vs full board inside Work. The rail hides only for the latter. */
  workSurface: "dialog" | "board";
  /** Active project, or `null` when none is selected. */
  projectName: string | null;
  workerCount: number;
  /**
   * Open questions, in whatever scope the Attention view is set to. Shown on
   * the segment, because a blocking decision is the one thing in this app that
   * is waiting on the person looking at it.
   */
  questionCount: number;
  /** Whether that count covers every project — it changes what the badge claims. */
  questionsFleetWide: boolean;
  onNewWorker: () => void;
  newWorkerDisabled: boolean;
  /** Whether the board rail is open; the board view hides it either way. */
  railOpen: boolean;
  onToggleRail: () => void;
}

/** Header of the main area: which project, which goal, and one way in. */
export default function ViewBar({
  goal,
  onChange,
  workSurface,
  projectName,
  workerCount,
  questionCount,
  questionsFleetWide,
  onNewWorker,
  newWorkerDisabled,
  railOpen,
  onToggleRail,
}: ViewBarProps) {
  // The full board is the rail writ large, so the two never share a screen —
  // and a toggle that visibly does nothing is worse than one that says why.
  const railBlocked = goal === "work" && workSurface === "board";
  const railTitle = railBlocked
    ? "Das Board ist hier ganz offen — die Leiste gehört zu den anderen Sichten"
    : railOpen
      ? "Board-Leiste einklappen"
      : "Board-Leiste zeigen";

  // The count arrives with the project switch but belongs to the project that
  // was loaded before it. Until the parent re-renders with the new project's
  // freshly loaded workers, showing it would relabel the old project's count
  // under the new name — so it stays hidden for exactly that render.
  const countedProject = useRef(projectName);
  useEffect(() => {
    countedProject.current = projectName;
  }, [projectName]);
  const countStale = projectName !== null && countedProject.current !== projectName;

  return (
    <header className="viewbar">
      <button
        type="button"
        className={`viewbar-rail-toggle${
          railOpen && !railBlocked ? " viewbar-rail-toggle-on" : ""
        }`}
        onClick={onToggleRail}
        disabled={railBlocked}
        aria-pressed={railOpen}
        title={railTitle}
        aria-label={railTitle}
      >
        ▤
      </button>
      <span className="viewbar-project" title={projectName ?? undefined}>
        {projectName ?? "No project"}
      </span>
      {projectName && !countStale ? (
        <span className="viewbar-count">
          {workerCount} worker{workerCount === 1 ? "" : "s"}
        </span>
      ) : null}
      <span className="viewbar-spacer" />
      <div
        className="segmented"
        role="tablist"
        aria-label="Hauptziele"
        onKeyDown={(event) =>
          handleTablistKey(event, APP_GOALS.indexOf(goal), APP_GOALS.length, (index) =>
            onChange(APP_GOALS[index]),
          )
        }
      >
        {APP_GOALS.map((id, index) => (
          <button
            key={id}
            id={`goal-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={goal === id}
            aria-controls={goal === id ? "goal-panel" : undefined}
            tabIndex={tabStop(goal === id, index, APP_GOALS.includes(goal))}
            title={GOAL_TITLES[id]}
            className={`segment${goal === id ? " segment-active" : ""}`}
            onClick={() => onChange(id)}
          >
            {GOAL_LABELS[id]}
            {id === "attention" && questionCount > 0 ? (
              <span
                className="segment-badge"
                title={`${questionCount} offene ${
                  questionCount === 1 ? "Frage" : "Fragen"
                } — ${questionsFleetWide ? "in allen Projekten" : "in diesem Projekt"}`}
              >
                {questionCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="viewbar-action"
        title={
          newWorkerDisabled
            ? projectName === null
              ? "Select a project first"
              : "Worker category is off"
            : "New worker"
        }
        disabled={newWorkerDisabled}
        onClick={onNewWorker}
      >
        New worker
      </button>
    </header>
  );
}
