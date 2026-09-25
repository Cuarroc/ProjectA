import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  acceptRecommendation,
  createScout,
  describeError,
  listRecommendations,
  setRecommendationStatus,
  triageRepos,
} from "../lib/ipc";
import { openExternalSafely } from "../lib/openExternalSafely";
import { isCategoryActive } from "../lib/settings";
import { shortTask } from "../lib/text";
import type { Recommendation, Worker } from "../types";

interface RecommendationsPanelProps {
  /** `null` means there is no active project and therefore nothing to scout. */
  projectId: string | null;
  /** Brings the spawned scout's terminal to the front. */
  onOpenWorker: (worker: Worker) => void;
}

/** How long a confirmation stays on screen before it stops being news. */
const NOTICE_MS = 6_000;

/** The scout list changes outside this webview, so poll it as well. */
const POLL_MS = 15_000;

/** Longest label a repository link is given before the middle is dropped. */
const LINK_MAX = 42;

/**
 * Repository links are long and their tail (owner/repo) carries the meaning,
 * so a clipped one keeps both ends rather than only the scheme and host.
 */
function shortUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (bare.length <= LINK_MAX) return bare;
  const head = bare.slice(0, 12);
  const tail = bare.slice(-(LINK_MAX - 13));
  return `${head}…${tail}`;
}

/** One URL per line; blank lines and stray whitespace are the user's, not ours. */
function parseUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Scout intake (repo triage and free-form research) plus the suggestions the
 * project's scouts have produced.
 */
