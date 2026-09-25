import { useCallback, useEffect, useRef, useState } from "react";

import { answerQuestion, askQuestion, describeError, enhancePrompt, listQuestions } from "./ipc";
import type { EnhanceAnswer, Question } from "../types";

/**
 * Matches {@link useQuestions}: the tab and this machine are watching the same
 * rows, and two clocks would only let them disagree about how long an answer
 * took to show up.
 */
const POLL_INTERVAL_MS = 5000;

/**
 * What the still-open questions of an abandoned round are answered with.
 *
 * A cancelled round leaves real rows behind, and nobody is waiting on them any
 * more. Leaving them open would put up to three ghost decisions in the tab —
 * and in the badge that counts them — for the four hours it takes the clock to
 * answer. Closing them records `answeredBy: "human"`, which is exactly what
 * happened: a person at this window decided to stop.
 */
const CANCEL_ANSWER = "abgebrochen — die Prompt-Schärfung wurde beendet";

/** What a surface is told when the core filed none of the questions. */
const ERR_NOT_FILED = "Die Rückfragen konnten nicht gestellt werden.";

/**
 * Best effort and deliberately unawaited: the round is over either way, and a
 * row that refuses to close is one the clock will get to.
 */
function closeAbandoned(abandoned: Question[]): void {
  for (const question of abandoned) {
    void answerQuestion(question.id, CANCEL_ANSWER).catch(() => undefined);
  }
}

/**
 * Where a round is.
 *
 * `thinking` and `finishing` are the two agent calls, minutes each; `waiting`
 * is the part that runs on human time and is the reason this is a machine
 * rather than one `await`.
 */
export type SharpenPhase = "idle" | "thinking" | "waiting" | "finishing";

export interface SharpeningState {
  phase: SharpenPhase;
  /** A round is under way — anything but `idle`. */
  active: boolean;
  /** An agent call is in flight; the surface has nothing to offer but waiting. */
  running: boolean;
  /** This round's questions that are still open, in the order they were asked. */
  open: Question[];
  error: string | null;
  clearError: () => void;
  /** Starts a round. A second call while one runs is ignored. */
  start: (draft: string, targetProfile?: string) => void;
  /** Ends the round and closes whatever it left open. */
  cancel: () => void;
  /**
   * Answers one of this round's questions from the surface that asked. The
   * same row is answerable in the Fragen tab; whichever closes it first wins,
   * and the poll below picks the other one up.
   */
  answer: (id: string, text: string) => Promise<void>;
}

/**
 * „Prompt schärfen“ as a conversation (Phase 21 P1).
 *
 * One round is: ask the enhancer; if it wrote a prompt, hand it to
 * `onSharpened` and stop — that is the one-shot behaviour every surface had
 * before. If it asked back instead, file its questions as ordinary preflight
 * [`Question`] rows (no worker, `scope: "preflight"`), wait for a person to
 * answer them in the Fragen tab or on the surface itself, and run a second and
 * final call with the task **plus** the answers.
 *
 * The questions are the core's, not this hook's: the same rows, the same four
 * hours, the same tab. That is what makes leaving the surface survivable — and
 * what makes an answer typed into the tab land here without any event of its
 * own.
 *
 * Nothing here starts a worker. `onSharpened` receives the final prompt and the
 * surface decides what to do with it, which is why the same machine serves the
 * new-worker dialog, the queue and the orchestrator composer.
 */
