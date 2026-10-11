import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { onPtyExit } from "../lib/ipc";
import type { TerminalSession } from "../types";

/** Exit listeners outlive detached tabs; output listeners stay in TerminalView. */
export function useSessionSubscriptions(
  setSessions: Dispatch<SetStateAction<TerminalSession[]>>,
  onSessionExit: (sessionId: string, code: number | null) => void,
) {
  const latest = useRef({ setSessions, onSessionExit });
  latest.current = { setSessions, onSessionExit };
  const listeners = useRef(new Map<string, () => void>());
  const mounted = useRef(true);
  const markExited = useCallback((sessionId: string, code: number | null) => {
    latest.current.setSessions((sessions) => sessions.map((session) =>
      session.sessionId === sessionId ? { ...session, exited: true, exitCode: code } : session,
    ));
    latest.current.onSessionExit(sessionId, code);
  }, []);

  const subscribeExit = useCallback(async (sessionId: string) => {
    if (!mounted.current || listeners.current.has(sessionId)) return;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      listeners.current.delete(sessionId);
      unlisten?.();
    };
    // Reserve before awaiting: duplicates, early exits and unmount all see it.
    listeners.current.set(sessionId, stop);
    try {
      const dispose = await onPtyExit(sessionId, (payload) => {
        if (stopped) return;
        stop();
        markExited(sessionId, payload.code);
      });
      if (stopped) dispose();
      else unlisten = dispose;
    } catch (error) {
      stop();
      throw error;
    }
  }, [markExited]);

  const unsubscribeExit = useCallback((sessionId: string) => {
    listeners.current.get(sessionId)?.();
  }, []);

  useEffect(() => {
    mounted.current = true;
    const registry = listeners.current;
    return () => {
      mounted.current = false;
      for (const stop of registry.values()) stop();
    };
  }, []);

  return { subscribeExit, unsubscribeExit, markExited };
}
