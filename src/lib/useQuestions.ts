import { useCallback, useEffect, useRef, useState } from "react";

import { answerQuestion, describeError, listQuestions } from "./ipc";
import type { Question } from "../types";

/**
 * There is no `question:*` event, and there does not need to be one: what this
 * polls for is a decision a person has to make, which arrives on human time,
 * not in milliseconds. The interval matches the board's fallback so the two
 * surfaces that both say "something is waiting" cannot drift apart visibly.
 */
const POLL_INTERVAL_MS = 5000;

/**
 * How much of the history the tab keeps. `list_questions` has no limit of its
 * own, so a long-running project would otherwise grow this list without end;
 * fifty is far more than anyone scrolls back through, and the whole record
 * stays readable with `pa questions list`.
 */
const HISTORY_LIMIT = 50;

/**
 * Which questions the tab — and therefore the two counters that quote it —
 * are about. `"all"` is the fleet-wide read `list_questions` already does when
 * no project id is passed, the same one `pa questions list` uses.
 */
export type QuestionsScope = "project" | "all";

export interface QuestionsState {
  /** Waiting for a decision, oldest first — the order they should be worked. */
  open: Question[];
  /** Everything already closed, newest first, capped at {@link HISTORY_LIMIT}. */
  history: Question[];
  /** Only true for the first fetch of a project — polls stay silent. */
  loading: boolean;
  error: string | null;
  /**
   * One project or the whole fleet. It lives here rather than in the view
   * because the segment badge and the rail counter read `open.length` from the
   * same state: whatever the list shows, those two numbers show as well.
   */
  scope: QuestionsScope;
  setScope: (scope: QuestionsScope) => void;
  refresh: () => void;
  /**
   * Answers one question and folds the closed row straight back in, so the
   * card leaves the list on the click rather than on the next poll. Throws
   * what the core said when it refuses, for the card to show.
   */
  answer: (id: string, text: string) => Promise<void>;
}

/**
 * Blocking decisions: the open ones and the record behind them — for the
 * active project, or fleet-wide when {@link QuestionsState.scope} says so.
 *
 * Once enabled, polls from every view because the count is shown in both the
 * Fragen segment and the board rail. Bootstrap keeps it off until the active
 * project is known, so a stale persisted id cannot start a read for a project
 * that no longer exists.
 */
export function useQuestions(projectId: string | null, enabled: boolean): QuestionsState {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<QuestionsScope>("project");

  // Guards against a slow response for a project the user already left.
  const token = useRef(0);

  const load = useCallback(
    async (showSpinner: boolean) => {
      const mine = ++token.current;
      // The fleet read needs no project; the project read has nothing to ask
      // about without one.
      if (scope === "project" && !projectId) {
        setQuestions([]);
        setError(null);
        setLoading(false);
        return;
      }
      if (showSpinner) setLoading(true);
      try {
        const next = await listQuestions(
          scope === "all" || !projectId ? undefined : { projectId },
        );
        if (token.current !== mine) return;
        setQuestions(next);
        setError(null);
      } catch (cause) {
        if (token.current === mine) setError(describeError(cause));
      } finally {
        // No `showSpinner` here: a run that is overtaken leaves through the
        // early return above without clearing anything, so the last run
        // standing has to clear it whether it raised it or not.
        if (token.current === mine) setLoading(false);
      }
    },
    [projectId, scope],
  );

  const refresh = useCallback(() => {
    void load(false);
  }, [load]);

  const answer = useCallback(
    async (id: string, text: string) => {
      const closed = await answerQuestion(id, text);
      if (closed === null) {
        void load(false);
        return;
      }
      // The row comes back closed and complete; replacing it in place moves
      // the card into the history at once. A poll that lands mid-flight can
      // only bring the same row, so there is nothing to race here.
      setQuestions((prev) =>
        prev.map((entry) => (entry.id === closed.id ? closed : entry)),
      );
    },
    [load],
  );

  useEffect(() => {
    if (!enabled) return;
    void load(true);
    if (scope === "project" && !projectId) return;
    const timer = window.setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, load, projectId, scope]);

  const open = questions.filter((entry) => entry.status === "open");
  const history = questions
    .filter((entry) => entry.status !== "open")
    .reverse()
    .slice(0, HISTORY_LIMIT);

  return { open, history, loading, error, scope, setScope, refresh, answer };
}
