import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  BOARD_COLUMNS,
  COLUMN_LABELS,
  controllerBadge,
  controllerTitle,
  isCoordinatorKind,
  kindIcon,
} from "../lib/board";
import { useDiffSummary } from "../lib/diff";
import { describeError, runLearningCritic } from "../lib/ipc";
import { openExternalSafely } from "../lib/openExternalSafely";
import { formatTokens, shortTask } from "../lib/text";
import { useFocusTrap } from "../lib/useFocusTrap";
import { buildWorkerTree, flattenWorkerTree, hasWorkerHierarchy } from "../lib/workerTree";
import type {
  AgentProfile,
  BoardCard,
  BoardColumn,
  ContextUsage,
  CoordinatorInfo,
  TestStatus,
  Worker,
} from "../types";
import InfoLine from "./InfoLine";

interface BoardViewProps {
  /** Every card of the project; coordinators are filtered out here. */
  cards: BoardCard[];
  /** The project's coordinators; an empty list hides the banner entirely. */
  coordinators: CoordinatorInfo[];
  profiles: AgentProfile[];
  /** Worker whose terminal tab is currently in front, if any. */
  activeWorkerId: string | null;
  hasProject: boolean;
  /**
   * The active project's test command, or `null` when it has no gate. Only the
   * command itself is passed: the board needs it to decide whether a Tests
   * button belongs on a card and what to name in a tooltip, and nothing else
   * about the project — a whole `Project` prop would re-render every card for
   * a rename.
   */
  testCommand: string | null;
  /**
   * Whether the active project has a GitHub remote. Only the flag travels:
   * the merge dialog needs it to name the route the core will take (PR vs.
   * local merge), and handing down the whole `Project` for one boolean would
   * re-render every card whenever anything else about the project changes —
   * the same reason `testCommand` comes in on its own.
   */
  githubRemote: boolean;
  loading: boolean;
  error: string | null;
  /** Worker with a respawn call in flight. */
  busyWorkerId: string | null;
  onNew: () => void;
  onOpen: (worker: Worker) => void;
  /** Open the worker's workspace on its diff rather than its terminal. */
  onOpenDiff: (worker: Worker) => void;
  onRespawn: (worker: Worker) => void;
  /** `null` clears a manual override and hands the card back to the core. */
  onMove: (worker: Worker, column: BoardColumn | null) => void;
  /** Focus a coordinator's terminal; only called for one with a session. */
  onOpenCoordinator: (coordinator: CoordinatorInfo) => void;
  /**
   * Runs the project's tests for one worker. Rejects with whatever the core
   * said, which the card shows on its own line rather than in a dialog.
   */
  onRunTests: (worker: Worker) => Promise<void>;
  /**
   * Merges the worker's branch. Rejects with the core's raw git/gh output,
   * which the dialog shows verbatim instead of a summary — a merge conflict is
   * only actionable if the human sees exactly what git said.
   */
  onMerge: (worker: Worker, removeWorktree: boolean) => Promise<void>;
}

/** The five columns, with every worker of the active project on one of them. */
/**
 * Worker ids with a learning-critic run in flight, on module level on
 * purpose: the run is fired and forgotten and can take minutes, so it
 * outlives the board — a revisit while it runs must show the same
 * "Learning…" and must not offer a second start.
 */
const distillingWorkers = new Set<string>();

