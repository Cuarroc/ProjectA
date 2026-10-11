import type { BoardCard } from "../../../types";

export const NOW = 1_760_000_000;

/** Synthetic identities only; stable objects let a future memoization keep its benefit. */
export function boardFixture(): BoardCard[] {
  return Array.from({ length: 40 }, (_, index) => ({
    worker: {
      id: `fixture-worker-${index}`, projectId: "fixture-project",
      profileId: `fixture-profile-${index}`, task: `fixture-task-${index}`,
      branch: `fixture/task-${index}`, worktreePath: "fixture-worktree",
      sessionId: null, status: "running", kind: "worker", spawnedBy: null,
      pausedReason: null, createdAt: NOW - (index + 1) * 60,
    },
    column: index < 20 ? "working" : "in_review",
    attentionReason: null, attentionCode: null, attentionGrade: null,
    prUrl: null, contextUsage: null, controlledBy: null, testStatus: null, testedAt: null,
  }));
}

/** Exactly one changed card; every sibling retains its reference. */
export function refreshFixture(cards: readonly BoardCard[]): BoardCard[] {
  return cards.map((card, index) => index === 0
    ? { ...card, column: "in_review", worker: { ...card.worker, status: "exited" } }
    : card);
}
