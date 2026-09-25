import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, getActivity, getDigest, listDigests } from "../lib/ipc";
import type { ActivityCategory, ActivityEntry } from "../types";

interface ActivityViewProps {
  /** Active project; the feed is scoped to it, like the other views. */
  projectId: string | null;
}

const POLL_INTERVAL_MS = 10_000;
const FEED_LIMIT = 200;

/** A quiet empty state that looks intentional, not broken. */
function EmptyActivity() {
  return (
    <div className="activity-empty">
      <p>
        Hier erscheint, was die Flotte tut: Spawns, Statuswechsel, Nachrichten, Queue-Events,
        Learnings und Empfehlungen.
      </p>
    </div>
  );
}

/**
 * The daily digests of one project: the dates, and one page at a time.
 *
 * Fetch on view and nothing else - no poll. A digest is written once an hour
 * for a day that is already over, so there is never anything new to see
 * between two clicks, and the feed above already polls for what is live.
 */
function DigestPanel({ projectId }: { projectId: string | null }) {
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A project switch drops everything: the pages belong to the repository.
  useEffect(() => {
    setDates([]);
    setSelected(null);
    setPage(null);
    setError(null);
  }, [projectId]);

  useEffect(() => {
    if (!open || projectId === null) return;
    void listDigests(projectId)
      .then(setDates)
      .catch((cause: unknown) => setError(describeError(cause)));
  }, [open, projectId]);

  const show = (date: string) => {
    if (projectId === null) return;
    setSelected(date);
    setPage(null);
    setError(null);
    void getDigest(projectId, date)
      .then(setPage)
      .catch((cause: unknown) => setError(describeError(cause)));
  };

  return (
    <section className="digest-panel">
      <button
        type="button"
        className="digest-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "▾" : "▸"} Tages-Digest
      </button>
      {open ? (
        projectId === null ? (
          <p className="digest-hint">Kein Projekt ausgewählt.</p>
        ) : (
          <div className="digest-body">
            {error ? <p className="digest-hint">{error}</p> : null}
            {dates.length === 0 ? (
              <p className="digest-hint">
                Noch keine Digests. Sie entstehen stündlich für den Tag, der bereits
                vorbei ist, und liegen unter <code>.pa/memory/digests/</code>.
              </p>
            ) : (
              <ul className="digest-dates">
                {dates.map((date) => (
                  <li key={date}>
                    <button
                      type="button"
                      className={`digest-date${selected === date ? " digest-date-active" : ""}`}
                      onClick={() => show(date)}
                    >
                      {date}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected !== null ? (
              // Rendered as preformatted text on purpose: the page is Markdown
              // meant for a vault, and this is a preview, not a second reader.
              <pre className="digest-page">{page ?? "…"}</pre>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}

/**
 * Fleet-wide activity feed. Newest entries come first; we poll for updates and
 * reload when the project changes. A failed read is shown as what it is:
 * rendering the quiet empty state over it would claim the fleet is simply
 * doing nothing.
 */
export default function ActivityView({ projectId }: ActivityViewProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow response for a project the user already left:
  // every request gets a token, only the newest one may write — otherwise the
  // old project's feed lands under the new project's name. Same pattern as
  // useBoard.
  const tokenRef = useRef(0);

  const refresh = useCallback(
    async (showSpinner = false) => {
      const mine = ++tokenRef.current;
      if (showSpinner) setLoading(true);
      try {
        const next = await getActivity(projectId ?? undefined, FEED_LIMIT);
        if (tokenRef.current !== mine) return;
        setEntries(next);
        setError(null);
      } catch (cause) {
        if (tokenRef.current !== mine) return;
        setError(describeError(cause));
      } finally {
        if (tokenRef.current === mine && showSpinner) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    setEntries([]);
    setError(null);
    void refresh(true);
    return () => {
      // The old project's in-flight request must not write after the switch.
      tokenRef.current += 1;
    };
  }, [projectId, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="activity-view">
      <DigestPanel projectId={projectId} />
      {error !== null ? (
        <div className="sidebar-note sidebar-error" role="alert">
          {error}
        </div>
      ) : entries.length === 0 && !loading ? (
        <EmptyActivity />
      ) : (
        <div className="activity-list">
          {entries.map((entry) => (
            <div key={entry.id} className={`activity-entry activity-entry-${entry.category}`}>
              <span className="activity-meta">
                <span className={`activity-badge activity-badge-${entry.category}`}>
                  {categoryLabel(entry.category)}
                </span>
                {entry.workerLabel ? (
                  <span className="activity-worker" title={entry.workerId ?? undefined}>
                    {entry.workerLabel}
                  </span>
                ) : null}
                <span className="activity-time">{formatEntryTime(entry.createdAt)}</span>
              </span>
              <p className="activity-summary">{entry.summary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** German badge labels; an unknown category keeps its raw word. */
function categoryLabel(category: ActivityCategory): string {
  switch (category) {
    case "worker":
      return "Worker";
    case "status":
      return "Status";
    case "message":
      return "Nachricht";
    case "queue":
      return "Queue";
    case "recommendation":
      return "Empfehlung";
    case "learning":
      return "Learning";
    case "role":
      return "Rolle";
    default:
      return category;
  }
}

/** Short local time; date only when it is not today. */
function formatEntryTime(seconds: number): string {
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