export default function BoardView({
  cards: allCards,
  coordinators,
  profiles,
  activeWorkerId,
  hasProject,
  testCommand,
  githubRemote,
  loading,
  error,
  busyWorkerId,
  onNew,
  onOpen,
  onOpenDiff,
  onRespawn,
  onMove,
  onOpenCoordinator,
  onRunTests,
  onMerge,
}: BoardViewProps) {
  // Coordinators run the board; they do not sit on it. Memoised so the
  // menu-dismiss effect below only reacts to real card changes.
  const cards = useMemo(
    () => allCards.filter((card) => !isCoordinatorKind(card.worker.kind)),
    [allCards],
  );

  // At most one card menu is open, and it is identified by its worker.
  const [menuWorkerId, setMenuWorkerId] = useState<string | null>(null);
  // The open menu and the button that opened it: focus goes in on open and
  // back out on close, as the menu pattern requires (APP-13).
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuOpenerRef = useRef<HTMLElement | null>(null);

  // Who-spawned-whom, from the `spawnedBy` the cards already carry. The strip
  // only earns its height when there is nesting to show (see
  // `hasWorkerHierarchy`) — coordinators the list does not carry leave their
  // workers flat, and that is the everyday case.
  const [treeOpen, setTreeOpen] = useState(true);
  const treeRows = useMemo(
    () => flattenWorkerTree(buildWorkerTree(allCards.map((card) => card.worker))),
    [allCards],
  );
  const showTree = useMemo(
    () => hasWorkerHierarchy(allCards.map((card) => card.worker)),
    [allCards],
  );

  // Cards whose diff summary is unfolded. Nothing is fetched for a card that
  // is not in here, which is what keeps a busy board cheap.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggleExpanded = (workerId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(workerId)) next.add(workerId);
      return next;
    });

  // Workers with a test run in flight, and the last failure per worker. Both
  // are keyed by worker so a second card can be tested while the first runs.
  const [testing, setTesting] = useState<ReadonlySet<string>>(() => new Set());
  const [testErrors, setTestErrors] = useState<ReadonlyMap<string, string>>(() => new Map());

  const runTests = (worker: Worker) => {
    if (testing.has(worker.id)) return;
    setTesting((current) => new Set(current).add(worker.id));
    setTestErrors((current) => {
      const next = new Map(current);
      next.delete(worker.id);
      return next;
    });
    void onRunTests(worker)
      .catch((cause: unknown) => {
        setTestErrors((current) => new Map(current).set(worker.id, describeError(cause)));
      })
      .finally(() => {
        setTesting((current) => {
          const next = new Set(current);
          next.delete(worker.id);
          return next;
        });
      });
  };

  // Workers with a critic run in flight, and its last word per worker. The run
  // reads a whole session and can take minutes, so it is fired and forgotten:
  // the board stays usable, and the card reports back when the core answers.
  // The in-flight set itself lives on module level (see `distillingWorkers`):
  // unmounting the board must not forget a run that is still going.
  const [distilling, setDistilling] = useState<ReadonlySet<string>>(
    () => new Set(distillingWorkers),
  );
  const [learningNotes, setLearningNotes] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [learningErrors, setLearningErrors] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );

  const distill = (worker: Worker) => {
    if (distillingWorkers.has(worker.id)) return;
    distillingWorkers.add(worker.id);
    setDistilling(new Set(distillingWorkers));
    setLearningNotes((current) => {
      const next = new Map(current);
      next.delete(worker.id);
      return next;
    });
    setLearningErrors((current) => {
      const next = new Map(current);
      next.delete(worker.id);
      return next;
    });
    void runLearningCritic(worker.id)
      .then((count) => {
        setLearningNotes((current) =>
          new Map(current).set(
            worker.id,
            count > 0
              ? `${count} ${count === 1 ? "Learning" : "Learnings"} gefunden.`
              : "Keine Learnings gefunden.",
          ),
        );
      })
      .catch((cause: unknown) => {
        setLearningErrors((current) => new Map(current).set(worker.id, describeError(cause)));
      })
      .finally(() => {
        distillingWorkers.delete(worker.id);
        // The board that started the run may be gone; only a mounted one
        // still has a state to update.
        setDistilling(new Set(distillingWorkers));
      });
  };

  // The worker whose merge dialog is open, plus the in-flight flag and the
  // core's last complaint. At most one merge runs at a time: it rewrites the
  // project's base branch, and two of those racing is not something the user
  // can reason about.
  const [mergeTarget, setMergeTarget] = useState<Worker | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const closeMergeDialog = () => {
    // A merge that is already on its way cannot be taken back, so the dialog
    // refuses to disappear out from under it.
    if (merging) return;
    setMergeTarget(null);
    setMergeError(null);
  };

  const confirmMerge = (removeWorktree: boolean) => {
    const worker = mergeTarget;
    if (worker === null || merging) return;
    setMerging(true);
    setMergeError(null);
    void onMerge(worker, removeWorktree)
      .then(() => setMergeTarget(null))
      .catch((cause: unknown) => {
        // Verbatim: the git/gh output of a failed merge is the whole point of
        // showing it, and the dialog stays open so it stays readable.
        setMergeError(describeError(cause));
      })
      .finally(() => setMerging(false));
  };

  const closeMenu = () => setMenuWorkerId(null);

  useEffect(() => {
    if (menuWorkerId === null) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuWorkerId(null);
    };
    // Anything outside the menu dismisses it; the menu stops its own events.
    const onPointerDown = () => setMenuWorkerId(null);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
      const opener = menuOpenerRef.current;
      if (opener && opener.isConnected) opener.focus();
    };
  }, [menuWorkerId]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length;
    else if (event.key === "ArrowUp") next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next].focus();
  };

  // A card that vanished under an open menu must not keep it open.
  useEffect(() => {
    if (menuWorkerId !== null && !cards.some((card) => card.worker.id === menuWorkerId)) {
      setMenuWorkerId(null);
    }
  }, [cards, menuWorkerId]);

  const profileName = (profileId: string) =>
    profiles.find((profile) => profile.id === profileId)?.name ?? profileId;

  if (!hasProject) {
    return (
      <div className="empty-state">
        <p>No project selected.</p>
        <p className="empty-hint">Pick a project in the sidebar, or add one.</p>
      </div>
    );
  }

  if (error !== null && cards.length === 0) {
    return (
      <div className="empty-state">
        <p className="board-error">{error}</p>
        <p className="empty-hint">Retrying every few seconds.</p>
      </div>
    );
  }

  if (loading && cards.length === 0) {
    return (
      <div className="empty-state">
        <p>Loading board…</p>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="empty-state">
        <p>No workers in this project yet.</p>
        <div className="empty-actions">
          <button type="button" className="empty-action" onClick={onNew}>
            New worker
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="board">
      {error ? <div className="board-error board-error-banner">{error}</div> : null}
      <CoordinatorBanner coordinators={coordinators} onOpen={onOpenCoordinator} />
      {showTree ? (
        <section className="board-tree">
          <button
            type="button"
            className="board-tree-toggle"
            aria-expanded={treeOpen}
            onClick={() => setTreeOpen((current) => !current)}
          >
            Hierarchie {treeOpen ? "▾" : "▸"}
          </button>
          {treeOpen ? (
            <ul className="board-tree-list">
              {treeRows.map(({ worker: rowWorker, depth }) => {
                const icon = isCoordinatorKind(rowWorker.kind) ? kindIcon(rowWorker.kind) : "";
                return (
                  <li
                    key={rowWorker.id}
                    className="board-tree-row"
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                  >
                    <span
                      className={`status-dot status-dot-${rowWorker.status}`}
                      aria-label={rowWorker.status}
                      title={rowWorker.status}
                    />
                    {icon === "" ? null : (
                      <span className="board-tree-kind" aria-hidden="true">
                        {icon}
                      </span>
                    )}
                    <span className="board-tree-task" title={rowWorker.task}>
                      {shortTask(rowWorker.task, 56)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
      <div className="board-columns">
        {BOARD_COLUMNS.map((column) => {
          const columnCards = cards.filter((card) => card.column === column);
          return (
            <section key={column} className={`board-column board-column-${column}`}>
              <header className="board-column-head">
                <span className="board-column-title">{COLUMN_LABELS[column]}</span>
                <span className="board-column-count">{columnCards.length}</span>
              </header>
              <div className="board-column-body">
                {columnCards.length === 0 ? (
                  <p className="board-column-empty">—</p>
                ) : (
                  columnCards.map((card) => {
                    const worker = card.worker;
                    const { attentionReason, prUrl } = card;
                    const attached = worker.sessionId !== null;
                    const busy = worker.id === busyWorkerId;
                    // A card the user just started shows "running" before the
                    // core has caught up, so the local flag wins over the card.
                    const testStatus = testing.has(worker.id) ? "running" : card.testStatus;
                    // A run the core reports blocks the button just as a local
                    // one does — the second start would be no less of a double.
                    const testRunning = testStatus === "running";
                    const testError = testErrors.get(worker.id) ?? null;
                    const distillRunning = distilling.has(worker.id);
                    const learningNote = learningNotes.get(worker.id) ?? null;
                    const learningError = learningErrors.get(worker.id) ?? null;
                    // The gate only bites where there is one: a project
                    // without a test command merges on the human's word.
                    const mergeBlocked = testCommand !== null && testStatus !== "pass";
                    const mergeBusy = merging && mergeTarget?.id === worker.id;
                    return (
                      <article
                        key={worker.id}
                        className={`board-card${
                          worker.id === activeWorkerId ? " board-card-active" : ""
                        }${attentionReason ? " board-card-attention" : ""}`}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setMenuWorkerId(worker.id);
                        }}
                      >
                        <button
                          type="button"
                          className="board-card-main"
                          title={attached ? worker.task : "No live session — respawn to attach"}
                          disabled={!attached}
                          onClick={() => onOpen(worker)}
                        >
                          <span className="board-card-head">
                            <span
                              className={`status-dot status-dot-${worker.status}`}
                              aria-label={worker.status}
                              title={worker.status}
                            />
                            <span className="board-card-task">{shortTask(worker.task, 64)}</span>
                          </span>
                          <span className="board-card-branch">{worker.branch}</span>
                        </button>

                        <ContextUsageMeter usage={card.contextUsage} />

                        <div className="board-card-chips">
                          <span className="badge badge-profile">
                            {profileName(worker.profileId)}
                          </span>
                          <span
                            className="badge board-card-controller"
                            title={controllerTitle(card.controlledBy)}
                          >
                            {controllerBadge(card.controlledBy)}
                          </span>
                          {attentionReason ? (
                            <span
                              className="badge badge-attention"
                              title={attentionReason}
                            >
                              {attentionReason}
                            </span>
                          ) : null}
                          {prUrl ? (
                            <button
                              type="button"
                              className="badge badge-pr"
                              title={prUrl}
                              onClick={() => void openExternalSafely(prUrl, setMergeError)}
                            >
                              PR ↗
                            </button>
                          ) : null}
                          {/* A project without a gate would get a "nie
                              gelaufen" chip on every card and learn nothing
                              from it, so the badge waits for a command — or
                              for a verdict left over from an older one. */}
                          {testCommand !== null || testStatus !== null ? (
                            <TestBadge
                              status={testStatus}
                              testedAt={card.testedAt}
                              command={testCommand}
                            />
                          ) : null}
                        </div>

                        <div className="board-card-actions">
                          <button
                            type="button"
                            className="board-card-expand"
                            aria-expanded={expanded.has(worker.id)}
                            title={expanded.has(worker.id) ? "Diff einklappen" : "Diff anzeigen"}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => toggleExpanded(worker.id)}
                          >
                            Diff {expanded.has(worker.id) ? "▴" : "▾"}
                          </button>
                          <span className="board-card-actions-spacer" />
                          {testCommand === null ? null : (
                            <button
                              type="button"
                              className="worker-action"
                              disabled={testRunning}
                              title={`Tests im Worktree ausführen: ${testCommand}`}
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={() => runTests(worker)}
                            >
                              {testRunning ? "Tests…" : "Tests"}
                            </button>
                          )}
                          {attached ? null : (
                            <button
                              type="button"
                              className="worker-action"
                              disabled={busy}
                              title="Attach a fresh agent to this worktree"
                              onClick={() => onRespawn(worker)}
                            >
                              {busy ? "…" : "Respawn"}
                            </button>
                          )}
                          {column === "ready_to_merge" ? (
                            <button
                              type="button"
                              className="board-card-merge"
                              disabled={mergeBlocked || mergeBusy}
                              title={
                                mergeBlocked
                                  ? testRunning
                                    ? "Tests laufen noch — Merge wartet auf ein grünes Ergebnis"
                                    : "Tests erst grün machen"
                                  : "Branch mergen und Worker archivieren"
                              }
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={() => {
                                setMergeError(null);
                                setMergeTarget(worker);
                              }}
                            >
                              {mergeBusy ? "Merge…" : "Merge"}
                            </button>
                          ) : null}
                          {column === "done" ? (
                            <button
                              type="button"
                              className="worker-action board-card-learning"
                              disabled={distillRunning}
                              title="Learnings aus diesem Lauf destillieren"
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={() => distill(worker)}
                            >
                              {distillRunning ? "Learning…" : "Learning"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="board-card-menu-button"
                            aria-haspopup="menu"
                            aria-expanded={menuWorkerId === worker.id}
                            title="Move to column…"
                            aria-label="Move to column"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              menuOpenerRef.current = event.currentTarget;
                              setMenuWorkerId((current) =>
                                current === worker.id ? null : worker.id,
                              );
                            }}
                          >
                            ⋯
                          </button>
                        </div>

                        {testError === null ? null : (
                          <p className="board-card-test-error board-error" title={testError}>
                            {testError}
                          </p>
                        )}

                        {/* A budget-paused worker otherwise looks exactly like
                            an ordinary exited one — the core wrote down why. */}
                        <InfoLine
                          text={
                            worker.pausedReason === null
                              ? null
                              : `Pausiert: ${worker.pausedReason}`
                          }
                        />

                        {learningNote === null ? null : (
                          <p className="board-card-learning-note">{learningNote}</p>
                        )}

                        {learningError === null ? null : (
                          <p className="board-card-test-error board-error" title={learningError}>
                            {learningError}
                          </p>
                        )}

                        {expanded.has(worker.id) ? (
                          <CardDiffSummary worker={worker} onOpenDiff={onOpenDiff} />
                        ) : null}

                        {menuWorkerId === worker.id ? (
                          <div
                            ref={menuRef}
                            className="card-menu"
                            role="menu"
                            aria-label="Move to column"
                            onMouseDown={(event) => event.stopPropagation()}
                            onKeyDown={onMenuKeyDown}
                          >
                            {/* Only menuitems may be children of a menu; the
                                caption is decoration, the name sits on the menu. */}
                            <div className="card-menu-title" role="presentation">
                              Move to column
                            </div>
                            {BOARD_COLUMNS.map((target) => (
                              <button
                                key={target}
                                type="button"
                                role="menuitem"
                                className={`card-menu-item${
                                  target === card.column ? " card-menu-item-current" : ""
                                }`}
                                onClick={() => {
                                  closeMenu();
                                  onMove(worker, target);
                                }}
                              >
                                {COLUMN_LABELS[target]}
                              </button>
                            ))}
                            <button
                              type="button"
                              role="menuitem"
                              className="card-menu-item card-menu-clear"
                              title="Let the core decide again"
                              onClick={() => {
                                closeMenu();
                                onMove(worker, null);
                              }}
                            >
                              Clear override
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
      {mergeTarget === null ? null : (
        <MergeDialog
          worker={mergeTarget}
          githubRemote={githubRemote}
          hasTestGate={testCommand !== null}
          busy={merging}
          error={mergeError}
          onConfirm={confirmMerge}
          onClose={closeMergeDialog}
        />
      )}
    </div>
  );
}

/**
 * Confirms one merge. Built like `NewWorkerDialog`: same backdrop, same modal
 * frame, same footer — a second dialog shape would make the board feel like a
 * different app.
 */
function MergeDialog({
  worker,
  githubRemote,
  hasTestGate,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  worker: Worker;
  githubRemote: boolean;
  /** Whether the project has a test command gating its merges. */
  hasTestGate: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (removeWorktree: boolean) => void;
  onClose: () => void;
}) {
  // Off by default: the worktree is the only place the work still exists in
  // full, and dropping it is not something to do by accident.
  const [removeWorktree, setRemoveWorktree] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const dialogRef = useRef<HTMLFormElement | null>(null);
  useFocusTrap(dialogRef);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    onConfirm(removeWorktree);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Merge worker"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="modal-title">Mergen — {shortTask(worker.task, 48)}</div>
        <div className="modal-body">
          {/* No title field on purpose: `merge_worker` takes only the worker
              and the worktree flag, so the core builds the PR title itself. */}
          <div className="modal-note">
            The core builds the PR title from the task itself.
          </div>

          <div className="modal-note merge-route">
            {githubRemote
              ? "GitHub-Remote vorhanden: der Merge läuft über einen Pull Request."
              : "Kein GitHub-Remote: es wird lokal in den Basis-Branch gemergt."}
          </div>

          {/* The card's Merge button only gates when the project has a test
              command; without one the merge is unguarded, and the dialog is
              the place that has to say so. */}
          {hasTestGate ? null : (
            <div className="modal-note">
              No test gate configured for this project — merging is unguarded.
              Set a test command in Settings to enable the gate.
            </div>
          )}

          <div className="modal-note merge-branch" title={worker.worktreePath}>
            Branch: {worker.branch}
          </div>

          <label className="queue-sharpen merge-remove">
            <input
              type="checkbox"
              checked={removeWorktree}
              disabled={busy}
              onChange={(event) => setRemoveWorktree(event.target.checked)}
            />
            <span>Worktree nach Merge entfernen</span>
          </label>

          {error === null ? null : (
            <div className="modal-note modal-error merge-error">{error}</div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="button-ghost" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? "Merge läuft…" : "Mergen"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The coordinators standing above the columns, one chip each. With nothing to
 * show the banner is not rendered at all — an empty strip above the board
 * would cost height and say nothing.
 */
function CoordinatorBanner({
  coordinators,
  onOpen,
}: {
  coordinators: CoordinatorInfo[];
  onOpen: (coordinator: CoordinatorInfo) => void;
}) {
  if (coordinators.length === 0) return null;

  return (
    <div className="coord-banner">
      {coordinators.map((coordinator) => {
        const icon = kindIcon(coordinator.kind);
        const live = coordinator.sessionId !== null;
        return (
          <button
            key={coordinator.workerId}
            type="button"
            className={`coord-chip coord-chip-${coordinator.kind}`}
            disabled={!live}
            title={live ? `Terminal von ${coordinator.label} öffnen` : "Keine live Session"}
            onClick={() => onOpen(coordinator)}
          >
            {icon === "" ? null : (
              <span className="coord-chip-icon" aria-hidden="true">
                {icon}
              </span>
            )}
            <span className="coord-chip-label">{coordinator.label}</span>
            <span
              className={`status-dot status-dot-${coordinator.status}`}
              aria-label={coordinator.status}
              title={coordinator.status}
            />
          </button>
        );
      })}
    </div>
  );
}

/** Symbol and wording per verdict; `null` is the card that never ran. */
const TEST_BADGE: Record<TestStatus | "none", { icon: string; label: string; note: string }> = {
  pass: { icon: "✓", label: "bestanden", note: "Tests bestanden" },
  fail: { icon: "✗", label: "fehlgeschlagen", note: "Tests fehlgeschlagen" },
  running: { icon: "↻", label: "läuft", note: "Tests laufen" },
  none: { icon: "–", label: "nie gelaufen", note: "Tests nie gelaufen" },
};

/**
 * The card's test verdict. The tooltip carries the parts that do not fit the
 * chip — when it ran and what ran — and simply omits whichever the core has
 * not told us about.
 */
function TestBadge({
  status,
  testedAt,
  command,
}: {
  status: TestStatus | null;
  testedAt: number | null;
  command: string | null;
}) {
  const { icon, label, note } = TEST_BADGE[status ?? "none"];
  const parts = [note];
  // A timestamp describes a finished run; naming the previous one beside
  // "Tests laufen" would read as if that run had already landed.
  if (testedAt !== null && status !== "running") {
    parts.push(new Date(testedAt * 1000).toLocaleString());
  }
  if (command !== null) parts.push(command);

  return (
    <span
      className={`badge board-card-test board-card-test-${status ?? "none"}`}
      title={parts.join(" — ")}
    >
      <span aria-hidden="true">{icon}</span> {label}
    </span>
  );
}

/**
 * Context fill for one card. The row keeps its height whether or not the core
 * has numbers yet, so a card never resizes when usage arrives or drops away.
 */
function ContextUsageMeter({ usage }: { usage: ContextUsage | null }) {
  if (usage === null) return <div className="board-card-usage" aria-hidden="true" />;

  const ratio = Math.min(1, usage.used / usage.total);
  const percent = Math.round(ratio * 100);
  const level = ratio >= 0.9 ? "critical" : ratio >= 0.75 ? "high" : "normal";
  const label = `${formatTokens(usage.used)}/${formatTokens(usage.total)}`;

  return (
    <div
      className={`board-card-usage board-card-usage-${level}`}
      title={`Context: ${label} (${percent}%)`}
    >
      <span className="board-card-usage-label">{label}</span>
      <span
        className="board-card-usage-track"
        role="progressbar"
        aria-label="Context usage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="board-card-usage-fill" style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

/**
 * The card's `+a/-d`, fetched the first time the card is unfolded and cached
 * for a short while afterwards — the board itself never asks for a diff.
 */
function CardDiffSummary({
  worker,
  onOpenDiff,
}: {
  worker: Worker;
  onOpenDiff: (worker: Worker) => void;
}) {
  const { summary, loading, error } = useDiffSummary(worker.id, true);

  if (error !== null && summary === null) {
    return (
      <div className="board-card-diff">
        <span className="board-card-diff-note board-error" title={error}>
          Diff nicht lesbar
        </span>
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className="board-card-diff">
        <span className="board-card-diff-note">{loading ? "Diff wird geladen…" : "—"}</span>
      </div>
    );
  }

  if (summary.files === 0) {
    return (
      <div className="board-card-diff">
        <span className="board-card-diff-note">
          Keine Änderungen gegenüber {summary.baseBranch}
        </span>
      </div>
    );
  }

  return (
    <div className="board-card-diff">
      <span className="diff-add-count">+{summary.additions}</span>
      <span className="diff-del-count">-{summary.deletions}</span>
      <span className="board-card-diff-note" title={`Basis: ${summary.baseBranch}`}>
        {summary.files} Datei{summary.files === 1 ? "" : "en"}
      </span>
      <span className="board-card-actions-spacer" />
      {worker.sessionId === null ? null : (
        <button
          type="button"
          className="worker-action"
          title="Diff im Worker-Workspace öffnen"
          onClick={() => onOpenDiff(worker)}
        >
          Öffnen
        </button>
      )}
    </div>
  );
}
