import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { commentLineOf, fileLabel, useWorkerDiff } from "../lib/diff";
import {
  addDiffComment,
  approveSetupTrust,
  deleteDiffComment,
  describeError,
  getSetupTrustView,
  getWorkerReadiness,
  listDiffComments,
  setDiffCommentDisposition,
  setReviewVerdict,
  type ReviewDecision,
} from "../lib/ipc";
import type { DiffComment, DiffFile, DiffLine, SetupTrustView, WorkerReadiness } from "../types";

interface DiffViewProps {
  workerId: string;
  /** Shown next to the base branch so the user knows whose diff this is. */
  branch: string;
}

/** Where the inline comment box currently sits. */
interface Composing {
  file: string;
  line: number;
}

/** `git diff --stat` ends in the one line worth putting in a header. */
function statSummary(stat: string): string | null {
  const lines = stat
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.length === 0 ? null : lines[lines.length - 1];
}

function lineKey(file: string, line: number): string {
  return `${file} ${line}`;
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return new Date(seconds * 1000).toLocaleString();
}

/**
 * The worker's branch against its base: file list on the left, unified diff on
 * the right, and the review comments the user pinned to it underneath.
 */
export default function DiffView({ workerId, branch }: DiffViewProps) {
  const { diff, comments, loading, error, refresh, setComments } = useWorkerDiff(
    workerId,
    listDiffComments,
  );

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [composing, setComposing] = useState<Composing | null>(null);
  // APP-14: one tab stop per file among the commentable rows. `null` means
  // "the first one"; the arrow keys and a focused row move it.
  const [stopLine, setStopLine] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<WorkerReadiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [setupTrust, setSetupTrust] = useState<SetupTrustView | null>(null);
  const [setupTrustError, setSetupTrustError] = useState<string | null>(null);
  const [activeBlocker, setActiveBlocker] = useState(0);

  // Async answers belong to the worker that asked for them: a late response
  // after a worker switch must not stamp worker A's trust view onto worker
  // B's screen (review-F4-r5, sibling of the settings-field race).
  const workerIdRef = useRef(workerId);
  useEffect(() => {
    workerIdRef.current = workerId;
  }, [workerId]);

  // `?? []` builds a fresh array on every render while the diff is still
  // loading, which re-runs every memo below it. Held stable so `selected` and
  // the totals only recompute when the diff itself changes.
  const files = useMemo(() => diff?.files ?? [], [diff]);

  // Keep a selection that still exists; otherwise fall back to the first file.
  const selected: DiffFile | null = useMemo(() => {
    if (files.length === 0) return null;
    return files.find((file) => file.path === selectedPath) ?? files[0];
  }, [files, selectedPath]);

  // A worker switch must not leave the previous worker's box open.
  useEffect(() => {
    setSelectedPath(null);
    setComposing(null);
    setDraft("");
    setActionError(null);
    setReadiness(null);
    setReadinessError(null);
    setSetupTrust(null);
    setSetupTrustError(null);
    setActiveBlocker(0);
    // A stale in-flight action's `finally` must not lift the new worker's
    // busy lock; the switch itself clears it, and the guards below only
    // release it for the worker that started the action.
    setBusy(false);
  }, [workerId]);

  const loadReadiness = useCallback(async (): Promise<WorkerReadiness | null> => {
    // Readiness and the setup-trust view load together and in parallel: both
    // are the core's answer about the same merge candidate, and the approval
    // below binds what this fetch put on screen — never a later, unseen
    // state. A failed view read is shown, not silently dropped: a readiness
    // blocker without its explanation panel would leave the reviewer guessing.
    // This callback must NEVER reject (both IPC reads are individually
    // translated into resolved values): the resync sites rely on it —
    // `Promise.allSettled` only keeps the refusal visible because this side
    // always resolves (review-F4-r24, Opus Beobachtung). A future `throw`
    // here reopens the blink-away bug, and no test would notice.
    const [setupResult, readinessResult] = await Promise.all([
      getSetupTrustView(workerId).then(
        (view) => ({ view, error: null as string | null }),
        (cause: unknown) => ({ view: null, error: describeError(cause) }),
      ),
      getWorkerReadiness(workerId).then(
        (next) => ({ next, error: null as string | null }),
        (cause: unknown) => ({ next: null, error: describeError(cause) }),
      ),
    ]);
    if (workerIdRef.current !== workerId) return null;
    setSetupTrust(setupResult.view);
    setSetupTrustError(setupResult.error);
    if (readinessResult.next !== null) {
      setReadiness(readinessResult.next);
      setReadinessError(null);
      return readinessResult.next;
    }
    setReadiness(null);
    setReadinessError(readinessResult.error);
    return null;
  }, [workerId]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  const reload = useCallback(() => {
    refresh();
    void loadReadiness();
  }, [loadReadiness, refresh]);

  // Comments by the line they are pinned to, for the in-gutter markers.
  const byLine = useMemo(() => {
    const map = new Map<string, DiffComment[]>();
    for (const comment of comments) {
      const key = lineKey(comment.file, comment.line);
      const bucket = map.get(key);
      if (bucket) bucket.push(comment);
      else map.set(key, [comment]);
    }
    return map;
  }, [comments]);

  const lineRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    setStopLine(null);
  }, [selected?.path]);

  const firstCommentable = useMemo(() => {
    for (const hunk of selected?.hunks ?? []) {
      for (const line of hunk.lines) {
        if (line.kind === "del") continue;
        const number = commentLineOf(line);
        if (number !== null) return number;
      }
    }
    return null;
  }, [selected]);
  const activeStop = stopLine ?? firstCommentable;

  // Roving tabindex across the rows of the pane: the arrows move focus and
  // the stop together, so Tab leaves the diff after one press.
  const onPaneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".diff-line-open"));
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || rows.length === 0) return;
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (at + 1) % rows.length;
    else if (event.key === "ArrowUp") next = (at - 1 + rows.length) % rows.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    if (next === null) return;
    event.preventDefault();
    rows[next].focus();
    const line = Number(rows[next].dataset.line);
    if (Number.isFinite(line)) setStopLine(line);
  };

  const registerLine = useCallback((key: string, node: HTMLDivElement | null) => {
    if (node) lineRefs.current.set(key, node);
    else lineRefs.current.delete(key);
  }, []);

  /** Jump from the comment list back to the line the comment belongs to. */
  const revealComment = useCallback((comment: DiffComment) => {
    setSelectedPath(comment.file);
    // The line only exists once the pane has re-rendered for the new file.
    window.requestAnimationFrame(() => {
      lineRefs.current.get(lineKey(comment.file, comment.line))?.scrollIntoView({
        block: "center",
      });
    });
  }, []);

  const openBox = useCallback((file: string, line: number) => {
    setActionError(null);
    setDraft("");
    setComposing((current) =>
      current && current.file === file && current.line === line ? null : { file, line },
    );
  }, []);

  const closeBox = useCallback(() => {
    setComposing(null);
    setDraft("");
  }, []);

  const submitComment = useCallback(() => {
    const target = composing;
    const body = draft.trim();
    if (!target || body === "" || busy) return;
    void (async () => {
      setBusy(true);
      setActionError(null);
      try {
        const comment = await addDiffComment({
          workerId,
          file: target.file,
          line: target.line,
          body,
        });
        setComments((prev) => [...prev, comment]);
        closeBox();
        void loadReadiness();
      } catch (cause) {
        setActionError(describeError(cause));
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, closeBox, composing, draft, loadReadiness, setComments, workerId]);

  const removeComment = useCallback(
    (comment: DiffComment) => {
      if (busy) return;
      void (async () => {
        setBusy(true);
        setActionError(null);
        try {
          await deleteDiffComment(comment.id);
          setComments((prev) => prev.filter((entry) => entry.id !== comment.id));
          void loadReadiness();
        } catch (cause) {
          setActionError(describeError(cause));
        } finally {
          setBusy(false);
        }
      })();
    },
    [busy, loadReadiness, setComments],
  );

  const markComment = useCallback(
    (comment: DiffComment) => {
      if (busy) return;
      const next = comment.disposition === "done" ? "open" : "done";
      void (async () => {
        setBusy(true);
        setActionError(null);
        try {
          await setDiffCommentDisposition(comment.id, next);
          setComments((prev) =>
            prev.map((entry) => (entry.id === comment.id ? { ...entry, disposition: next } : entry)),
          );
          void loadReadiness();
        } catch (cause) {
          setActionError(describeError(cause));
        } finally {
          setBusy(false);
        }
      })();
    },
    [busy, loadReadiness, setComments],
  );

  const blockers = readiness?.blockers ?? [];
  useEffect(() => {
    if (activeBlocker >= blockers.length) setActiveBlocker(0);
  }, [activeBlocker, blockers.length]);

  /**
   * Stamps the human verdict through the core, bound to the tuple of the diff
   * snapshot on screen — the only code the person actually reviewed. If git
   * moved since, the core refuses and the panel resyncs (diff and readiness)
   * to the current state, so the next click decides on what is on screen
   * then. Busy only lifts once the resync is done.
   */
  const submitVerdict = useCallback(
    (decision: ReviewDecision) => {
      // No tuple, no verdict: an unmeasurable snapshot (conflict, missing
      // git) has nothing to bind a decision to — the buttons stay dead
      // instead of looping on a misleading "reload" refusal.
      if (busy || loading || !diff?.code) return;
      const expected = diff.code;
      void (async () => {
        setBusy(true);
        setReadinessError(null);
        try {
          await setReviewVerdict(workerId, decision, expected);
          await loadReadiness();
        } catch (cause) {
          // Refused — typically because the code moved since this panel
          // loaded. Resync both to what is true now, then show why.
          // allSettled: a fast-rejecting refresh must not let a late
          // loadReadiness null the refusal again (review-F4-r23, Opus
          // Fund 1 — Promise.all short-circuits and the alert blinks away).
          await Promise.allSettled([refresh(), loadReadiness()]);
          if (workerIdRef.current === workerId) setReadinessError(describeError(cause));
        } finally {
          if (workerIdRef.current === workerId) setBusy(false);
        }
      })();
    },
    [busy, diff, loadReadiness, loading, refresh, workerId],
  );

  /**
   * Grants setup trust for exactly the inputs on screen. The payload is
   * rebuilt inside `approveSetupTrust` from the displayed view, and the core
   * re-computes the grant before storing — a stale click is refused and the
   * panel resyncs, the same discipline as the verdict binding above.
   */
  const approveSetup = useCallback(() => {
    if (busy || setupTrust === null) return;
    const seenTreeOid = diff?.code?.mergeTreeOid;
    if (!seenTreeOid) return; // the button is disabled without a read diff
    setBusy(true);
    setReadinessError(null);
    void (async () => {
      try {
        await approveSetupTrust(workerId, setupTrust, seenTreeOid);
        // The panel shows the core's answer, not the click's.
        await loadReadiness();
      } catch (cause) {
        // Refused — typically because the candidate moved since this panel
        // loaded. Resync BOTH the panel and the diff to what is true now
        // (the seen-tree check binds the approval to the diff on screen —
        // reloading only the panel would loop the refusal forever,
        // review-F4-r19, k3 Fund 1), then show why. allSettled: a
        // fast-rejecting refresh must not let a late loadReadiness null the
        // refusal again (r23, Opus Fund 1).
        await Promise.allSettled([refresh(), loadReadiness()]);
        if (workerIdRef.current === workerId) setReadinessError(describeError(cause));
      } finally {
        if (workerIdRef.current === workerId) setBusy(false);
      }
    })();
  }, [busy, diff, loadReadiness, refresh, setupTrust, workerId]);

  // Panel and diff are two independent measurements. If the candidate moved
  // between them, the panel shows a tree the reviewer never read in the
  // diff — the approval locks with a visible reason and an explicit reload
  // instead of looping core refusals (review-F4-r19, Opus Fund 1).
  const setupTreeDiverges =
    setupTrust !== null &&
    diff?.code != null &&
    setupTrust.mergeTreeOid !== diff.code.mergeTreeOid;

  const onReadinessKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (blockers.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveBlocker((index) => (index + 1) % blockers.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveBlocker((index) => (index - 1 + blockers.length) % blockers.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveBlocker(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveBlocker(blockers.length - 1);
    }
  };

  if (loading && diff === null) {
    return (
      <div className="empty-state">
        <p>Diff wird geladen…</p>
      </div>
    );
  }

  if (error !== null && diff === null) {
    return (
      <div className="empty-state">
        <p className="board-error">{error}</p>
        <div className="empty-actions">
          <button type="button" className="empty-action-ghost" onClick={refresh}>
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  const baseBranch = diff?.baseBranch ?? "base";
  const totals = files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  const summaryLine = diff ? statSummary(diff.stat) : null;

  return (
    <div className="diff-view">
      <header className="diff-head">
        <span className="diff-base" title={`${branch} vs. ${baseBranch}`}>
          <span className="diff-base-branch">{branch}</span>
          <span className="diff-base-arrow">vs.</span>
          <span className="diff-base-branch">{baseBranch}</span>
        </span>
        {files.length > 0 ? (
          <span className="diff-totals">
            <span className="diff-add-count">+{totals.additions}</span>
            <span className="diff-del-count">-{totals.deletions}</span>
            <span className="diff-file-count">
              {files.length} Datei{files.length === 1 ? "" : "en"}
            </span>
          </span>
        ) : null}
        {summaryLine ? (
          <span className="diff-stat" title={diff?.stat}>
            {summaryLine}
          </span>
        ) : null}
        <span className="diff-head-spacer" />
        {error ? <span className="board-error diff-head-error">{error}</span> : null}
        <button
          type="button"
          className="worker-action"
          title="Diff neu laden"
          aria-label="Diff und Readiness neu laden"
          disabled={loading}
          onClick={reload}
        >
          {loading ? "…" : "Aktualisieren"}
        </button>
      </header>

      <section className="diff-readiness" aria-label="Review-Readiness">
        <header className="diff-readiness-head">
          <h2 className="section-title">Readiness</h2>
          {readiness ? (
            <span
              className={`state-chip${readiness.readiness === "ready" ? " state-ready-to-merge" : " state-needs-you"}`}
              aria-label={
                readiness.readiness === "ready" ? "bereit zum Merge" : "nicht bereit zum Merge"
              }
            >
              {readiness.readiness === "ready" ? "bereit" : "blockiert"}
            </span>
          ) : null}
          {readiness ? (
            <span
              className="diff-ahead-behind"
              aria-label={`${readiness.ahead} Commits voraus, ${readiness.behind} Commits zurück`}
            >
              {readiness.ahead}↑ {readiness.behind}↓
            </span>
          ) : null}
        </header>
        {readinessError ? (
          <p className="questions-note questions-note-error" role="alert">
            {readinessError}
          </p>
        ) : blockers.length === 0 ? (
          <p className="diff-readiness-empty">
            {readiness?.readiness === "ready"
              ? "Keine Blocker — Merge ist an der Engine vorbeigelassen."
              : "Noch keine Blocker geladen."}
          </p>
        ) : (
          <ul
            className="diff-readiness-list"
            role="listbox"
            aria-label="Merge-Blocker"
            tabIndex={0}
            aria-activedescendant={
              blockers[activeBlocker] ? `diff-blocker-${activeBlocker}` : undefined
            }
            onKeyDown={onReadinessKeyDown}
          >
            {blockers.map((blocker, index) => (
              <li
                key={`${blocker.code}-${index}`}
                id={`diff-blocker-${index}`}
                role="option"
                aria-selected={index === activeBlocker}
                className={`diff-readiness-row${index === activeBlocker ? " is-active" : ""}`}
                aria-label={`${blocker.code}: ${blocker.message}. Nächster Schritt: ${blocker.nextStep}`}
              >
                <span className="diff-readiness-code">{blocker.code}</span>
                <span className="diff-readiness-message">{blocker.message}</span>
                <span className="diff-readiness-next">{blocker.nextStep}</span>
              </li>
            ))}
          </ul>
        )}
        {setupTrust === null && setupTrustError !== null ? (
          <p className="diff-setup-granted" role="status">
            Setup-Vertrauen nicht lesbar: {setupTrustError}
          </p>
        ) : null}
        {setupTrust === null ? null : (
          <div className="diff-setup-trust" aria-label="Setup-Vertrauen">
            {setupTreeDiverges ? (
              <p className="diff-setup-note" role="status">
                Diff und Setup-Panel zeigen verschiedene Kandidaten-Bäume — eine der
                beiden Messungen ist älter.{" "}
                <button
                  type="button"
                  className="worker-action"
                  onClick={() => {
                    // Resync BOTH sides: the panel is only ever re-measured
                    // by loadReadiness — refreshing the diff alone locks
                    // forever when the PANEL was the stale side
                    // (review-F4-r20, k3 Fund 1). allSettled: the error is
                    // shown only after both sides settled — a fast rejection
                    // must not blink away under a late success (r23, Opus
                    // Fund 1).
                    void Promise.allSettled([refresh(), loadReadiness()]).then((results) => {
                      const failed = results.find((r) => r.status === "rejected");
                      if (failed && workerIdRef.current === workerId) {
                        setReadinessError(describeError((failed as PromiseRejectedResult).reason));
                      }
                    });
                  }}
                >
                  Diff und Panel neu laden
                </button>
              </p>
            ) : null}
            {setupTrust.status === "granted" ? (
              <p className="diff-setup-granted">
                Setup freigegeben: <code>{setupTrust.commandNormalized}</code> — gilt für
                genau diesen Merge-Kandidaten; jede Baum-Änderung lässt die Freigabe
                verfallen.{" "}
                <span title={`Basis ${setupTrust.baseSha}`}>(Basis {setupTrust.baseSha.slice(0, 8)})</span>
              </p>
            ) : (
              <>
                <p className="diff-setup-lead">
                  {setupTrust.status === "mismatch"
                    ? "Setup-Inputs haben sich geändert — erneute Freigabe nötig:"
                    : "Setup braucht eine Freigabe, bevor es im Merge-Kandidaten laufen darf:"}
                </p>
                <dl className="diff-setup-inputs">
                  <div className="diff-setup-row">
                    <dt>Befehl</dt>
                    <dd>
                      <code>{setupTrust.commandNormalized}</code>
                    </dd>
                  </div>
                  <div className="diff-setup-row">
                    <dt>Basis</dt>
                    <dd>
                      <code title={setupTrust.baseSha}>{setupTrust.baseSha.slice(0, 8)}</code>
                    </dd>
                  </div>
                  <div className="diff-setup-row">
                    <dt>Inputs</dt>
                    <dd title={setupTrust.inputsHash}>
                      {setupTrust.inputFiles.length === 0
                        ? "keine deklarierten Dateien im Merge-Kandidaten"
                        : setupTrust.inputFiles.join(", ")}
                    </dd>
                  </div>
                  <div className="diff-setup-row">
                    <dt>Kandidaten-Baum</dt>
                    <dd>
                      <code title={setupTrust.mergeTreeOid}>
                        {setupTrust.mergeTreeOid.slice(0, 8)}
                      </code>
                    </dd>
                  </div>
                </dl>
                {!diff?.code && !loading ? (
                  <p className="diff-setup-note" role="status">
                    Ohne geladenen Diff gibt es keinen gelesenen Baum zu binden — die
                    Freigabe bleibt gesperrt.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="worker-action"
                  disabled={busy || loading || !diff?.code || setupTreeDiverges}
                  title="Genau die angezeigten Inputs freigeben, gebunden an den gelesenen Diff; jede Änderung verfällt"
                  onClick={approveSetup}
                >
                  Setup freigeben
                </button>
                <p className="diff-setup-note">
                  Die Freigabe gilt für genau diesen Merge-Kandidaten: der Befehl
                  kann alles ausführen, was der Baum enthält — jede Baum-Änderung
                  lässt die Freigabe verfallen.
                </p>
              </>
            )}
          </div>
        )}
        <div className="diff-verdict">
          <button
            type="button"
            className="worker-action"
            disabled={busy || loading || !diff?.code}
            aria-label="Review freigeben"
            title="Freigabe an den angezeigten Merge-Tree binden"
            onClick={() => submitVerdict("approved")}
          >
            Freigeben
          </button>
          <button
            type="button"
            className="worker-action"
            disabled={busy || loading || !diff?.code}
            aria-label="Änderungen anfordern"
            title="Änderungsgesuch an den angezeigten Merge-Tree binden"
            onClick={() => submitVerdict("changes_requested")}
          >
            Änderungen anfordern
          </button>
        </div>
      </section>

      {files.length === 0 ? (
        <div className="empty-state">
          <p>Keine Änderungen gegenüber {baseBranch}.</p>
          <p className="empty-hint">Sobald der Agent etwas schreibt, taucht es hier auf.</p>
        </div>
      ) : (
        <div className="diff-body">
          <aside className="diff-files">
            {files.map((file) => {
              const active = selected?.path === file.path;
              const notes = comments.filter((comment) => comment.file === file.path).length;
              return (
                <button
                  key={file.path}
                  type="button"
                  className={`diff-file${active ? " diff-file-active" : ""}`}
                  title={fileLabel(file.path, file.oldPath)}
                  aria-label={`Datei ${fileLabel(file.path, file.oldPath)}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => setSelectedPath(file.path)}
                >
                  <span className="diff-file-path">{fileLabel(file.path, file.oldPath)}</span>
                  <span className="diff-file-counts">
                    <span className="diff-add-count">+{file.additions}</span>
                    <span className="diff-del-count">-{file.deletions}</span>
                    {file.binary ? <span className="diff-file-binary">bin</span> : null}
                    {notes > 0 ? (
                      <span className="diff-file-notes" title={`${notes} Kommentar(e)`}>
                        {notes}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="diff-pane" onKeyDown={onPaneKeyDown}>
            {selected === null || selected.hunks.length === 0 ? (
              <p className="diff-pane-empty">
                {selected?.binary
                  ? "Binärdatei — dafür gibt es keinen Textdiff."
                  : "Keine darstellbaren Hunks in dieser Datei."}
              </p>
            ) : (
              selected.hunks.map((hunk, hunkIndex) => (
                <div key={`${hunkIndex}-${hunk.header}`} className="diff-hunk">
                  <div className="diff-hunk-header">{hunk.header}</div>
                  {hunk.lines.map((line, lineIndex) => (
                    <DiffLineRow
                      key={lineIndex}
                      file={selected.path}
                      line={line}
                      comments={byLine}
                      composing={composing}
                      draft={draft}
                      busy={busy}
                      error={actionError}
                      stop={activeStop}
                      onStop={setStopLine}
                      onRegister={registerLine}
                      onOpen={openBox}
                      onDraft={setDraft}
                      onSubmit={submitComment}
                      onCancel={closeBox}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <section className="diff-comments">
        <header className="diff-comments-head">
          <h2 className="section-title">Kommentare</h2>
          <span className="diff-comments-count">{comments.length}</span>
          {actionError ? <span className="board-error">{actionError}</span> : null}
        </header>
        {comments.length === 0 ? (
          <p className="diff-comments-empty">
            Noch keine Kommentare — auf eine Zeile klicken, um einen zu setzen.
          </p>
        ) : (
          <ul className="diff-comment-list">
            {comments.map((comment) => (
              <li key={comment.id} className="diff-comment">
                <button
                  type="button"
                  className="diff-comment-main"
                  title={`${comment.file}:${comment.line}`}
                  aria-label={`Kommentar ${comment.file}:${comment.line} anzeigen`}
                  onClick={() => revealComment(comment)}
                >
                  <span className="diff-comment-where">
                    {comment.file}:{comment.line}
                  </span>
                  <span className="diff-comment-body">{comment.body}</span>
                </button>
                <span className="diff-comment-meta">
                  <span
                    className={`badge ${comment.sentToAgent ? "badge-sent" : "badge-pending"}`}
                    title={formatTimestamp(comment.createdAt)}
                  >
                    {comment.sentToAgent ? "an Agent gesendet" : "ausstehend"}
                  </span>
                  <button
                    type="button"
                    className="worker-action"
                    disabled={busy}
                    aria-pressed={comment.disposition === "done"}
                    aria-label={
                      comment.disposition === "done"
                        ? `Kommentar ${comment.file}:${comment.line} wieder öffnen`
                        : `Kommentar ${comment.file}:${comment.line} erledigt`
                    }
                    onClick={() => markComment(comment)}
                  >
                    {comment.disposition === "done" ? "erledigt" : "offen"}
                  </button>
                  {comment.sentToAgent ? null : (
                    <button
                      type="button"
                      className="worker-action"
                      disabled={busy}
                      title="Kommentar verwerfen"
                      aria-label={`Kommentar ${comment.file}:${comment.line} verwerfen`}
                      onClick={() => removeComment(comment)}
                    >
                      x
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface DiffLineRowProps {
  file: string;
  line: DiffLine;
  comments: Map<string, DiffComment[]>;
  composing: Composing | null;
  draft: string;
  busy: boolean;
  error: string | null;
  /** The line number that currently is the file's tab stop. */
  stop: number | null;
  onStop: (line: number) => void;
  onRegister: (key: string, node: HTMLDivElement | null) => void;
  onOpen: (file: string, line: number) => void;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const SIGN: Record<DiffLine["kind"], string> = { add: "+", del: "-", context: " " };

/**
 * One diff line, plus the comment box when it is the line being commented on.
 * Deleted lines are not commentable: they are not in the file any more, so the
 * agent would have nothing to look at.
 */
function DiffLineRow({
  file,
  line,
  comments,
  composing,
  draft,
  busy,
  error,
  stop,
  onStop,
  onRegister,
  onOpen,
  onDraft,
  onSubmit,
  onCancel,
}: DiffLineRowProps) {
  const target = line.kind === "del" ? null : commentLineOf(line);
  const key = target === null ? null : lineKey(file, target);
  const pinned = key === null ? undefined : comments.get(key);
  const open = composing !== null && composing.file === file && composing.line === target;

  return (
    <>
      <div
        ref={key === null ? undefined : (node) => onRegister(key, node)}
        className={`diff-line diff-line-${line.kind}${target === null ? "" : " diff-line-open"}${
          open ? " diff-line-commenting" : ""
        }`}
        role={target === null ? undefined : "button"}
        tabIndex={target === null ? undefined : target === stop ? 0 : -1}
        data-line={target === null ? undefined : target}
        aria-label={target === null ? undefined : `Kommentar zu Zeile ${target}`}
        title={target === null ? undefined : "Kommentar zu dieser Zeile"}
        onFocus={target === null ? undefined : () => onStop(target)}
        onClick={target === null ? undefined : () => onOpen(file, target)}
        onKeyDown={
          target === null
            ? undefined
            : (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpen(file, target);
              }
        }
      >
        <span className="diff-gutter">{line.oldLine ?? ""}</span>
        <span className="diff-gutter">{line.newLine ?? ""}</span>
        <span className="diff-marker">
          {pinned && pinned.length > 0 ? (
            <span className="diff-line-note" title={`${pinned.length} Kommentar(e)`} />
          ) : null}
        </span>
        <span className="diff-sign">{SIGN[line.kind]}</span>
        <span className="diff-text">{line.content}</span>
      </div>

      {open && target !== null ? (
        <div className="diff-comment-box">
          <textarea
            className="field field-textarea"
            rows={3}
            autoFocus
            placeholder={`Kommentar zu Zeile ${target}…`}
            aria-label={`Kommentar zu Zeile ${target}`}
            value={draft}
            disabled={busy}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
                return;
              }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          {error ? <p className="modal-error">{error}</p> : null}
          <div className="diff-comment-box-actions">
            <span className="empty-hint">Strg+Enter sendet</span>
            <button type="button" className="button-ghost" disabled={busy} onClick={onCancel}>
              Abbrechen
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={busy || draft.trim() === ""}
              onClick={onSubmit}
            >
              {busy ? "…" : "Kommentieren"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
