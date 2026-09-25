import { useCallback, useEffect, useState, type FormEvent } from "react";

import { cancelQueuedTask, describeError, enqueueTask, listQueue } from "../lib/ipc";
import { composeWithMasterPrompt, isMasterPromptEnabled, loadMasterPrompt } from "../lib/settings";
import { shortTask } from "../lib/text";
import { useSharpening } from "../lib/useSharpening";
import type { AgentProfile, QueueEntry } from "../types";
import InfoLine from "./InfoLine";

interface QueuePanelProps {
  /** `null` means there is no active project and therefore no queue to show. */
  projectId: string | null;
  profiles: AgentProfile[];
  profilesLoading: boolean;
  /** Brings the dispatched worker's terminal to the front. */
  onFocusWorker: (workerId: string) => void;
  /** Switch to the Fragen tab, where a sharpening round's questions wait. */
  onOpenQuestions: () => void;
}

/** Compact task intake and dispatcher queue for the active project. */
export default function QueuePanel({
  projectId,
  profiles,
  profilesLoading,
  onFocusWorker,
  onOpenQuestions,
}: QueuePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  // "Leer" is a claim that is only earned after the first successful read —
  // before it, and after a failed one, the panel says nothing at all.
  const [loaded, setLoaded] = useState(false);
  const [task, setTask] = useState("");
  const [profileId, setProfileId] = useState("");
  const [sharpen, setSharpen] = useState(false);
  // The master prompt is read once per mount; editing it happens in settings.
  const hasMasterPrompt = loadMasterPrompt().trim() !== "";
  const [attachMaster, setAttachMaster] = useState(
    () => hasMasterPrompt && isMasterPromptEnabled(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Sharpening before the task is queued at all (Phase 21 P1), as opposed to
   * the checkbox below, which lets the dispatcher do it later with nobody in
   * front of it. Only this one can ask back: a vague task becomes preflight
   * questions in the Fragen tab, and the final prompt lands in the field —
   * still unqueued, still editable.
   */
  const sharpening = useSharpening(projectId, (prompt) => {
    setTask(prompt);
    // Sharpening it twice would cost a second agent run to rewrite a prompt
    // that has already been through one.
    setSharpen(false);
  });

  const refresh = useCallback(async () => {
    if (projectId === null) return;
    try {
      const next = await listQueue(projectId);
      setEntries(Array.isArray(next) ? next : []);
      setLoaded(true);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [projectId]);

  // The queue changes independently of this webview, so reconcile it on a
  // quiet 10-second cadence as well as after every action below.
  useEffect(() => {
    if (projectId === null) {
      setEntries([]);
      setLoaded(false);
      setError(null);
      return;
    }
    setLoaded(false);
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(interval);
  }, [projectId, refresh]);

  if (projectId === null) return null;

  const busy = submitting || sharpening.active;
  const canEnqueue = task.trim() !== "" && !busy;
  const profileName = (id: string | null) =>
    id === null ? "Auto" : profiles.find((profile) => profile.id === id)?.name ?? id;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canEnqueue) return;
    void (async () => {
      setSubmitting(true);
      setError(null);
      try {
        const entry = await enqueueTask({
          projectId,
          rawText: attachMaster ? composeWithMasterPrompt(task.trim()) : task.trim(),
          profileId: profileId === "" ? undefined : profileId,
          sharpen,
        });
        setEntries((current) => [entry, ...current.filter((item) => item.id !== entry.id)]);
        setTask("");
        setSharpen(false);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setSubmitting(false);
      }
    })();
  };

  const handleCancel = (id: string) => {
    void (async () => {
      setCancellingId(id);
      setError(null);
      try {
        await cancelQueuedTask(id);
        setEntries((current) => current.filter((entry) => entry.id !== id));
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setCancellingId(null);
      }
    })();
  };

  return (
    <section className="sidebar-section queue-section">
      <div className="section-head">
        <h2 className="section-title">Warteschlange</h2>
        <button
          type="button"
          className="section-action"
          aria-expanded={!collapsed}
          title={collapsed ? "Warteschlange anzeigen" : "Warteschlange einklappen"}
          aria-label={collapsed ? "Warteschlange anzeigen" : "Warteschlange einklappen"}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>

      {collapsed ? null : (
        <>
          <form className="queue-form" onSubmit={handleSubmit}>
            <textarea
              className="field field-textarea queue-task"
              rows={2}
              placeholder="Task einreihen…"
              aria-label="Task einreihen"
              value={task}
              disabled={busy}
              onChange={(event) => setTask(event.target.value)}
            />
            <select
              className="field queue-profile"
              value={profileId}
              disabled={busy || profilesLoading}
              aria-label="Agent-Profil"
              onChange={(event) => setProfileId(event.target.value)}
            >
              <option value="">Profil automatisch wählen</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            {hasMasterPrompt ? (
              <label className="queue-sharpen">
                <input
                  type="checkbox"
                  checked={attachMaster}
                  disabled={busy}
                  onChange={(event) => setAttachMaster(event.target.checked)}
                />
                <span>Masterprompt anhängen</span>
              </label>
            ) : null}
            <label
              className="queue-sharpen"
              title={
                "Der Dispatcher schärft die Aufgabe, wenn er sie aufnimmt — ohne jemanden " +
                "davor, also ohne Rückfragen."
              }
            >
              <input
                type="checkbox"
                checked={sharpen}
                disabled={busy}
                onChange={(event) => setSharpen(event.target.checked)}
              />
              <span>Beim Einreihen schärfen</span>
            </label>
            <div className="queue-actions">
              <button
                type="button"
                className="button-subtle queue-sharpen-now"
                disabled={task.trim() === "" || busy}
                onClick={() => sharpening.start(task, profileId === "" ? undefined : profileId)}
                title="Jetzt schärfen — bei einer vagen Aufgabe kommen erst Rückfragen zurück"
              >
                {
                  {
                    idle: "Jetzt schärfen",
                    thinking: "Schärfe…",
                    waiting: "Wartet auf dich…",
                    finishing: "Baue Prompt…",
                  }[sharpening.phase]
                }
              </button>
              <button type="submit" className="button-primary queue-submit" disabled={!canEnqueue}>
                {submitting ? "Reihe ein…" : "Einreihen"}
              </button>
            </div>
          </form>

          {/* The round's questions are ordinary preflight rows; the tab is
              where they get answered, and the prompt comes back into the field
              above once they are. */}
          {sharpening.phase === "waiting" ? (
            <div className="sidebar-note queue-sharpen-note" aria-live="polite">
              {sharpening.open.length === 1
                ? "Eine Rückfrage wartet im Fragen-Tab. "
                : `${sharpening.open.length} Rückfragen warten im Fragen-Tab. `}
              <button type="button" className="link-button" onClick={onOpenQuestions}>
                Beantworten
              </button>
              {" · "}
              <button type="button" className="link-button" onClick={sharpening.cancel}>
                Abbrechen
              </button>
            </div>
          ) : null}
          {sharpening.error ? (
            <div role="alert">
              <button
                type="button"
                className="sidebar-note sidebar-error"
                onClick={sharpening.clearError}
                title="Ausblenden"
                aria-label={`Fehler ausblenden: ${sharpening.error}`}
              >
                {sharpening.error}
              </button>
            </div>
          ) : null}

          {error ? <div className="sidebar-note sidebar-error" role="alert">{error}</div> : null}
          {entries.length === 0 && loaded && error === null ? (
            <div className="sidebar-note queue-empty">
              Warteschlange leer — Tasks einreihen, der Dispatcher arbeitet sie ab
            </div>
          ) : entries.length === 0 ? null : (
            <ul className="queue-list">
              {entries.map((entry) => {
                // A claimed entry is already starting its worker, so the core
                // refuses to cancel it. Offering the button anyway would only
                // produce an error the user cannot act on.
                const cancellable = entry.status === "queued" || entry.status === "ready";
                const dispatchable = entry.status === "dispatched" && entry.workerId !== null;
                return (
                  <li key={entry.id} className="queue-entry">
                    <button
                      type="button"
                      className="queue-entry-main"
                      disabled={!dispatchable}
                      title={dispatchable ? "Worker fokussieren" : entry.rawText}
                      onClick={() => {
                        if (entry.workerId !== null) onFocusWorker(entry.workerId);
                      }}
                    >
                      <span className="queue-entry-task">{shortTask(entry.rawText, 56)}</span>
                      <span className="queue-entry-meta">
                        <span className={`badge badge-queue-${entry.status}`}>
                          {entry.status === "sharpening"
                            ? "Schärfe…"
                            : entry.status === "dispatching"
                              ? "Starte…"
                              : entry.status}
                        </span>
                        <span className="badge badge-priority">P{entry.priority}</span>
                        <span className="badge badge-profile" title={profileName(entry.profileId)}>
                          {profileName(entry.profileId)}
                        </span>
                      </span>
                    </button>
                    {cancellable ? (
                      <button
                        type="button"
                        className="worker-action queue-cancel"
                        disabled={cancellingId === entry.id}
                        title="Task aus der Warteschlange entfernen"
                        onClick={() => handleCancel(entry.id)}
                      >
                        {cancellingId === entry.id ? "…" : "Abbrechen"}
                      </button>
                    ) : null}
                    {/* A failed entry otherwise stands mute with nothing but its
                        badge; the core wrote exactly why (often with a repair
                        hint) into `error`. */}
                    {entry.status === "failed" ? (
                      <InfoLine text={entry.error} tone="error" className="queue-entry-error" />
                    ) : null}
                    {entry.sharpenedText?.trim() ? (
                      <details className="queue-entry-sharpened">
                        <summary>Geschärfter Prompt</summary>
                        <p className="queue-entry-sharpened-text">{entry.sharpenedText}</p>
                      </details>
                    ) : null}
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
