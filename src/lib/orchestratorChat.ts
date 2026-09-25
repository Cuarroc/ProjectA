import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, listWorkerMessages, sendToOrchestrator } from "./ipc";
import type { WorkerMessage } from "../types";

const POLL_INTERVAL_MS = 10_000;
const MESSAGE_LIMIT = 200;

export interface OrchestratorChat {
  /** The orchestrator this project is talking to, or `null` before the first send. */
  orchestratorId: string | null;
  messages: WorkerMessage[];
  /** A history read is in flight; the empty state must wait for it. */
  loading: boolean;
  sending: boolean;
  error: string | null;
  /** No project selected — every surface disables its input on this. */
  disabled: boolean;
  /** Sends a prompt; resolves `true` when it went out and the draft may clear. */
  send: (text: string) => Promise<boolean>;
  clearError: () => void;
}

/**
 * The project's conversation with its orchestrator: what has been said, and
 * the one way to say something back.
 *
 * The orchestrator id comes from two sources: `knownOrchestratorId` is the row
 * the caller (App) already sees in its worker list — it is what lets the hook
 * load the existing history on mount instead of claiming there are no
 * messages over a thread it simply never read. The send path still adopts the
 * worker that `send_to_orchestrator` hands back, because find-or-create is
 * the core's business; once a send landed, that id wins.
 *
 * It lives in `App` rather than in a view because Variant B shows the same
 * conversation in two shapes: the full surface, and the compact bar under
 * every other view. One owner means switching views does not throw away the
 * thread that is already on screen.
 */
export function useOrchestratorChat(
  projectId: string | null,
  knownOrchestratorId: string | null = null,
): OrchestratorChat {
  const [orchestratorId, setOrchestratorId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WorkerMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which project is on screen *now*. Every call below reads it after its await
   * instead of trusting the `projectId` it started with: `send_to_orchestrator`
   * does find-or-create — worktree, PTY, spawn — which takes seconds, and the
   * sidebar stays clickable the whole time.
   */
  const shownProjectId = useRef(projectId);

  /**
   * Reads the history of one worker. A failed read is reported, not swallowed:
   * freezing the thread on its last state (or on nothing) would claim the
   * conversation simply has no news. Only a project switch stays quiet — the
   * late failure belongs to a project nobody is looking at.
   */
  const loadMessages = useCallback(async (workerId: string, forProjectId: string | null) => {
    setLoading(true);
    try {
      const next = await listWorkerMessages(workerId, MESSAGE_LIMIT);
      // A switch during the call makes this history someone else's.
      if (shownProjectId.current !== forProjectId) return;
      if (!Array.isArray(next)) {
        setError("Der Verlauf kam unvollständig an.");
        return;
      }
      setMessages(next);
      setError(null);
    } catch (cause) {
      if (shownProjectId.current !== forProjectId) return;
      setError(describeError(cause));
    } finally {
      if (shownProjectId.current === forProjectId) setLoading(false);
    }
  }, []);

  // Another project means another orchestrator; nothing carries over — the
  // send that is still in flight included, hence `sending` and the ref.
  useEffect(() => {
    shownProjectId.current = projectId;
    setOrchestratorId(null);
    setMessages([]);
    setError(null);
    setSending(false);
  }, [projectId]);

  // The id the send adopted wins; before the first send, the one the caller
  // already knows about is enough to read the history with.
  const activeOrchestratorId = orchestratorId ?? knownOrchestratorId;

  // The history exists before the first message of this session: read it as
  // soon as the orchestrator is known, so the empty state below is earned.
  useEffect(() => {
    if (activeOrchestratorId === null) return;
    void loadMessages(activeOrchestratorId, projectId);
  }, [activeOrchestratorId, projectId, loadMessages]);

  useEffect(() => {
    if (activeOrchestratorId === null) return;
    const timer = window.setInterval(
      () => void loadMessages(activeOrchestratorId, projectId),
      POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [activeOrchestratorId, projectId, loadMessages]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const draft = text.trim();
      if (draft === "" || sending || projectId === null) return false;

      // The answer belongs to the project it was sent for, not to whichever
      // project the sidebar happens to show when it arrives.
      const target = projectId;
      setSending(true);
      try {
        const orchestrator = await sendToOrchestrator(target, draft);
        // Adopting a left-behind project's orchestrator here would put its
        // history under the current project's name, and the poll would hold it
        // there until the next send. The prompt did go out, so it is a `true`.
        if (shownProjectId.current !== target) return true;
        setOrchestratorId(orchestrator.id);
        setError(null);
        // The adopted id re-fires the read effect above, so the prompt shows
        // up in the history without waiting out the poll interval.
        return true;
      } catch (cause) {
        // Showing this under another project would blame the wrong one, so a
        // late failure stays quiet and only keeps the draft.
        if (shownProjectId.current !== target) return false;
        setError(describeError(cause));
        return false;
      } finally {
        // Only for the project that is still on screen: the effect above has
        // already unlocked the composer for anyone who switched, and a second
        // send may be running there by now.
        if (shownProjectId.current === target) setSending(false);
      }
    },
    [projectId, sending],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    orchestratorId: activeOrchestratorId,
    messages,
    loading,
    sending,
    error,
    disabled: projectId === null,
    send,
    clearError,
  };
}

/** Who said it, in the user's language. */
export function roleLabel(role: WorkerMessage["role"]): string {
  switch (role) {
    case "user":
      return "Du";
    case "agent":
      return "Orchestrator";
    case "system":
      return "System";
  }
}

/** Short local time; date only when it is not today. */
export function formatMessageTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const at = new Date(seconds * 1000);
  if (Number.isNaN(at.getTime())) return "";

  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();

  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const day = at.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
  return `${day} ${time}`;
}
