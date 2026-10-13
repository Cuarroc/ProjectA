import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { killPty, spawnPty } from "../lib/ipc";
import type { AgentProfile, TerminalSession } from "../types";
import { initialSessionState, sessionReducer } from "./sessionReducer";

/**
 * Placeholder geometry used at spawn time. `TerminalView` measures the real
 * container on mount and immediately issues a `resize_pty`.
 */
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

export type ExitListener = (sessionId: string, code: number | null) => void;

/** Terminal-tab state and the actions on it (V2-S01d-2b). */
export interface SessionsValue {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  splitOpen: boolean;
  splitSessionId: string | null;
  splitPrimary: boolean;
  /** Exited worker whose persisted buffer is on screen. Not a live PTY. */
  restoreWorkerId: string | null;
  /** Append the tab unless known, focus it, leave the restore view; subscribes its exit. */
  openWorker: (session: TerminalSession) => void;
  /** Spawn an ad-hoc PTY, append and focus its tab; rejects when the spawn fails. */
  openAdHoc: (profile: AgentProfile) => Promise<void>;
  select: (sessionId: string) => void;
  /** Detach the tab; an ad-hoc session is killed, a worker's agent keeps running. */
  close: (sessionId: string) => void;
  drop: (sessionId: string) => void;
  toggleSplit: () => void;
  showRestore: (workerId: string) => void;
  subscribeExit: (sessionId: string) => Promise<void>;
  unsubscribeExit: (sessionId: string) => void;
  markExited: (sessionId: string, code: number | null) => void;
  /** Subscribe to session exits; returns the unsubscribe. */
  onExit: (listener: ExitListener) => () => void;
}

const SessionsContext = createContext<SessionsValue | null>(null);

/**
 * One owner for the terminal sessions (terminal.md §3): list, focus, split and
 * restore state live here, mounted above both D1 paths in `App()`, so a route
 * change never remounts them. IPC happens only here; consumers read and change
 * state through `useSessions()`. Exits are reported to `onExit` subscribers —
 * the provider never writes worker or board state itself.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const sessionsRef = useRef(state.sessions);
  sessionsRef.current = state.sessions;

  const subscribeExit = useCallback(async (_sessionId: string) => {}, []);
  const unsubscribeExit = useCallback((_sessionId: string) => {}, []);
  const markExited = useCallback((sessionId: string, code: number | null) => {
    dispatch({ type: "markExited", sessionId, code });
  }, []);
  const onExit = useCallback((_listener: ExitListener) => () => {}, []);

  const openWorker = useCallback(
    (session: TerminalSession) => {
      dispatch({ type: "openWorker", session });
      void subscribeExit(session.sessionId);
    },
    [subscribeExit],
  );

  const openAdHoc = useCallback(
    async (profile: AgentProfile) => {
      const sessionId = await spawnPty({
        profileId: profile.id,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
      });
      dispatch({
        type: "openAdHoc",
        session: {
          sessionId,
          profileId: profile.id,
          profileName: profile.name,
          workerId: null,
          projectId: null,
          kind: "worker",
          title: profile.name,
          exited: false,
          exitCode: null,
        },
      });
      await subscribeExit(sessionId);
    },
    [subscribeExit],
  );

  const select = useCallback((sessionId: string) => dispatch({ type: "select", sessionId }), []);
  const drop = useCallback((sessionId: string) => dispatch({ type: "drop", sessionId }), []);

  const close = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.sessionId === sessionId);
      dispatch({ type: "drop", sessionId });
      // Closing a worker tab only detaches: the agent keeps running and the
      // worker panel can bring it back. An ad-hoc tab owns its process.
      if (session?.workerId) return;
      unsubscribeExit(sessionId);
      void killPty(sessionId).catch(() => {
        // The process may already be gone; closing the tab is what matters.
      });
    },
    [unsubscribeExit],
  );

  const toggleSplit = useCallback(() => dispatch({ type: "toggleSplit" }), []);
  const showRestore = useCallback(
    (workerId: string) => dispatch({ type: "showRestore", workerId }),
    [],
  );

  const value = useMemo<SessionsValue>(
    () => ({
      ...state,
      openWorker,
      openAdHoc,
      select,
      close,
      drop,
      toggleSplit,
      showRestore,
      subscribeExit,
      unsubscribeExit,
      markExited,
      onExit,
    }),
    [
      state,
      openWorker,
      openAdHoc,
      select,
      close,
      drop,
      toggleSplit,
      showRestore,
      subscribeExit,
      unsubscribeExit,
      markExited,
      onExit,
    ],
  );

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

/** The session state and actions; throws outside `SessionProvider`. */
export function useSessions(): SessionsValue {
  const value = useContext(SessionsContext);
  if (value === null) throw new Error("useSessions must be used inside SessionProvider");
  return value;
}
