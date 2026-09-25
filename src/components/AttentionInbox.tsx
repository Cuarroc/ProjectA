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
  const [activeIndex, setActiveIndex] = useState(0);
  const prevInbox = useRef<InboxEntry[]>([]);
  const sink = useMemo(() => webviewNotifySink(), []);

  const refreshRecos = useCallback(async () => {
    if (projectId === null) {
      setRecos([]);
      return;
    }
    try {
      setRecos(await listRecommendations(projectId));
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [projectId]);

  useEffect(() => {
    void refreshRecos();
    if (projectId === null) return;
    const timer = window.setInterval(() => void refreshRecos(), POLL_MS);
    return () => window.clearInterval(timer);
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
    <section className="attention-inbox" aria-label="Attention-Inbox">
      <div className="attention-inbox-head">
        <h2 className="section-title">Attention</h2>
        {entries.length > 0 ? (
          <span className="state-chip state-needs-you" aria-label={`${entries.length} Einträge`}>
            {entries.length}
          </span>
        ) : null}
        <p className="attention-inbox-lede">
          Dieselbe Liste wie F1-Codes und F4-Blocker. Ausblenden ändert keinen Zustand.
        </p>
      </div>
      {blockersError || error ? (
        <p className="questions-note questions-note-error" role="alert">
          {blockersError || error}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p className="attention-inbox-empty">Nichts wartet — kein zweiter Kanal.</p>
      ) : (
        <ul
          className="attention-inbox-list"
          role="listbox"
          aria-label="Attention-Einträge"
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
                aria-label={`${GRADE_LABEL[entry.grade]} ${entry.code} — ${entry.title}. Öffnet ${GOAL_LABEL[entry.goal]}.`}
                className={`attention-inbox-row grade-${entry.grade}${index === activeIndex ? " is-active" : ""}`}
                onClick={() => onOpen(entry)}
              >
                <span className={`attention-grade grade-${entry.grade}`}>{entry.grade}</span>
                <span className="attention-inbox-body">
                  <code className="attention-code">{entry.code}</code>
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
