import { useEffect, useState } from "react";

import { describeError, getSessionRestore } from "../lib/ipc";
import type { SessionRestore, Worker } from "../types";

interface SessionRestorePanelProps {
  worker: Worker;
  busy?: boolean;
  onRespawn: () => void;
}

const CONFIRMED_LABEL: Record<string, string> = {
  app_crash: "App beendet oder abgestürzt",
  agent_exited: "Agent beendet",
  fleet_stop: "Flotte gestoppt",
  worktree_missing: "Worktree fehlt",
};

function confirmedLabel(value: string | null): string | null {
  if (value === null) return null;
  return CONFIRMED_LABEL[value] ?? value;
}

/**
 * Honest post-crash surface: the persisted buffer, never a live PTY.
 * Respawn is explicit; mounting this view must not start an agent.
 */
export default function SessionRestorePanel({
  worker,
  busy = false,
  onRespawn,
}: SessionRestorePanelProps) {
  const [restore, setRestore] = useState<SessionRestore | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRestore(null);
    setError(null);
    void getSessionRestore(worker.id)
      .then((next) => {
        if (!cancelled) setRestore(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [worker.id]);

  const live = restore?.liveSession === true;
  const confirmed = confirmedLabel(restore?.lastConfirmed ?? null);
  const workspaceMissing = restore?.workspace === "missing";
  const canRespawn = !workspaceMissing && !busy;

  return (
    <section className="session-restore" aria-label="Sitzungs-Wiederherstellung">
      <p className="session-restore-status" role="status" aria-live="polite">
        {live
          ? "Unerwartet: Restore behauptet eine Live-Session."
          : "Kein Live-PTY. Der Puffer liegt auf der Platte; Respawn startet eine neue Sitzung."}
      </p>
      {confirmed ? <p className="session-restore-confirmed">Zuletzt bestätigt: {confirmed}</p> : null}
      {workspaceMissing ? (
        <p className="session-restore-missing" role="alert">
          Worktree fehlt — Respawn legt ihn nicht still neu an.
        </p>
      ) : null}
      {error ? (
        <p className="session-restore-error" role="alert">
          {error}
        </p>
      ) : null}
      {restore?.scrollback ? (
        <pre className="session-restore-scrollback" tabIndex={0} aria-label="Gespeicherter Scrollback">
          {restore.scrollback}
        </pre>
      ) : (
        <p className="session-restore-empty">Kein gespeicherter Scrollback.</p>
      )}
      {restore?.draft ? (
        <div className="session-restore-draft">
          <h2 className="session-restore-draft-label">Unsent draft</h2>
          <pre tabIndex={0} aria-label="Gespeicherter Entwurf">
            {restore.draft}
          </pre>
        </div>
      ) : null}
      <div className="session-restore-actions">
        <button
          type="button"
          className="empty-action"
          disabled={!canRespawn}
          onClick={onRespawn}
        >
          {busy ? "…" : "Respawn"}
        </button>
      </div>
    </section>
  );
}