export function useSharpening(
  projectId: string | null,
  onSharpened: (prompt: string) => void,
): SharpeningState {
  const [phase, setPhase] = useState<SharpenPhase>("idle");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which round is current. Every await checks it before it writes anything:
   * a cancel, a project switch or an unmount bumps it, and the run that was in
   * flight walks away instead of dropping a prompt into a surface that has
   * moved on.
   */
  const round = useRef(0);
  /** The task as it was when the round started; round two must not drift. */
  const draftRef = useRef("");
  const targetRef = useRef<string | undefined>(undefined);
  const questionsRef = useRef<Question[]>([]);
  // Read inside the poll, which must not restart every time the surface hands
  // in a new closure.
  const onSharpenedRef = useRef(onSharpened);
  onSharpenedRef.current = onSharpened;

  const setOpen = useCallback((next: Question[]) => {
    questionsRef.current = next;
    setQuestions(next);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const stop = useCallback(() => {
    round.current += 1;
    setOpen([]);
    setPhase("idle");
  }, [setOpen]);

  // A round belongs to one project. Switching projects abandons it rather than
  // filing its answers under the wrong repository — and an abandoned round
  // closes the rows it already filed, or they would wait four hours in the
  // old project's tab as ghost decisions.
  useEffect(() => {
    round.current += 1;
    closeAbandoned(questionsRef.current);
    questionsRef.current = [];
    setQuestions([]);
    setPhase("idle");
    setError(null);
  }, [projectId]);

  // Unmounting the surface is the same abandonment as a switch: the round's
  // open rows are closed, and the in-flight run is bumped so its late answer
  // writes nowhere.
  useEffect(() => {
    return () => {
      round.current += 1;
      closeAbandoned(questionsRef.current);
      questionsRef.current = [];
    };
  }, []);

  /** The second and last call: the task, plus what the person decided. */
  const finish = useCallback(
    async (mine: number, answers: EnhanceAnswer[]) => {
      setPhase("finishing");
      setOpen([]);
      try {
        const final = await enhancePrompt({
          draft: draftRef.current,
          targetProfile: targetRef.current,
          answers,
        });
        if (round.current !== mine) return;
        // The core forbids questions in this round, so `enhanced` is the only
        // shape left; anything else already came back as an error.
        if (final.enhanced === null) throw new Error(ERR_NOT_FILED);
        setPhase("idle");
        onSharpenedRef.current(final.enhanced);
      } catch (cause) {
        if (round.current !== mine) return;
        setError(describeError(cause));
        setPhase("idle");
      }
    },
    [setOpen],
  );

  /**
   * Reconcile this round's rows with the core.
   *
   * Closed is closed, however it happened: an answer from the tab, an answer
   * from the surface, and the clock's own `abgelaufen — entscheide selbst`
   * all carry an answer text, and all three are things the final prompt should
   * be built on. Waiting for a "real" answer that will never come would leave
   * the round hanging for good.
   */
  const pump = useCallback(async () => {
    const mine = round.current;
    if (projectId === null || questionsRef.current.length === 0) return;
    let rows: Question[];
    try {
      rows = await listQuestions({ projectId });
    } catch (cause) {
      if (round.current === mine) setError(describeError(cause));
      return;
    }
    if (round.current !== mine) return;

    const byId = new Map(rows.map((row) => [row.id, row]));
    const current = questionsRef.current.map((asked) => byId.get(asked.id) ?? asked);
    const stillOpen = current.filter((row) => row.status === "open");
    if (stillOpen.length > 0) {
      setOpen(stillOpen);
      return;
    }
    void finish(
      mine,
      current.map((row) => ({
        question: row.question,
        answer: row.answer ?? "",
      })),
    );
  }, [finish, projectId, setOpen]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const timer = window.setInterval(() => void pump(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [phase, pump]);

  const start = useCallback(
    (draft: string, targetProfile?: string) => {
      const text = draft.trim();
      if (text === "" || phase !== "idle" || projectId === null) return;
      const mine = ++round.current;
      draftRef.current = text;
      targetRef.current = targetProfile;
      setError(null);
      setOpen([]);
      setPhase("thinking");
      void (async () => {
        // Held out here so a failure halfway through can close what it already
        // filed. Three questions of which two reached the tab is a round
        // nobody can finish, and leaving those two open would put a decision
        // in front of the user that leads nowhere.
        const asked: Question[] = [];
        try {
          const first = await enhancePrompt({ draft: text, targetProfile });
          if (round.current !== mine) return;
          if (first.enhanced !== null) {
            setPhase("idle");
            onSharpenedRef.current(first.enhanced);
            return;
          }
          // Sequentially, so the tab lists them in the order they were asked.
          for (const question of first.questions) {
            const row = await askQuestion({
              projectId,
              question: question.question,
              options: question.options ?? undefined,
            });
            if (round.current !== mine) return;
            // A preflight question is never refused - the budget rule counts
            // worker questions only - but a row that came back unreadable is
            // one this round cannot wait for.
            if (row !== null && row.status === "open") asked.push(row);
          }
          if (asked.length === 0) throw new Error(ERR_NOT_FILED);
          setOpen(asked);
          setPhase("waiting");
        } catch (cause) {
          closeAbandoned(asked);
          if (round.current !== mine) return;
          setError(describeError(cause));
          setPhase("idle");
        }
      })();
    },
    [phase, projectId, setOpen],
  );

  const cancel = useCallback(() => {
    const abandoned = questionsRef.current;
    stop();
    closeAbandoned(abandoned);
  }, [stop]);

  const answer = useCallback(
    async (id: string, text: string) => {
      await answerQuestion(id, text);
      // Straight back to the core rather than waiting out the interval: the
      // last answer of a round starts the final call, and that should happen
      // on the click.
      await pump();
    },
    [pump],
  );

  return {
    phase,
    active: phase !== "idle",
    running: phase === "thinking" || phase === "finishing",
    open: questions,
    error,
    clearError,
    start,
    cancel,
    answer,
  };
}
