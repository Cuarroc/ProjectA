import type { TerminalSession } from "../types";

/**
 * Pure state of the terminal tabs (V2-S01d-1): no React, no IPC, no consumer
 * yet. Rules are ported from App.tsx (S01d-1).
 *
 * `activeSessionId` is always the focused session and `splitSessionId` the other
 * column's; `splitPrimary` records which side the focused one sits on, so moving
 * focus never makes the two columns swap what they show.
 */
export interface SessionState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  splitOpen: boolean;
  splitSessionId: string | null;
  splitPrimary: boolean;
  /** Exited worker whose persisted buffer is on screen. Not a live PTY. */
  restoreWorkerId: string | null;
}

export type SessionAction =
  | { type: "openWorker"; session: TerminalSession }
  | { type: "openAdHoc"; session: TerminalSession }
  | { type: "select"; sessionId: string }
  | { type: "drop"; sessionId: string }
  | { type: "toggleSplit" }
  | { type: "showRestore"; workerId: string }
  | { type: "markExited"; sessionId: string; code: number | null };

export const initialSessionState: SessionState = {
  sessions: [],
  activeSessionId: null,
  splitOpen: false,
  splitSessionId: null,
  splitPrimary: true,
  restoreWorkerId: null,
};

const SPLIT_CLOSED = { splitOpen: false, splitSessionId: null, splitPrimary: true } as const;

/**
 * Focus a session. While the split is open the pick lands in the focused
 * column, unless it is already the other column's session: then focus simply
 * moves there rather than showing it twice. Ported from App.tsx
 * handleSelectSession (S01d-1); unknown ids are ignored.
 */
function focus(state: SessionState, sessionId: string): SessionState {
  if (!state.sessions.some((session) => session.sessionId === sessionId)) return state;
  if (sessionId === state.splitSessionId) {
    return {
      ...state,
      splitSessionId: state.activeSessionId,
      activeSessionId: sessionId,
      splitPrimary: !state.splitPrimary,
    };
  }
  return { ...state, activeSessionId: sessionId };
}

/**
 * Drop the tab; the process behind it is somebody else's business. Ported from
 * App.tsx dropTab (S01d-1). Either column losing its session collapses the
 * split: one session cannot fill two columns, and two terminals on one PTY
 * would fight over its size. Unlike the original, the neighbour that takes the
 * focus is never the split's own session (it would sit in both columns).
 */
function drop(state: SessionState, sessionId: string): SessionState {
  const index = state.sessions.findIndex((session) => session.sessionId === sessionId);
  if (index === -1) return state;
  const remaining = state.sessions.filter((session) => session.sessionId !== sessionId);
  const collapse = state.splitSessionId === sessionId || remaining.length < 2;
  const splitId = collapse ? null : state.splitSessionId;
  let activeSessionId = state.activeSessionId;
  if (activeSessionId === sessionId) {
    const neighbour = [remaining[index], remaining[index - 1], ...remaining].find(
      (session) => session !== undefined && session.sessionId !== splitId,
    );
    activeSessionId = neighbour ? neighbour.sessionId : null;
  }
  return { ...state, ...(collapse ? SPLIT_CLOSED : {}), sessions: remaining, activeSessionId };
}

/**
 * Ported from App.tsx tab bar `onToggleSplit` (S01d-1). The second column opens
 * on the neighbouring tab, the one the user was most likely looking at before.
 * Without a focused session or a second tab there is nothing to split.
 */
function toggleSplit(state: SessionState): SessionState {
  if (state.splitOpen) return { ...state, ...SPLIT_CLOSED };
  const { sessions, activeSessionId } = state;
  const index = sessions.findIndex((session) => session.sessionId === activeSessionId);
  if (index === -1) return state;
  const other = sessions[index + 1] ?? sessions[index - 1];
  if (!other) return state;
  return { ...state, splitOpen: true, splitSessionId: other.sessionId, splitPrimary: true };
}

/** Append the tab unless its session is already known. */
function add(state: SessionState, session: TerminalSession): SessionState {
  if (state.sessions.some((entry) => entry.sessionId === session.sessionId)) return state;
  return { ...state, sessions: [...state.sessions, session] };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    // Ported from App.tsx openWorkerTab, state part (S01d-1): append when new,
    // focus, leave the restore view. An ad-hoc spawn leaves the restore view.
    case "openWorker":
      return { ...focus(add(state, action.session), action.session.sessionId), restoreWorkerId: null };
    case "openAdHoc":
      return focus(add(state, action.session), action.session.sessionId);
    case "select":
      return focus(state, action.sessionId);
    case "drop":
      return drop(state, action.sessionId);
    case "toggleSplit":
      return toggleSplit(state);
    case "showRestore":
      return { ...state, restoreWorkerId: action.workerId };
    case "markExited": {
      // Only the tab: workers and the board belong to somebody else.
      if (!state.sessions.some((session) => session.sessionId === action.sessionId)) return state;
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.sessionId === action.sessionId
            ? { ...session, exited: true, exitCode: action.code }
            : session,
        ),
      };
    }
  }
}
