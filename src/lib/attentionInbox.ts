/**
 * F3 Attention inbox: one list, no second state machine.
 *
 * Sources are F1 reason-codes on the board, F4 readiness blockers when the
 * caller has them, and scout recommendations. Sorting and coalescing happen
 * here. Dismiss lives only in the notification planner — it never removes an
 * entry whose source is still signalling.
 */

import type { BoardCard, Recommendation, Worker } from "../types";

export type AttentionGrade = "blocking" | "attention" | "info";

/** F2 IA goals. The shell switches AppGoal; this list does not invent new ones. */
export type AttentionGoal = "work" | "agents" | "review";

export type AttentionSource =
  | {
      kind: "signal";
      workerId: string;
      projectId: string;
      code: string;
      grade: AttentionGrade;
      reason: string | null;
      observedAt: number;
    }
  | {
      kind: "blocker";
      workerId: string;
      projectId: string;
      code: string;
      message: string;
      nextStep: string;
      observedAt: number;
    }
  | {
      kind: "recommendation";
      id: string;
      projectId: string;
      workerId: string | null;
      title: string;
      observedAt: number;
    };

export interface InboxEntry {
  /** Coalesce key: kind + code + (single-task id or `*` for a bundled code). */
  key: string;
  code: string;
  grade: AttentionGrade;
  count: number;
  workerIds: string[];
  projectId: string;
  title: string;
  reason: string | null;
  nextStep: string | null;
  goal: AttentionGoal;
  /** Oldest observation in the bundle — the one that has waited longest. */
  observedAt: number;
  source: AttentionSource["kind"];
}

const GRADE_RANK: Record<AttentionGrade, number> = {
  blocking: 0,
  attention: 1,
  info: 2,
};

const REVIEW_CODES = new Set([
  "changes_requested",
  "review_pending",
  "review_approved",
  "approved_but_draft",
  "checks_pending",
  "review_draft",
  "pull_request_merged",
  "tests_stale",
  "review_stale",
  "comments_open",
  "conflicting",
  "dirty",
  "base_changed",
  "git_unsupported",
  "setup_failed",
  "agent_running",
]);

const WORK_CODES = new Set(["decision_pending", "approval_required"]);

export function goalForCode(code: string): AttentionGoal {
  if (WORK_CODES.has(code)) return "work";
  if (REVIEW_CODES.has(code) || code.startsWith("review_")) return "review";
  return "agents";
}

export function cardsToSources(cards: readonly BoardCard[], now = 0): AttentionSource[] {
  return cards.flatMap((card) => {
    if (card.attentionCode === null || card.attentionGrade === null) return [];
    return [
      {
        kind: "signal" as const,
        workerId: card.worker.id,
        projectId: card.worker.projectId,
        code: card.attentionCode,
        grade: card.attentionGrade,
        reason: card.attentionReason,
        observedAt: card.attentionObservedAt ?? now,
      },
    ];
  });
}

/**
 * Exited workers with no live PTY: the buffer is on disk. Attention names
 * that; opening the row shows restore, it does not spawn.
 */
export function restoreToSources(
  workers: readonly Worker[],
  now = 0,
): AttentionSource[] {
  return workers.flatMap((worker) => {
    if (worker.kind !== "worker") return [];
    if (worker.sessionId !== null) return [];
    if (worker.status !== "exited") return [];
    return [
      {
        kind: "signal" as const,
        workerId: worker.id,
        projectId: worker.projectId,
        code: "session_ended",
        grade: "attention" as const,
        reason: "Kein Live-PTY — Puffer liegt bereit. Respawn startet nicht von selbst.",
        observedAt: now,
      },
    ];
  });
}

export function recommendationsToSources(
  entries: readonly Recommendation[],
): AttentionSource[] {
  return entries
    .filter((entry) => entry.status === "new")
    .map((entry) => ({
      kind: "recommendation" as const,
      id: entry.id,
      projectId: entry.projectId,
      workerId: null,
      title: entry.title,
      observedAt: entry.createdAt,
    }));
}

function coalesceKey(item: AttentionSource): string {
  switch (item.kind) {
    case "signal":
      return `signal:${item.code}`;
    case "blocker":
      return `blocker:${item.code}`;
    case "recommendation":
      return `recommendation:${item.id}`;
  }
}

function titleFor(item: AttentionSource, count: number): string {
  switch (item.kind) {
    case "signal":
      return count > 1
        ? `${count} Worker: ${item.reason ?? item.code}`
        : (item.reason ?? item.code);
    case "blocker":
      return count > 1 ? `${count} Worker: ${item.message}` : item.message;
    case "recommendation":
      return item.title;
  }
}

export function buildInbox(items: readonly AttentionSource[]): InboxEntry[] {
  const groups = new Map<string, AttentionSource[]>();
  for (const item of items) {
    const key = coalesceKey(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const entries: InboxEntry[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const workerIds = [
      ...new Set(
        group.flatMap((item) => {
          if (item.kind === "recommendation") {
            return item.workerId === null ? [] : [item.workerId];
          }
          return [item.workerId];
        }),
      ),
    ];
    const observedAt = Math.min(...group.map((item) => item.observedAt));
    if (first.kind === "recommendation") {
      entries.push({
        key,
        code: "recommendation",
        grade: "attention",
        count: 1,
        workerIds,
        projectId: first.projectId,
        title: first.title,
        reason: first.title,
        nextStep: "Empfehlung in Insights/Settings prüfen — sie bleibt, bis du sie annimmst oder ablehnst.",
        goal: "work",
        observedAt,
        source: "recommendation",
      });
      continue;
    }
    if (first.kind === "blocker") {
      entries.push({
        key,
        code: first.code,
        grade: "blocking",
        count: group.length,
        workerIds,
        projectId: first.projectId,
        title: titleFor(first, group.length),
        reason: first.message,
        nextStep: first.nextStep,
        goal: goalForCode(first.code),
        observedAt,
        source: "blocker",
      });
      continue;
    }
    entries.push({
      key,
      code: first.code,
      grade: first.grade,
      count: group.length,
      workerIds,
      projectId: first.projectId,
      title: titleFor(first, group.length),
      reason: first.reason,
      nextStep: null,
      goal: goalForCode(first.code),
      observedAt,
      source: "signal",
    });
  }

  entries.sort((a, b) => {
    const grade = GRADE_RANK[a.grade] - GRADE_RANK[b.grade];
    if (grade !== 0) return grade;
    return a.observedAt - b.observedAt;
  });
  return entries;
}

/**
 * Paths, provider tokens and vault-looking strings do not belong on a
 * notification. The inbox row still carries the original sentence.
 */
export function redactPayload(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bPA_[A-Z0-9_]{8,}\b/g, "[redacted]")
    .replace(/(?:[A-Za-z]:\\|\\\\|\/(?:home|Users|tmp|var)\/)[^\s,;]+/g, "[path]");
}
