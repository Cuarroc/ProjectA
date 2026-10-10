import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  buildInbox,
  cardsToSources,
  recommendationsToSources,
  restoreToSources,
  type AttentionSource,
  type InboxEntry,
} from "../lib/attentionInbox";
import { applyNotifyPlan, planNotifications, webviewNotifySink } from "../lib/attentionNotify";
import { describeError, listRecommendations } from "../lib/ipc";
import type { BoardCard, Recommendation, Worker } from "../types";

interface AttentionInboxProps {
  cards: BoardCard[];
  /** Exited workers whose persisted buffer is waiting — same list, no second channel. */
  workers?: readonly Worker[];
  /** Active project — recommendations of this project join the same list. */
  projectId: string | null;
  /**
   * F4 readiness blockers, already evaluated. Empty until a caller has them.
   * They must not be invented here.
   */
  blockers?: readonly AttentionSource[];
  /** Loading failures stay visible instead of silently hiding merge blockers. */
  blockersError?: string | null;
  onOpen: (entry: InboxEntry) => void;
}

const POLL_MS = 15_000;

const GRADE_LABEL: Record<InboxEntry["grade"], string> = {
  blocking: "Blockade",
  attention: "Attention",
  info: "Hinweis",
};

const GOAL_LABEL: Record<InboxEntry["goal"], string> = {
  work: "Work",
  agents: "Agents",
  review: "Review",
};

/** German label for a wire code; the raw code stays in `title` (UM-25). */
const CODE_LABEL: Record<string, string> = {
  quota_blocked: "Kontingent blockiert",
  decision_pending: "Entscheidung offen",
  approval_required: "Freigabe nötig",
  tests_stale: "Tests veraltet",
  conflicting: "Merge-Konflikt",
  session_ended: "Sitzung beendet",
  review_pending: "Prüfung offen",
  changes_requested: "Änderungen verlangt",
};

function labelForCode(code: string): string {
  return CODE_LABEL[code] ?? code.split("_").join(" ");
}

/**
 * One inbox for questions, errors, recommendations and merge blockers.
 * Dismiss is not offered: hiding a row would look like the blocker was gone.
 */
export default function AttentionInbox({
  cards,
  workers = [],
  projectId,
  blockers = [],
  blockersError = null,
  onOpen,
}: AttentionInboxProps) {
  const [recos, setRecos] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recosSettled, setRecosSettled] = useState(projectId === null);
  const [activeIndex, setActiveIndex] = useState(0);
  const prevInbox = useRef<InboxEntry[]>([]);
  const sink = useMemo(() => webviewNotifySink(), []);

  // Every request takes a token and only the newest may write: an older poll
  // for the same project must not overwrite a newer reply, and nothing may
  // write after unmount. Same pattern as ActivityView.
  const tokenRef = useRef(0);

  const refreshRecos = useCallback(async () => {
    const mine = ++tokenRef.current;
    if (projectId === null) {
      setRecos([]);
      setRecosSettled(true);
      return;
    }
    try {
      const next = await listRecommendations(projectId);
      if (tokenRef.current !== mine) return;
      setRecos(next);
      setError(null);
      setRecosSettled(true);
    } catch (cause) {
      if (tokenRef.current !== mine) return;
      setError(describeError(cause));
      setRecosSettled(true);
    }
  }, [projectId]);

  useEffect(() => {
    setRecos([]);
    setError(null);
    setRecosSettled(projectId === null);
    void refreshRecos();
    if (projectId === null) return;
    const timer = window.setInterval(() => void refreshRecos(), POLL_MS);
    return () => {
      window.clearInterval(timer);
      tokenRef.current += 1;
    };
  }, [projectId, refreshRecos]);

  const entries = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return buildInbox([
      ...cardsToSources(cards, now),
      ...restoreToSources(workers, now),
      ...recommendationsToSources(recos),
      ...blockers,
    ]);
  }, [blockers, cards, recos, workers]);

  useEffect(() => {
    const plan = planNotifications(prevInbox.current, entries, { now: new Date() });
    applyNotifyPlan(plan, sink);
    prevInbox.current = entries;
  }, [entries, sink]);

  useEffect(() => {
    if (activeIndex >= entries.length) setActiveIndex(0);
  }, [activeIndex, entries.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (entries.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % entries.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + entries.length) % entries.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(entries.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const entry = entries[activeIndex];
      if (entry) onOpen(entry);
    }
  };

  // The listbox is the focus target: aria-activedescendant only works on the
  // element that carries the role, and an <li> between listbox and option
  // would break the required parent/child pairing (APP-8).
  const activeId = entries[activeIndex] ? `attention-${entries[activeIndex].key}` : undefined;

  return (
    <section className="attention-inbox" aria-label="Für dich">
      <div className="view-head">
        <h2 className="section-title">Für dich</h2>
        {entries.length > 0 ? (
          <span className="state-chip state-needs-you" aria-label={`${entries.length} Einträge`}>
            {entries.length}
          </span>
        ) : null}
        <p className="attention-inbox-lede">
          Dieselbe Liste wie Blockaden und Hinweise. Ausblenden ändert keinen Zustand.
        </p>
      </div>
      {blockersError || error ? (
        <p className="questions-note questions-note-error" role="alert">
          {blockersError || error}
        </p>
      ) : null}
      {entries.length === 0 ? (
        recosSettled ? (
          <p className="attention-inbox-empty">Nichts wartet — kein zweiter Kanal.</p>
        ) : null
      ) : (
        <ul
          className="attention-inbox-list"
          role="listbox"
          aria-label="Einträge für dich"
          tabIndex={0}
          aria-activedescendant={activeId}
          onKeyDown={onKeyDown}
        >
          {entries.map((entry, index) => (
            <li key={entry.key} role="presentation">
              <button
                type="button"
                id={`attention-${entry.key}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === activeIndex}
                aria-label={`${GRADE_LABEL[entry.grade]} ${labelForCode(entry.code)} — ${entry.title}. Öffnet ${GOAL_LABEL[entry.goal]}.`}
                className={`attention-inbox-row grade-${entry.grade}${index === activeIndex ? " is-active" : ""}`}
                onClick={() => onOpen(entry)}
              >
                <span className={`attention-grade grade-${entry.grade}`} title={entry.grade}>
                  {GRADE_LABEL[entry.grade]}
                </span>
                <span className="attention-inbox-body">
                  <span className="attention-code" title={entry.code}>
                    {labelForCode(entry.code)}
                  </span>
                  <span className="attention-title">{entry.title}</span>
                  {entry.count > 1 ? (
                    <span className="attention-count">{entry.count} Worker</span>
                  ) : null}
                </span>
                <span className="attention-goal">{GOAL_LABEL[entry.goal]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
