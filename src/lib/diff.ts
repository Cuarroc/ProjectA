import { useCallback, useEffect, useRef, useState } from "react";

import { describeError, getWorkerDiff } from "./ipc";
import type { DiffComment, WorkerDiff } from "../types";

/** The counts a board card shows without rendering a single hunk. */
export interface DiffSummary {
  baseBranch: string;
  files: number;
  additions: number;
  deletions: number;
}

export function summarizeDiff(diff: WorkerDiff): DiffSummary {
  let additions = 0;
  let deletions = 0;
  for (const file of diff.files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { baseBranch: diff.baseBranch, files: diff.files.length, additions, deletions };
}

export function isEmptySummary(summary: DiffSummary): boolean {
  return summary.files === 0;
}

interface CacheEntry {
  summary: DiffSummary;
  at: number;
}

/**
 * Summaries live outside React so that collapsing and re-expanding a card — or
 * leaving the board and coming back — costs nothing. A worktree does keep
 * changing underneath us, so an entry is only trusted for a short while.
 */
const SUMMARY_TTL_MS = 30_000;
const summaries = new Map<string, CacheEntry>();

function readCache(workerId: string): DiffSummary | null {
  const entry = summaries.get(workerId);
  if (!entry) return null;
  if (Date.now() - entry.at > SUMMARY_TTL_MS) {
    summaries.delete(workerId);
    return null;
  }
  return entry.summary;
}

export function cacheDiffSummary(workerId: string, summary: DiffSummary): void {
  summaries.set(workerId, { summary, at: Date.now() });
}

export interface DiffSummaryState {
  summary: DiffSummary | null;
  loading: boolean;
  error: string | null;
}

/**
 * The diff counts of one worker, fetched the first time `enabled` turns true
 * and never on a plain re-render. Cards are cheap precisely because nothing
 * here runs until the user expands one.
 */
export function useDiffSummary(workerId: string, enabled: boolean): DiffSummaryState {
  const [summary, setSummary] = useState<DiffSummary | null>(() =>
    enabled ? readCache(workerId) : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const cached = readCache(workerId);
    if (cached) {
      setSummary(cached);
      setError(null);
      return;
    }
    let stale = false;
    setLoading(true);
    void (async () => {
      try {
        const next = summarizeDiff(await getWorkerDiff(workerId));
        cacheDiffSummary(workerId, next);
        if (stale) return;
        setSummary(next);
        setError(null);
      } catch (cause) {
        if (!stale) setError(describeError(cause));
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [enabled, workerId]);

  return { summary, loading, error };
}

export interface WorkerDiffState {
  diff: WorkerDiff | null;
  comments: DiffComment[];
  loading: boolean;
  error: string | null;
  /** Refetch the diff and its comments. Resolves when the new snapshot is in. */
  refresh: () => Promise<void>;
  /** Replace the comment list after an add or a delete. */
  setComments: (next: DiffComment[] | ((prev: DiffComment[]) => DiffComment[])) => void;
}

/**
 * The full diff of one worker plus its review comments. The two always travel
 * together: a comment without its line is not reviewable.
 */
export function useWorkerDiff(
  workerId: string,
  loadComments: (workerId: string) => Promise<DiffComment[]>,
): WorkerDiffState {
  const [diff, setDiff] = useState<WorkerDiff | null>(null);
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow response for a worker the user already left.
  const token = useRef(0);
  const loadCommentsRef = useRef(loadComments);
  loadCommentsRef.current = loadComments;

  const load = useCallback(
    async (showSpinner: boolean) => {
      const mine = ++token.current;
      if (showSpinner) setLoading(true);
      try {
        // Comments must not sink the diff: a failure there is recoverable.
        const [next, notes] = await Promise.all([
          getWorkerDiff(workerId),
          loadCommentsRef.current(workerId).catch(() => [] as DiffComment[]),
        ]);
        if (token.current !== mine) return;
        setDiff(next);
        setComments(notes);
        setError(null);
        cacheDiffSummary(workerId, summarizeDiff(next));
      } catch (cause) {
        if (token.current === mine) setError(describeError(cause));
      } finally {
        if (token.current === mine) setLoading(false);
      }
    },
    [workerId],
  );

  useEffect(() => {
    setDiff(null);
    setComments([]);
    setError(null);
    void load(true);
  }, [load]);

  const refresh = useCallback(() => load(false), [load]);

  return { diff, comments, loading, error, refresh, setComments };
}

/** `path` on a rename carries where the file came from. */
export function fileLabel(path: string, oldPath: string | null): string {
  return oldPath === null ? path : `${oldPath} → ${path}`;
}

/** The line a comment is pinned to: the new side, falling back to the old. */
export function commentLineOf(line: { newLine: number | null; oldLine: number | null }): number | null {
  return line.newLine ?? line.oldLine;
}