export default function RecommendationsPanel({
  projectId,
  onOpenWorker,
}: RecommendationsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [entries, setEntries] = useState<Recommendation[]>([]);
  // "Noch keine Empfehlungen" is only earned after the first successful read
  // of *this* project — before it the panel stays quiet rather than lying.
  const [loaded, setLoaded] = useState(false);
  const [urls, setUrls] = useState("");
  const [triaging, setTriaging] = useState(false);
  const [scouting, setScouting] = useState(false);
  /** The scout this panel started last, kept as a way back to its terminal. */
  const [scout, setScout] = useState<Worker | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (projectId === null) return;
    try {
      const next = await listRecommendations(projectId);
      setEntries(next);
      setLoaded(true);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId === null) {
      setEntries([]);
      setLoaded(false);
      setScout(null);
      setNotice(null);
      setError(null);
      return;
    }
    // Another project, another inbox: the previous project's suggestions are
    // dropped up front, so they can never act (or be accepted) under the new
    // project's name while its read is still out.
    setEntries([]);
    setLoaded(false);
    setError(null);
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [projectId, refresh]);

  // A confirmation is only worth the space for as long as it is still recent.
  const noticeTimer = useRef<number | null>(null);
  useEffect(() => {
    if (notice === null) return;
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    };
  }, [notice]);

  if (projectId === null) return null;

  // Dismissed suggestions are gone from the panel; accepted ones stay for a
  // moment as their own receipt until the next poll drops them.
  const visible = entries.filter((entry) => entry.status !== "dismissed");
  const newCount = entries.filter((entry) => entry.status === "new").length;
  const parsed = parseUrls(urls);
  const busy = triaging || scouting;
  const scoutCategoryOn = isCategoryActive("scout");
  const canTriage = parsed.length > 0 && !busy && scoutCategoryOn;

  const rememberScout = (worker: Worker, label: string) => {
    setScout(worker);
    setNotice(label);
  };

  const handleTriage = (event: FormEvent) => {
    event.preventDefault();
    if (!canTriage) return;
    if (!isCategoryActive("scout")) {
      setError("Scout-Kategorie ist aus — es wird kein Scout gestartet.");
      return;
    }
    void (async () => {
      setTriaging(true);
      setError(null);
      try {
        const worker = await triageRepos(projectId, parsed);
        setUrls("");
        rememberScout(
          worker,
          `Scout bewertet ${parsed.length} ${parsed.length === 1 ? "Repo" : "Repos"}.`,
        );
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setTriaging(false);
      }
    })();
  };

  const handleScout = () => {
    if (busy || !isCategoryActive("scout")) {
      if (!busy && !isCategoryActive("scout")) {
        setError("Scout-Kategorie ist aus — es wird kein Scout gestartet.");
      }
      return;
    }
    void (async () => {
      setScouting(true);
      setError(null);
      try {
        rememberScout(await createScout(projectId), "Scout gestartet.");
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setScouting(false);
      }
    })();
  };

  const handleAccept = (entry: Recommendation) => {
    void (async () => {
      setBusyId(entry.id);
      setError(null);
      try {
        await acceptRecommendation(entry.id);
        setEntries((current) =>
          current.map((item) =>
            item.id === entry.id ? { ...item, status: "accepted" as const } : item,
          ),
        );
        setNotice(`„${shortTask(entry.title, 32)}“ ist in der Warteschlange.`);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setBusyId(null);
      }
    })();
  };

  const handleDismiss = (entry: Recommendation) => {
    void (async () => {
      setBusyId(entry.id);
      setError(null);
      try {
        await setRecommendationStatus(entry.id, "dismissed");
        setEntries((current) => current.filter((item) => item.id !== entry.id));
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setBusyId(null);
      }
    })();
  };

  return (
    <section className="sidebar-section reco-section">
      <div className="section-head">
        <h2 className="section-title">Empfehlungen</h2>
        {newCount > 0 ? (
          <span className="badge badge-reco-new" title={`${newCount} offene Empfehlungen`}>
            {newCount}
          </span>
        ) : null}
        <button
          type="button"
          className="section-action"
          aria-expanded={!collapsed}
          title={collapsed ? "Empfehlungen anzeigen" : "Empfehlungen einklappen"}
          aria-label={collapsed ? "Empfehlungen anzeigen" : "Empfehlungen einklappen"}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>

      {collapsed ? null : (
        <>
          <form className="reco-form" onSubmit={handleTriage}>
            <textarea
              className="field field-textarea reco-urls"
              rows={2}
              placeholder="Repos prüfen — eine URL pro Zeile"
              aria-label="Repos prüfen"
              value={urls}
              disabled={busy}
              onChange={(event) => setUrls(event.target.value)}
            />
            <div className="reco-form-actions">
              <button type="submit" className="button-primary reco-submit" disabled={!canTriage}>
                {triaging ? "Bewerte…" : "Bewerten"}
              </button>
              <button
                type="button"
                className="worker-action reco-scout-start"
                disabled={busy || !scoutCategoryOn}
                title={
                  scoutCategoryOn
                    ? "Scout für freie Recherche starten"
                    : "Scout-Kategorie ist aus"
                }
                onClick={handleScout}
              >
                {scouting ? "Starte…" : "Scout starten"}
              </button>
            </div>
          </form>

          {scout ? (
            <button
              type="button"
              className="reco-scout-link"
              disabled={scout.sessionId === null}
              title={
                scout.sessionId === null
                  ? "Der Scout hat kein laufendes Terminal."
                  : "Scout-Terminal öffnen"
              }
              onClick={() => onOpenWorker(scout)}
            >
              <span className="reco-scout-dot" aria-hidden="true">
                ◆
              </span>
              <span className="reco-scout-label">Scout: {shortTask(scout.task, 30)}</span>
            </button>
          ) : null}

          {notice ? <div className="sidebar-note reco-notice">{notice}</div> : null}
          {error ? <div className="sidebar-note sidebar-error">{error}</div> : null}

          {visible.length === 0 && loaded && error === null ? (
            <div className="sidebar-note reco-empty">
              Noch keine Empfehlungen — Repos bewerten oder einen Scout starten.
            </div>
          ) : visible.length === 0 ? null : (
            <ul className="reco-list">
              {visible.map((entry) => {
                const pending = busyId === entry.id;
                const accepted = entry.status === "accepted";
                const url = entry.url;
                return (
                  <li key={entry.id} className="reco-card">
                    <div className="reco-title" title={entry.title}>
                      {entry.title}
                    </div>
                    {entry.rationale === "" ? null : (
                      <p className="reco-rationale" title={entry.rationale}>
                        {entry.rationale}
                      </p>
                    )}
                    <div className="reco-meta">
                      {entry.effort ? (
                        <span className="badge badge-effort" title={`Aufwand: ${entry.effort}`}>
                          {entry.effort}
                        </span>
                      ) : null}
                      {accepted ? (
                        <span className="badge badge-reco-accepted">übernommen</span>
                      ) : null}
                      {url ? (
                        <button
                          type="button"
                          className="reco-url"
                          title={url}
                          onClick={() => void openExternalSafely(url, setError)}
                        >
                          {shortUrl(url)}
                        </button>
                      ) : null}
                    </div>
                    {accepted ? null : (
                      <div className="reco-actions">
                        <button
                          type="button"
                          className="worker-action reco-accept"
                          disabled={pending}
                          title="Als Task einreihen"
                          onClick={() => handleAccept(entry)}
                        >
                          {pending ? "…" : "Übernehmen"}
                        </button>
                        <button
                          type="button"
                          className="worker-action reco-dismiss"
                          disabled={pending}
                          title="Empfehlung verwerfen"
                          onClick={() => handleDismiss(entry)}
                        >
                          Ablehnen
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
