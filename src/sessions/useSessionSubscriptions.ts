import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { TerminalSession } from "../types";

export function useSessionSubscriptions(
  _setSessions: Dispatch<SetStateAction<TerminalSession[]>>,
  _onSessionExit: (sessionId: string, code: number | null) => void,
) {
  return {
    subscribeExit: useCallback(async (_sessionId: string) => {}, []),
    unsubscribeExit: useCallback(async (_sessionId: string) => {}, []),
    markExited: useCallback((_sessionId: string, _code: number | null) => {}, []),
  };
}
