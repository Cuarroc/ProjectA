import { useEffect, useState } from "react";
import { workerStatusLabel } from "../lib/plainText";
import { shortTask } from "../lib/text";
import type { AgentProfile, Worker } from "../types";
import ErrorNote from "./ErrorNote";

interface WorkerPanelProps {
  /** Every worker of the project; orchestrators are filtered out here. */
  workers: Worker[];
  profiles: AgentProfile[];
  /** Worker whose terminal tab is currently in front, if any. */
  activeWorkerId: string | null;
  hasProject: boolean;
  loading: boolean;
  error: string | null;
  /** Worker with an archive/respawn call in flight. */
  busyWorkerId: string | null;
  onNew: () => void;
  onOpen: (worker: Worker) => void;
  onRespawn: (worker: Worker) => void;
  onArchive: (worker: Worker) => void;
}

/** Workers of the active project: task, agent profile, status and actions. */
export default function WorkerPanel({
  workers: allWorkers,
  profiles,
  activeWorkerId,
  hasProject,
  loading,
  error,
  busyWorkerId,
  onNew,
  onOpen,
  onRespawn,
  onArchive,
}: WorkerPanelProps) {
  // The orchestrator has its own sidebar entry; it is not a task in the list.
  // Coordinators - the orchestrator and the scout - are reached from their own
  // sidebar sections, not from the list of a project's actual work.
  const workers = allWorkers.filter((worker) => worker.kind === "worker");
  // Archiving cannot be undone, so it takes a second click on this worker.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  useEffect(() => {
    if (
      confirmingId !== null &&
      !allWorkers.some((worker) => worker.id === confirmingId && worker.status === "running")
    ) {
      setConfirmingId(null);
    }
  }, [allWorkers, confirmingId]);

  const profileName = (profileId: string) =>
    profiles.find((profile) => profile.id === profileId)?.name ?? profileId;

  return (
    <section className="sidebar-section sidebar-section-grow">
      <div className="section-head">
        <h2 className="section-title">Workers</h2>
        <button
          type="button"
          className="section-action"
          title={hasProject ? "New worker" : "Select a project first"}
          aria-label={hasProject ? "New worker" : "Select a project first"}
          disabled={!hasProject}
          onClick={onNew}
        >
          +
        </button>
      </div>

      {!hasProject ? <div className="sidebar-note">No project selected.</div> : null}
      {hasProject && loading ? <div className="sidebar-note">Loading…</div> : null}
      {error ? (
        <div className="sidebar-note sidebar-error">
          <ErrorNote message={error} />
        </div>
      ) : null}
      {hasProject && !loading && workers.length === 0 ? (
        <div className="sidebar-note">No workers yet.</div>
      ) : null}

      <ul className="worker-list">
        {workers.map((worker) => {
          const busy = worker.id === busyWorkerId;
          const attached = worker.sessionId !== null;
          return (
            <li
              key={worker.id}
              className={`worker-row${worker.id === activeWorkerId ? " worker-row-active" : ""}`}
            >
              <button
                type="button"
                className="worker-open"
                title={
                  attached
                    ? worker.task
                    : "Kein Live-PTY — Puffer ansehen oder neu starten"
                }
                onClick={() => onOpen(worker)}
              >
                <span className="worker-task">{shortTask(worker.task, 40)}</span>
                <span className="worker-meta">
                  <span className="badge badge-profile">{profileName(worker.profileId)}</span>
                  <span className={`badge badge-${worker.status}`}>{workerStatusLabel(worker.status)}</span>
                </span>
              </button>
              <div className="worker-actions">
                {worker.status === "running" && confirmingId === worker.id ? (
                  <>
                    <span className="worker-note">
                      Endgültig: der Agent wird beendet und kommt nicht zurück. Der Arbeitsbaum
                      bleibt.
                    </span>
                    <button
                      type="button"
                      className="worker-action"
                      disabled={busy}
                      onClick={() => {
                        setConfirmingId(null);
                        onArchive(worker);
                      }}
                    >
                      Ja, endgültig archivieren
                    </button>
                    <button
                      type="button"
                      className="worker-action"
                      onClick={() => setConfirmingId(null)}
                    >
                      Abbrechen
                    </button>
                  </>
                ) : worker.status === "running" ? (
                  <button
                    type="button"
                    className="worker-action"
                    disabled={busy}
                    title="Beendet den Agenten endgültig, der Arbeitsbaum bleibt"
                    onClick={() => setConfirmingId(worker.id)}
                  >
                    {busy ? "…" : "Archivieren"}
                  </button>
                ) : worker.status === "archived" ? (
                  // Same rule as the core: an archived ordinary worker is never
                  // respawned (every row in this list is an ordinary worker).
                  <span className="worker-note">
                    Archiviert – endgültig gestoppt, Arbeitsbaum bleibt
                  </span>
                ) : (
                  <button
                    type="button"
                    className="worker-action"
                    disabled={busy}
                    title="Startet einen neuen Agenten im selben Arbeitsbaum"
                    onClick={() => onRespawn(worker)}
                  >
                    {busy ? "…" : "Neu starten"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
