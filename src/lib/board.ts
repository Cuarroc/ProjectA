import type { BoardColumn, ControlledBy, WorkerKind } from "../types";

/** Left-to-right reading order of the board. */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  "working",
  "needs_you",
  "in_review",
  "ready_to_merge",
  "done",
];

/** Column headings; the wire values are snake_case, the UI is not. */
export const COLUMN_LABELS: Record<BoardColumn, string> = {
  working: "Working",
  needs_you: "Needs you",
  in_review: "In review",
  ready_to_merge: "Ready to merge",
  done: "Done",
};

const COLUMN_SET = new Set<string>(BOARD_COLUMNS);

export function isBoardColumn(value: unknown): value is BoardColumn {
  return typeof value === "string" && COLUMN_SET.has(value);
}

/**
 * One glyph per kind, so a coordinator reads the same in the banner, on a card
 * badge and on a terminal tab. An ordinary worker has none — it is the norm,
 * and marking the norm only adds noise.
 */
const KIND_ICONS: Record<WorkerKind, string> = {
  worker: "",
  orchestrator: "◆",
  queen: "♛",
  scout: "🔍",
};

export function kindIcon(kind: WorkerKind): string {
  return KIND_ICONS[kind];
}

/**
 * Coordinators live in the board banner, not on a column: they do not hold a
 * task of their own, so a card for them would only be an empty seat.
 */
const COORDINATOR_KINDS: ReadonlySet<WorkerKind> = new Set<WorkerKind>([
  "orchestrator",
  "queen",
  "scout",
]);

export function isCoordinatorKind(kind: WorkerKind): boolean {
  return COORDINATOR_KINDS.has(kind);
}

/** Badge text for a card's controller; `null` means the user started it. */
export function controllerBadge(controlledBy: ControlledBy | null): string {
  if (controlledBy === null) return "● du";
  const icon = kindIcon(controlledBy.kind);
  return icon === "" ? controlledBy.label : `${icon} ${controlledBy.label}`;
}

/** Hover text for the same badge; as much of the chain as the core told us. */
export function controllerTitle(controlledBy: ControlledBy | null): string {
  return controlledBy === null
    ? "von dir gestartet — kein Koordinator dahinter"
    : `gesteuert von ${controllerBadge(controlledBy)}`;
}

/**
 * CSS class carrying a column's state colour. One helper so the rail, the
 * board and any later view tint the same state the same way instead of each
 * picking its own yellow.
 */
export function columnStateClass(column: BoardColumn): string {
  return `state-${column.replace(/_/g, "-")}`;
}
